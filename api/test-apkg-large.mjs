// api/test-apkg-large.mjs
//
// Second-stage POC — tests the REAL target scale (~1GB, thousands of media
// files), fetched from Vercel Blob exactly like the real importer will.
//
// This is still parsing-only — no Supabase/R2 writes yet (Phase D isn't
// finalized). What it DOES prove, with real numbers instead of guesses:
//   - can a large file be downloaded from Blob and processed within one
//     function invocation's time/memory budget?
//   - does processing notes/cards/media in bounded batches actually keep
//     memory flat, rather than growing with deck size?
//   - if one invocation ISN'T enough, exactly where does it run out, and
//     how much real progress does it make first?
//
// It does NOT return the full extracted dataset — that would defeat the
// point (a real 1GB deck's notes/media metadata could itself be many MB of
// JSON). It reports counts, timings, and a few samples, plus whether it
// completed or had to stop early — which is the actual, honest question
// this test exists to answer.

import { Apkg } from 'anki-apkg-parser';
import { get } from '@vercel/blob';
import { mkdtemp, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const TIME_BUDGET_MS = 250_000; // stop cleanly with 50s of headroom before
                                 // Vercel's own ~300s Fluid Compute ceiling,
                                 // so we always get a real JSON response back
                                 // instead of an unclean timeout.
const NOTE_BATCH_SIZE = 500;
const MEDIA_BATCH_SIZE = 200;

export default async function handler(req, res) {
  const blobUrl = req.query?.url;
  if (!blobUrl) {
    return res.status(400).json({ error: 'Pass ?url=<your blob URL> as a query parameter.' });
  }

  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const timeLeft = () => TIME_BUDGET_MS - elapsed();
  const report = { phases: {}, memorySnapshotsMB: [] };
  const snapshotMemory = (label) => {
    const mb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    report.memorySnapshotsMB.push({ at: label, mb });
  };

  try {
    // ---- Phase 1: download from Blob, exactly like the real import will ----
    // STREAMED to disk, not loaded into memory in one shot — at 26MB that
    // distinction doesn't matter, but at 1GB it's the difference between a
    // bounded-memory download and holding the whole file in RAM at once.
    const t0 = Date.now();
    snapshotMemory('start');
    const workDir = await mkdtemp(path.join(tmpdir(), 'apkg-large-'));
    const apkgPath = path.join(workDir, 'deck.apkg');

    // A plain fetch(blobUrl) CANNOT read a private blob — Vercel requires the
    // SDK's get() method, which authenticates automatically (via OIDC) when
    // this function runs on Vercel. No token needs to be passed manually here
    // as long as the Blob store is connected to this project, which happens
    // automatically for a store created inside a linked project.
    const { stream } = await get(blobUrl, { access: 'private' });
    if (!stream) throw new Error('get() returned no readable stream — check the store is connected to this project.');

    const { createWriteStream } = await import('fs');
    const { pipeline } = await import('stream/promises');
    await pipeline(stream, createWriteStream(apkgPath));

    const fileStat = await stat(apkgPath);
    report.phases.download = { ms: Date.now() - t0, sizeMB: +(fileStat.size / 1024 / 1024).toFixed(1), streamed: true, method: 'blob.get()' };
    snapshotMemory('after-download');

    // ---- Phase 2: open + unzip + get DB handle ----
    const t1 = Date.now();
    const apkg = await Apkg.create(apkgPath, path.join(workDir, 'unpacked'));
    const db = await apkg.getDb();
    report.phases.unpackAndOpen = { ms: Date.now() - t1 };
    snapshotMemory('after-unpack');

    if (timeLeft() < 20_000) {
      return res.status(200).json({ ...report, success: false, stoppedEarly: 'before-metadata', totalMs: elapsed() });
    }

    // ---- Phase 3: metadata (lightweight, always do this fully) ----
    const t2 = Date.now();
    const [colRow] = await db.all('SELECT decks, models FROM col');
    const decks = JSON.parse(colRow.decks);
    const models = JSON.parse(colRow.models);
    report.metadata = {
      deckCount: Object.keys(decks).length,
      deckNames: Object.values(decks).map(d => d.name).slice(0, 20), // sample, not all
      modelCount: Object.keys(models).length,
      modelNames: Object.values(models).map(m => ({ name: m.name, type: m.type === 1 ? 'cloze' : 'standard' })),
    };
    report.phases.metadata = { ms: Date.now() - t2 };
    snapshotMemory('after-metadata');

    // ---- Phase 4: notes, processed in bounded batches ----
    const t3 = Date.now();
    const [{ c: totalNotes }] = await db.all('SELECT COUNT(*) as c FROM notes');
    let notesProcessed = 0;
    let sampleNote = null;
    let noteBatches = 0;
    let notesStoppedEarly = false;

    while (notesProcessed < totalNotes) {
      if (timeLeft() < 30_000) { notesStoppedEarly = true; break; }
      const batch = await db.all('SELECT id, flds FROM notes LIMIT ? OFFSET ?', [NOTE_BATCH_SIZE, notesProcessed]);
      if (batch.length === 0) break;
      if (!sampleNote) sampleNote = batch[0].flds.slice(0, 150);
      notesProcessed += batch.length;
      noteBatches++;
      // batch is NOT retained — goes out of scope here, keeping memory flat
      // regardless of total deck size (this is the actual thing being tested).
    }
    report.phases.notes = {
      ms: Date.now() - t3, totalNotes, notesProcessed, noteBatches,
      batchSize: NOTE_BATCH_SIZE, sampleNote, stoppedEarly: notesStoppedEarly,
    };
    snapshotMemory('after-notes');

    // ---- Phase 5: media, processed in bounded batches (the heavy part for
    //      a media-rich deck) — read each file's real size, discard, move on.
    const t4 = Date.now();
    const media = await apkg.getMedia();
    const mediaKeys = Object.keys(media);
    let mediaProcessed = 0;
    let mediaBytesTotal = 0;
    let mediaBatches = 0;
    let mediaStoppedEarly = false;
    const sampleMedia = [];

    for (let i = 0; i < mediaKeys.length; i += MEDIA_BATCH_SIZE) {
      if (timeLeft() < 10_000) { mediaStoppedEarly = true; break; }
      const batchKeys = mediaKeys.slice(i, i + MEDIA_BATCH_SIZE);
      for (const key of batchKeys) {
        try {
          const filePath = path.join(workDir, 'unpacked', key);
          const s = await stat(filePath);
          mediaBytesTotal += s.size;
          if (sampleMedia.length < 5) sampleMedia.push({ name: media[key], bytes: s.size });
        } catch { /* file referenced in manifest but missing — note and move on */ }
        mediaProcessed++;
      }
      mediaBatches++;
    }
    report.phases.media = {
      ms: Date.now() - t4,
      totalMediaFiles: mediaKeys.length,
      mediaProcessed, mediaBatches, batchSize: MEDIA_BATCH_SIZE,
      totalMediaMB: +(mediaBytesTotal / 1024 / 1024).toFixed(1),
      sampleMedia, stoppedEarly: mediaStoppedEarly,
    };
    snapshotMemory('after-media');

    const success = !notesStoppedEarly && !mediaStoppedEarly;
    res.status(200).json({
      ...report,
      success,
      completedFully: success,
      totalMs: elapsed(),
      note: success
        ? 'Completed within one invocation.'
        : 'Did NOT complete in one invocation — see stoppedEarly flags above. This means the real importer needs multiple chunked invocations (a resumable job), not a single-shot function.',
    });
  } catch (err) {
    res.status(500).json({ ...report, success: false, error: err.message, stack: err.stack, totalMs: elapsed() });
  }
}
