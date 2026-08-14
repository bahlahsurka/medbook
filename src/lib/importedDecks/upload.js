// lib/importedDecks/upload.js
//
// Phase H2 — browser-side .apkg upload. See api/imported-blob-upload.mjs
// for why this goes through Blob's client-upload flow instead of the
// put()-with-secret-token pattern in scripts/upload-to-blob.mjs.
//
// Same properties as that proven script: private access, multipart,
// upload progress, no full file ever loaded into React state (the File
// object itself is handed to upload(), which streams it — components
// pass the File through, never its bytes).

import { upload } from '@vercel/blob/client';
import { supabase } from '../supabase';
import { MOCK_MODE } from './api';

/**
 * @param file        the File the user picked (never put in React state)
 * @param onProgress  ({ percentage }) => void
 * @param signal      AbortSignal for cancellation
 */
export async function uploadApkg(file, { onProgress, signal } = {}) {
  if (MOCK_MODE) return mockUpload(file, onProgress, signal);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  try {
    const blob = await upload(file.name, file, {
      access: 'private',
      handleUploadUrl: '/api/imported-blob-upload',
      multipart: true,               // required for large files, same as the script
      headers: { Authorization: `Bearer ${session.access_token}` },
      abortSignal: signal,
      onUploadProgress: onProgress,
    });
    return blob; // { url, pathname, ... }
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      const e = new Error('Upload cancelled');
      e.cancelled = true;
      throw e;
    }
    throw new Error(err?.message || 'Upload failed');
  }
}

/** Simulates a chunked multipart upload's progress events without any network. */
function mockUpload(file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    let pct = 0;
    const id = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(id);
        const e = new Error('Upload cancelled'); e.cancelled = true;
        reject(e);
        return;
      }
      pct = Math.min(100, pct + 12);
      onProgress?.({ percentage: pct });
      if (pct >= 100) {
        clearInterval(id);
        resolve({ url: `mock-blob://imported-decks/${file.name}`, pathname: file.name });
      }
    }, 150);
    signal?.addEventListener('abort', () => clearInterval(id));
  });
}

/**
 * Create the import_jobs row (Phase H2 step 1) once upload finishes.
 *
 * Only import_media is actually sent: it's the one option api/import-process.mjs
 * reads (`job.import_media ? 'importing_media' : 'verifying'`). The other
 * three options in the Phase H3 spec — preserve hierarchy, preserve tags,
 * import scheduling history — have NO corresponding column or backend
 * check anywhere in that file. Reading it shows why: hierarchy (parent_id)
 * and tags are unconditionally preserved already, and scheduling history is
 * unconditionally NEVER imported (hardcoded `state: 'new', due_at: null`,
 * with its own comment citing spec §9). Writing preserve_hierarchy/
 * preserve_tags/import_scheduling columns that don't exist and aren't
 * read by anything would violate the "don't add unverified schema" rule
 * for no behavioral benefit — the options screen presents these three as
 * fixed, accurately reflecting what the backend actually does, rather
 * than as toggles that would silently do nothing.
 */
export async function createImportJob({ userId, blobUrl, importMedia }) {
  if (MOCK_MODE) return { id: 'mock-job-' + Date.now(), status: 'pending', import_media: importMedia };

  const { data, error } = await supabase.from('import_jobs').insert({
    user_id: userId,
    blob_url: blobUrl,
    status: 'pending',
    import_media: importMedia,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/** Kicks off processing — fire-and-forget, same as selfInvoke in the backend. */
export function startProcessing(jobId) {
  if (MOCK_MODE) return Promise.resolve();
  return fetch(`/api/import-process?jobId=${jobId}`, { method: 'POST' }).catch(() => {});
}
