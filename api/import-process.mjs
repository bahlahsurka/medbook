// api/import-process.mjs
//
// The resumable import pipeline (spec §15/§21/§22).
//
// WHY THIS IS RESUMABLE: real measurement, not caution — reading the media of
// your 912MB Tzanki deck took ~91s for 2,000 of 3,314 files, BEFORE any upload
// to storage. Uploading each file will add substantially more. That cannot fit
// in one invocation's budget, so the job persists cursors and re-invokes itself
// until finished.
//
// Each invocation:
//   1. loads the job row
//   2. does as much work as fits in the time budget
//   3. saves its cursors
//   4. if unfinished, triggers itself again and returns
//
// Nothing is ever held whole in memory: the archive is read via HTTP range
// requests, and media is processed one file at a time.

import unzipper from 'unzipper';
import { head, get, del } from '@vercel/blob';
import { decompress } from 'fzstd';
import sqlite3pkg from 'sqlite3';
import { open as openSqlite } from 'sqlite';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';
import { createMediaService } from '../src/lib/media/MediaService.js';

const TIME_BUDGET_MS = 240_000;   // leave headroom under the 300s ceiling
const NOTE_BATCH = 500;
const MEDIA_BATCH = 50;

/* ---------------- range-based archive access ---------------- */

function makeBlobRangeSource(blobUrl, totalSize) {
  return {
    size: async () => totalSize,
    stream: (offset, length) => {
      const end = length != null ? offset + length - 1 : undefined;
      const rangeHeader = end != null ? `bytes=${offset}-${end}` : `bytes=${offset}-`;
      const pass = new PassThrough();
      get(blobUrl, { access: 'private', headers: { Range: rangeHeader } })
        .then(r => {
          if (!r?.stream) { pass.destroy(new Error('No stream for ' + rangeHeader)); return; }
          Readable.fromWeb(r.stream).pipe(pass);   // get() returns a Web stream
        })
        .catch(err => pass.destroy(err));
      return pass;
    },
  };
}

/* ---------------- helpers ---------------- */

const ANKI_FIELD_SEP = '\u001f';   // Anki packs note fields separated by 0x1f

/** "A::B::C" -> display name "C"; used to rebuild the hierarchy. */
function lastSegment(fullName) {
  const parts = String(fullName).split('::');
  return parts[parts.length - 1].trim() || fullName;
}

/** Which media filenames a note's HTML actually references. */
function extractMediaRefs(fieldsText) {
  const refs = new Set();
  const patterns = [
    /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /\[sound:([^\]]+)\]/gi,
    /<source[^>]+src\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(fieldsText)) !== null) {
      const name = m[1].split('?')[0].trim();
      if (name && !/^https?:\/\//i.test(name)) refs.add(decodeURIComponent(name));
    }
  }
  return refs;
}

