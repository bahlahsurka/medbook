// api/test-apkg-streaming.mjs
//
// Third-stage POC — fixes the ENOSPC failure from stage 2. That failure
// proved a real, hard constraint: Vercel's /tmp is capped at 512MB, and a
// 912MB deck can't be written there in one piece, regardless of how well
// batched the processing logic afterward is.
//
// The fix: never download the whole .apkg at all. Use HTTP range requests
// (via unzipper's Open.custom()) to read only the zip's central directory,
// then only the specific entries we actually need — the small SQLite
// database first, then media files one at a time. The full archive is
// never held in memory or on disk simultaneously, at any point.

import unzipper from 'unzipper';
import { head, get } from '@vercel/blob';
import { decompress } from 'fzstd';
import sqlite3pkg from 'sqlite3';
import { open as openSqlite } from 'sqlite';
import { writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';

const TIME_BUDGET_MS = 250_000;
const MEDIA_SAMPLE_LIMIT = 2000; // process at most this many media entries in
                                  // this test run (still one-at-a-time, bounded
                                  // memory) — a full run would process all of
                                  // them; this cap just keeps a first test from
                                  // running unnecessarily long while proving
                                  // the mechanism works.

/** A range-request-based source for unzipper.Open.custom() against a private
 *  Vercel Blob. Nothing here ever reads more than one requested range at a
 *  time — the whole file is never assembled anywhere. */
function makeBlobRangeSource(blobUrl, totalSize) {
  return {
    size: async () => totalSize,
    stream: (offset, length) => {
      const end = length != null ? offset + length - 1 : undefined;
      const rangeHeader = end != null ? `bytes=${offset}-${end}` : `bytes=${offset}-`;
      // get() is a promise; unzipper wants a stream synchronously, so bridge
      // with a PassThrough that the async fetch pipes into once resolved.
      const pass = new PassThrough();
      get(blobUrl, { access: 'private', headers: { Range: rangeHeader } })
        .then(r => {
          if (!r?.stream) { pass.destroy(new Error('No stream for range ' + rangeHeader)); return; }
          // r.stream is a Web Streams API ReadableStream (same kind fetch()
          // returns), not a Node stream — it has no .pipe(). Convert first.
          Readable.fromWeb(r.stream).pipe(pass);
        })
        .catch(err => pass.destroy(err));
      return pass;
    },
  };
}

export default async function handler(req, res) {
  const blobUrl = req.query?.url;
  if (!blobUrl) return res.status(400).json({ error: 'Pass ?url=<your blob URL> as a query parameter.' });

  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const report = { phases: {}, memorySnapshotsMB: [] };
  const snap = (label) => report.memorySnapshotsMB.push({ at: label, mb: Math.round(process.memoryUsage().rss / 1024 / 1024) });

  try {
    snap('start');

    // ---- Phase 1: get size, open the zip's central directory only ----
    const t0 = Date.now();
    const metadata = await head(blobUrl, { access: 'private' });
    const source = makeBlobRangeSource(blobUrl, metadata.size);
    const directory = await unzipper.Open.custom(source);
    report.phases.openCentralDirectory = {
      ms: Date.now() - t0,
      totalArchiveMB: +(metadata.size / 1024 / 1024).toFixed(1),
      entryCount: directory.files.length,
    };
    snap('after-directory');

    // ---- Phase 2: find + extract JUST the small database entry ----
    const t1 = Date.now();
    const dbEntry = directory.files.find(f => f.path === 'collection.anki21b')
                 || directory.files.find(f => f.path === 'collection.anki2');
    if (!dbEntry) throw new Error('No collection.anki2 or collection.anki21b entry found.');
    const isZstd = dbEntry.path === 'collection.anki21b';

    const dbBufferCompressed = await dbEntry.buffer();
    const dbBuffer = isZstd ? Buffer.from(decompress(dbBufferCompressed)) : dbBufferCompressed;

    const workDir = await mkdtemp(path.join(tmpdir(), 'apkg-stream-'));
    const dbPath = path.join(workDir, 'collection.sqlite');
    await writeFile(dbPath, dbBuffer);

    report.phases.extractDatabase = {
      ms: Date.now() - t1,
      format: isZstd ? 'zstd (collection.anki21b)' : 'uncompressed (collection.anki2)',
      compressedMB: +(dbBufferCompressed.length / 1024 / 1024).toFixed(2),
      decompressedMB: +(dbBuffer.length / 1024 / 1024).toFixed(2),
    };
    snap('after-db-extract');

    // ---- Phase 3: query the small database fully — this is now cheap ----
    const t2 = Date.now();
    const db = await openSqlite({ filename: dbPath, driver: sqlite3pkg.Database });
    const [colRow] = await db.all('SELECT decks, models FROM col');
    const decks = JSON.parse(colRow.decks);
    const models = JSON.parse(colRow.models);
    const [{ c: noteCount }] = await db.all('SELECT COUNT(*) as c FROM notes');
    const [{ c: cardCount }] = await db.all('SELECT COUNT(*) as c FROM cards');
    const [sampleNote] = await db.all('SELECT flds FROM notes LIMIT 1');
    await db.close();

    report.metadata = {
      deckCount: Object.keys(decks).length,
      deckNames: Object.values(decks).map(d => d.name),
      modelCount: Object.keys(models).length,
      modelNames: Object.values(models).map(m => ({ name: m.name, type: m.type === 1 ? 'cloze' : 'standard' })),
      noteCount, cardCount,
      sampleNote: sampleNote?.flds?.slice(0, 150),
    };
    report.phases.queryDatabase = { ms: Date.now() - t2 };
    snap('after-db-query');

    // ---- Phase 4: media, streamed one entry at a time, never all at once ----
    const t3 = Date.now();
    const mediaEntries = directory.files.filter(f => /^\d+$/.test(f.path)); // Anki media are numbered files
    const toProcess = mediaEntries.slice(0, MEDIA_SAMPLE_LIMIT);
    let mediaProcessed = 0, mediaBytesTotal = 0, stoppedEarly = false;
    const sampleMedia = [];

    for (const entry of toProcess) {
      if (TIME_BUDGET_MS - elapsed() < 15_000) { stoppedEarly = true; break; }
      const buf = await entry.buffer(); // ONE file at a time — read, measure, discard
      mediaBytesTotal += buf.length;
      if (sampleMedia.length < 5) sampleMedia.push({ name: entry.path, bytes: buf.length });
      mediaProcessed++;
      // buf goes out of scope here — not retained, keeping memory flat
      // regardless of how many media files the deck contains.
    }
    report.phases.media = {
      ms: Date.now() - t3,
      totalMediaFilesInArchive: mediaEntries.length,
      processedThisRun: mediaProcessed,
      cappedAt: MEDIA_SAMPLE_LIMIT,
      totalMediaMBProcessed: +(mediaBytesTotal / 1024 / 1024).toFixed(1),
      sampleMedia,
      stoppedEarly,
    };
    snap('after-media');

    res.status(200).json({
      ...report,
      success: true,
      neverWroteFullArchiveToDisk: true,
      totalMs: elapsed(),
      note: 'Full archive was never downloaded or written to disk — only the small database and individual media entries were read via HTTP range requests.',
    });
  } catch (err) {
    res.status(500).json({ ...report, success: false, error: err.message, stack: err.stack, totalMs: elapsed() });
  }
}
