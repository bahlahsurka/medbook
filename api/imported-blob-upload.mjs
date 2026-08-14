// api/imported-blob-upload.mjs
//
// Browser-safe adaptation of scripts/upload-to-blob.mjs (Phase H2).
//
// That script calls put() directly with BLOB_READ_WRITE_TOKEN — the raw
// read-write secret for the entire Blob store. That's fine run locally from
// a terminal; it is NOT fine shipped to a browser, where any visitor could
// read it out of the bundle and upload/overwrite/delete anything in the
// store. The token never leaves this server-side function.
//
// The correct browser-safe equivalent is Vercel Blob's CLIENT UPLOAD flow:
// the browser asks THIS route for a short-lived, scoped upload token
// (handleUpload below), then uploads directly to Blob storage with it —
// same private access, same multipart chunking, same progress events as
// the original script, just without ever exposing the long-lived secret.
//
// Auth: onBeforeGenerateToken verifies the caller's Supabase access token
// server-side (never trusts a client-supplied user id) before minting a
// token, and scopes the resulting pathname under that verified user's own
// prefix — one user cannot mint a token that writes into another user's
// import path.

import { handleUpload } from '@vercel/blob/client';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers?.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization bearer token' });

  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Scope every upload under the verified user's own prefix, ignoring
        // whatever path the client asked for beyond the filename itself —
        // same intent as the original script's `apkg-poc/${basename}` key,
        // just per-user instead of a single shared folder.
        const safeName = pathname.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_');
        return {
          pathname: `imported-decks/${user.id}/${Date.now()}-${safeName}`,
          allowedContentTypes: ['application/octet-stream', 'application/zip', 'application/x-zip-compressed'],
          addRandomSuffix: false, // already unique via the timestamp prefix
          access: 'private',       // matches the proven script — never public
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do here — the browser creates the import_jobs row
        // itself once upload() resolves with the blob URL (Phase H2 spec:
        // "After successful upload: 1. Create the import_jobs row").
        // Vercel calls this webhook-style after the upload lands; on a
        // preview deployment behind Vercel's own SSO/deployment protection
        // this callback can be unreachable, which is fine — it's not on
        // the critical path for the browser's own upload() promise to
        // resolve.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