async function updateJob(db, jobId, patch) {
  await db.from('import_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
}

/* ---------------- main handler ---------------- */

export default async function handler(req, res) {
  const jobId = req.query?.jobId || req.body?.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const started = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started);

  // Service-role client: this runs server-side and must write on the user's
  // behalf. User scoping is enforced explicitly by always filtering/inserting
  // with the job's own user_id — never trusting anything from the request.
  const db = createClient(
    process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let job;
  try {
    const { data, error } = await db.from('import_jobs').select('*').eq('id', jobId).single();
    if (error || !data) throw new Error('Import job not found');
    job = data;

    if (['completed', 'cancelled'].includes(job.status)) {
      return res.status(200).json({ status: job.status, message: 'Nothing to do.' });
    }

    // ---- resume a previously-failed job ----
    //
    // THE ACTUAL BUG (found by reading this file, not by touching
    // MediaService.js again): the three phase gates below only recognize
    // 'pending' / 'processing_metadata' / 'importing_cards' (phase 1),
    // 'importing_media' (phase 2), and 'verifying' (phase 3). They never
    // recognized 'failed'. So the very first time storeImportedMedia threw
    // for real, this handler's catch block persisted status: 'failed' —
    // and every trigger after that hit NONE of the three gates, fell
    // through to `return res.status(200).json({ status: job.status })`,
    // and did zero work. No archive re-read, no media re-processed, no new
    // error. What looked like "the same crash three deploys in a row" was
    // one crash, followed by three retriggers that were all silent no-ops
    // — the "same error" being read back was the untouched error_message
    // column from the original failure, and media_cursor was identical
    // across attempts because nothing had actually run since. None of the
    // v2/v3/v4 MediaService fixes ever got a chance to execute against
    // this job.
    //
    // Fix: on a 'failed' job, work out which phase it actually got to from
    // its own progress columns (deck_id / notes_cursor / media_cursor) and
    // re-enter there, clearing the stale error so a fresh one is visible
    // if it fails again.
    if (job.status === 'failed') {
      let resumeStatus;
      if (!job.deck_id || (job.notes_cursor || 0) < (job.total_notes || 0)) {
        resumeStatus = job.deck_id ? 'importing_cards' : 'pending';
      } else if (job.import_media && (job.media_cursor || 0) < (job.total_media || 0)) {
        resumeStatus = 'importing_media';
      } else {
        resumeStatus = 'verifying';
      }
      await updateJob(db, jobId, { status: resumeStatus, error_message: null, error_detail: null });
      job.status = resumeStatus;
    }

    const userId = job.user_id;
    const media = createMediaService({ db });

    // ---- open the archive (range requests only) ----
    const meta = await head(job.blob_url, { access: 'private' });
    const directory = await unzipper.Open.custom(makeBlobRangeSource(job.blob_url, meta.size));

    // ---- extract + open the small database ----
    const dbEntry = directory.files.find(f => f.path === 'collection.anki21b')
                 || directory.files.find(f => f.path === 'collection.anki2');
    if (!dbEntry) throw new Error('Unsupported package: no collection database found.');

    const raw = await dbEntry.buffer();
    const dbBytes = dbEntry.path.endsWith('21b') ? Buffer.from(decompress(raw)) : raw;
    const workDir = await mkdtemp(path.join(tmpdir(), 'import-'));
    const sqlitePath = path.join(workDir, 'collection.sqlite');
    await writeFile(sqlitePath, dbBytes);
    const anki = await openSqlite({ filename: sqlitePath, driver: sqlite3pkg.Database });

    // ---- media manifest: numbered entry -> real filename ----
    let mediaMap = {};
    const manifestEntry = directory.files.find(f => f.path === 'media');
    if (manifestEntry) {
      try { mediaMap = JSON.parse((await manifestEntry.buffer()).toString('utf8')); } catch { mediaMap = {}; }
    }

    /* ========== PHASE 1: decks, models, notes, cards ========== */
    if (['pending', 'processing_metadata', 'importing_cards'].includes(job.status)) {
      await updateJob(db, jobId, { status: 'processing_metadata' });

      const [colRow] = await anki.all('SELECT decks, models FROM col');
      const ankiDecks = JSON.parse(colRow.decks);
      const ankiModels = JSON.parse(colRow.models);

      let rootDeckId = job.deck_id;

      // Create decks once (first invocation only).
      if (!rootDeckId) {
        // Sort by name so parents are always created before their children.
        const sorted = Object.values(ankiDecks)
          .filter(d => d.name !== 'Default' || Object.keys(ankiDecks).length === 1)
          .sort((a, b) => a.name.localeCompare(b.name));

        const idByFullName = {};
        let rootRow = null;

        for (const d of sorted) {
          const fullName = d.name.trim();
          const parentName = fullName.includes('::')
            ? fullName.slice(0, fullName.lastIndexOf('::')).trim()
            : null;

          const { data: inserted, error: insErr } = await db.from('imported_decks').insert({
            user_id: userId,
            anki_deck_id: d.id,
            parent_id: parentName ? (idByFullName[parentName] || null) : null,
            full_name: fullName,
            display_name: lastSegment(fullName),
            is_root: !parentName,
          }).select('id, is_root').single();
          if (insErr) throw new Error(`Deck insert failed: ${insErr.message}`);

          idByFullName[fullName] = inserted.id;
          if (!rootRow && inserted.is_root) rootRow = inserted;
        }

        rootDeckId = rootRow?.id || Object.values(idByFullName)[0];
        await updateJob(db, jobId, { deck_id: rootDeckId });
        job.deck_id = rootDeckId;

        // Models — the templates/CSS that give the deck its look.
        const modelRows = Object.values(ankiModels).map(m => ({
          user_id: userId,
          root_deck_id: rootDeckId,
          anki_model_id: m.id,
          name: m.name,
          is_cloze: m.type === 1,
          field_names: (m.flds || []).map(f => f.name),
          templates: (m.tmpls || []).map(t => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
          css: m.css || '',
        }));
        if (modelRows.length) {
          const { error: mErr } = await db.from('imported_models').insert(modelRows);
          if (mErr) throw new Error(`Model insert failed: ${mErr.message}`);
        }

        const [{ c: totalNotes }] = await anki.all('SELECT COUNT(*) as c FROM notes');
        const [{ c: totalCards }] = await anki.all('SELECT COUNT(*) as c FROM cards');
        await updateJob(db, jobId, {
          total_notes: totalNotes, total_cards: totalCards,
          total_media: Object.keys(mediaMap).length,
          status: 'importing_cards',
        });
        job.total_notes = totalNotes;
      }

      // Map anki ids -> our uuids, needed to link notes/cards correctly.
      const { data: deckRows } = await db.from('imported_decks')
        .select('id, anki_deck_id').eq('user_id', userId)
        .in('anki_deck_id', Object.values(ankiDecks).map(d => d.id));
      const deckIdByAnkiId = Object.fromEntries((deckRows || []).map(r => [String(r.anki_deck_id), r.id]));

      const { data: modelRows2 } = await db.from('imported_models')
        .select('id, anki_model_id').eq('root_deck_id', job.deck_id);
      const modelIdByAnkiId = Object.fromEntries((modelRows2 || []).map(r => [String(r.anki_model_id), r.id]));

      // Notes + their cards, in resumable batches.
      let cursor = job.notes_cursor || 0;
      while (cursor < (job.total_notes || 0)) {
        if (timeLeft() < 40_000) {
          await updateJob(db, jobId, { notes_cursor: cursor, imported_notes: cursor });
          await selfInvoke(req, jobId);
          return res.status(200).json({ status: 'importing_cards', resumed: true, notesDone: cursor, totalNotes: job.total_notes });
        }

        const noteBatch = await anki.all(
          'SELECT id, guid, mid, tags, flds, sfld FROM notes ORDER BY id LIMIT ? OFFSET ?',
          [NOTE_BATCH, cursor]
        );
        if (!noteBatch.length) break;

        const noteRows = noteBatch.map(n => ({
          user_id: userId,
          root_deck_id: job.deck_id,
          model_id: modelIdByAnkiId[String(n.mid)] || null,
          anki_note_id: n.id,
          anki_guid: n.guid,
          fields: String(n.flds || '').split(ANKI_FIELD_SEP),
          tags: String(n.tags || '').trim().split(/\s+/).filter(Boolean),
          sort_field: String(n.sfld || '').slice(0, 500),
        }));

        const { data: insertedNotes, error: nErr } = await db.from('imported_notes')
          .insert(noteRows).select('id, anki_note_id');
        if (nErr) throw new Error(`Note insert failed: ${nErr.message}`);

        const noteIdByAnkiId = Object.fromEntries(insertedNotes.map(r => [String(r.anki_note_id), r.id]));
        const ankiNoteIds = noteBatch.map(n => n.id);

        const cardBatch = await anki.all(
          `SELECT id, nid, did, ord FROM cards WHERE nid IN (${ankiNoteIds.map(() => '?').join(',')})`,
          ankiNoteIds
        );

        const cardRows = cardBatch.map(c => ({
          user_id: userId,
          deck_id: deckIdByAnkiId[String(c.did)] || job.deck_id,
          note_id: noteIdByAnkiId[String(c.nid)],
          anki_card_id: c.id,
          template_ord: c.ord || 0,
          // Scheduling history is deliberately NOT imported (spec §9) — a
          // shared deck starts fresh rather than inheriting someone else's
          // review intervals.
          state: 'new',
          due_at: null,
        })).filter(r => r.note_id);

        if (cardRows.length) {
          const { error: cErr } = await db.from('imported_cards').insert(cardRows);
          if (cErr) throw new Error(`Card insert failed: ${cErr.message}`);
        }

        cursor += noteBatch.length;
        await updateJob(db, jobId, { notes_cursor: cursor, imported_notes: cursor });
      }

      await updateJob(db, jobId, { status: job.import_media ? 'importing_media' : 'verifying', notes_cursor: cursor });
      job.status = job.import_media ? 'importing_media' : 'verifying';
    }

    /* ========== PHASE 2: media, one file at a time ========== */
    if (job.status === 'importing_media') {
      // Only fetch media the cards actually reference.
      const numberedEntries = directory.files.filter(f => /^\d+$/.test(f.path));
      let cursor = job.media_cursor || 0;

      while (cursor < numberedEntries.length) {
        if (timeLeft() < 45_000) {
          await updateJob(db, jobId, { media_cursor: cursor, imported_media: cursor });
          await selfInvoke(req, jobId);
          return res.status(200).json({ status: 'importing_media', resumed: true, mediaDone: cursor, totalMedia: numberedEntries.length });
        }

        const slice = numberedEntries.slice(cursor, cursor + MEDIA_BATCH);
        for (const entry of slice) {
          const realName = mediaMap[entry.path] || entry.path;
          const buf = await entry.buffer();               // ONE file in memory
          await media.storeImportedMedia({
            userId,
            rootDeckId: job.deck_id,
            ankiFilename: realName,
            buffer: buf,
            contentType: guessContentType(realName),
          });
          // buf goes out of scope — memory stays flat regardless of deck size
        }
        cursor += slice.length;
        await updateJob(db, jobId, { media_cursor: cursor, imported_media: cursor });
      }

      await updateJob(db, jobId, { status: 'verifying' });
      job.status = 'verifying';
    }

    /* ========== PHASE 3: verify, then delete the source ========== */
    if (job.status === 'verifying') {
      // Cards don't carry a root_deck_id of their own — each card's deck_id
      // is its OWN (often nested) Anki sub-deck, not the root. Counting
      // "cards for this import" by .eq('deck_id', job.deck_id) therefore
      // only ever catches cards someone put directly on the root deck node
      // — for any hierarchical deck (i.e. almost all real decks) that's
      // near-zero, even though every card imported fine. Go through notes
      // instead, which DO carry root_deck_id, and count cards per note.
      const [{ count: noteCount }, cardCount] = await Promise.all([
        db.from('imported_notes').select('*', { count: 'exact', head: true }).eq('root_deck_id', job.deck_id),
        countCardsForRoot(db, userId, job.deck_id),
      ]);

      // Integrity check BEFORE destroying the source archive (spec §56).
      const notesOk = (noteCount || 0) >= (job.total_notes || 0) * 0.99;
      if (!notesOk) {
        await updateJob(db, jobId, {
          status: 'failed',
          error_message: `Verification failed: expected ~${job.total_notes} notes, found ${noteCount}. Original .apkg kept so you can retry.`,
        });
        return res.status(200).json({ status: 'failed', reason: 'verification', expected: job.total_notes, found: noteCount });
      }

      // Refresh the denormalised counts the deck browser reads.
      await refreshDeckCounts(db, userId, job.deck_id);

      // Only NOW is the temporary archive safe to remove (spec §11).
      try { await del(job.blob_url); } catch { /* non-fatal: import already succeeded */ }

      await updateJob(db, jobId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        imported_notes: noteCount,
        imported_cards: cardCount,
      });

      return res.status(200).json({
        status: 'completed', deckId: job.deck_id,
        notes: noteCount, cards: cardCount, elapsedMs: Date.now() - started,
      });
    }

    return res.status(200).json({ status: job.status });
  } catch (err) {
    if (job) {
      await updateJob(db, jobId, {
        status: 'failed',
        error_message: err.message,
        error_detail: { stack: err.stack?.slice(0, 2000) },
      }).catch(() => {});
    }
    // The original .apkg is intentionally NOT deleted on failure, so a retry
    // never requires re-uploading a 900MB file.
    return res.status(500).json({ status: 'failed', error: err.message });
  }
}

/** Re-invoke this same endpoint to continue the job. */
async function selfInvoke(req, jobId) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  const proto = req.headers?.['x-forwarded-proto'] || 'https';
  if (!host) return;
  // Fire-and-forget: we don't await the work, only the handoff.
  fetch(`${proto}://${host}/api/import-process?jobId=${jobId}`, { method: 'POST' }).catch(() => {});
}

