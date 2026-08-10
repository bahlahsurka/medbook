// api/test-apkg-parse.mjs
//
// MINIMAL PROOF-OF-CONCEPT ONLY — per spec Section 13.
// Does NOT implement the real importer. No Vercel Blob, no Supabase writes,
// no batching. This exists to answer exactly one question: does
// anki-apkg-parser (native sqlite3 + native/pure-JS zstd bindings) actually
// run correctly inside Vercel's real serverless Node.js runtime?
//
// The embedded test fixture is a tiny, synthetic, zstd-compressed
// collection.anki21b (~1KB) — built locally, not sourced from any real deck,
// specifically to exercise the riskiest code path (native zstd decompression
// + native SQLite) without needing a real file upload for this first test.

import { Apkg } from 'anki-apkg-parser';
import { writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { TEST_APKG_BASE64 } from './_test-fixture.mjs';

export default async function handler(req, res) {
  const timings = {};
  const t0 = Date.now();

  try {
    // Vercel functions get an ephemeral /tmp — write the test file there,
    // exactly like a real uploaded .apkg would need to be staged before parsing.
    const workDir = await mkdtemp(path.join(tmpdir(), 'apkg-poc-'));
    const apkgPath = path.join(workDir, 'test.apkg');
    await writeFile(apkgPath, Buffer.from(TEST_APKG_BASE64, 'base64'));
    timings.fileWriteMs = Date.now() - t0;

    const t1 = Date.now();
    const apkg = await Apkg.create(apkgPath, path.join(workDir, 'unpacked'));
    timings.parseMs = Date.now() - t1;

    const t2 = Date.now();
    const db = await apkg.getDb();
    const [colRow] = await db.all('SELECT decks, models FROM col');
    const decks = JSON.parse(colRow.decks);
    const notes = await db.all('SELECT flds FROM notes');
    const cards = await db.all('SELECT id, nid, did FROM cards');
    timings.queryMs = Date.now() - t2;

    timings.totalMs = Date.now() - t0;

    res.status(200).json({
      success: true,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      extracted: {
        deckCount: Object.keys(decks).length,
        deckNames: Object.values(decks).map(d => d.name),
        noteCount: notes.length,
        noteContent: notes[0]?.flds,   // should read the embedded proof string
        cardCount: cards.length,
      },
      timings,
      zstdPathExercised: true,
    });
  } catch (err) {
    // If native bindings fail to load/execute in Vercel's runtime, THIS is
    // where it will surface — report the exact error rather than a generic 500.
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack,
      timings,
    });
  }
}
