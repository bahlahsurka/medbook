// scripts/upload-to-blob.mjs
//
// One-time upload of a large .apkg file to your Vercel Blob store.
// Run this from your own machine (not Vercel) — it just pushes the file up
// so the server-side parsing function can fetch it from there.
//
// SETUP (one time):
//   1. npm install @vercel/blob
//   2. Get a Blob read-write token: Vercel dashboard -> your project ->
//      Storage -> your Blob store -> ".env.local" tab -> copy the
//      BLOB_READ_WRITE_TOKEN value.
//   3. Set it as an environment variable before running this script:
//        Git Bash:  export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
//   (Never commit this token to git — it's a secret, same rules as the
//   Gemini key and Supabase keys.)
//
// USAGE:
//   node scripts/upload-to-blob.mjs /path/to/your-deck.apkg

import { put } from '@vercel/blob';
import { readFile } from 'fs/promises';
import path from 'path';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node upload-to-blob.mjs /path/to/deck.apkg');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set. See the setup notes at the top of this file.');
  process.exit(1);
}

console.log('Reading file...');
const buffer = await readFile(filePath);
console.log(`File size: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

console.log('Uploading to Vercel Blob (multipart, this can take a while for a 1GB file — progress shown below)...');
const t0 = Date.now();
let lastPct = -1;

const blob = await put(`apkg-poc/${path.basename(filePath)}`, buffer, {
  access: 'private',         // matches your actual Blob store's configuration.
                              // Private is also the correct long-term choice —
                              // a real user's study deck should never sit in
                              // unauthenticated public storage.
  addRandomSuffix: true,     // avoids collisions if you run this more than once
  contentType: 'application/octet-stream',
  multipart: true,           // REQUIRED for large files — Vercel's own docs
                              // recommend this for anything over 100MB. Without
                              // it, the whole file goes in a single request with
                              // no chunking, which is slow, fragile, and (as
                              // discovered) gives zero visible progress.
  onUploadProgress: ({ percentage }) => {
    // Only print when the whole number changes, so this doesn't spam the
    // terminal with near-identical lines.
    const pct = Math.floor(percentage);
    if (pct !== lastPct) {
      lastPct = pct;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${pct}%  (${elapsed}s elapsed)`);
    }
  },
});

const seconds = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nUpload complete in ${seconds}s`);
console.log('Blob URL (send this back):');
console.log(blob.url);