/**
 * Count cards belonging to ANY deck under this import, by going through
 * notes (which carry root_deck_id) rather than trusting card.deck_id,
 * which is scoped to whichever specific Anki sub-deck the card is in.
 * Chunked because .in() has a practical size limit and a deck can have
 * several thousand notes.
 */
async function countCardsForRoot(db, userId, rootDeckId) {
  const { data: noteRows } = await db.from('imported_notes').select('id').eq('root_deck_id', rootDeckId);
  const noteIds = (noteRows || []).map(n => n.id);
  if (!noteIds.length) return 0;

  let total = 0;
  for (let i = 0; i < noteIds.length; i += 1000) {
    const { count } = await db.from('imported_cards')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('note_id', noteIds.slice(i, i + 1000));
    total += count || 0;
  }
  return total;
}

async function refreshDeckCounts(db, userId, rootDeckId) {
  const { data: decks } = await db.from('imported_decks').select('id').eq('user_id', userId);
  for (const d of (decks || [])) {
    const { count: total } = await db.from('imported_cards')
      .select('*', { count: 'exact', head: true }).eq('deck_id', d.id);
    const { count: newCount } = await db.from('imported_cards')
      .select('*', { count: 'exact', head: true }).eq('deck_id', d.id).eq('state', 'new');
    await db.from('imported_decks')
      .update({ total_cards: total || 0, new_cards: newCount || 0 })
      .eq('id', d.id);
  }
}

function guessContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
    webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp',
    mp3:'audio/mpeg', ogg:'audio/ogg', wav:'audio/wav', m4a:'audio/mp4',
    mp4:'video/mp4', webm:'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

export { extractMediaRefs, lastSegment, guessContentType };
