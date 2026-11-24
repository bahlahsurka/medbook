// Browser counterpart of services/ai/contentHash.js (server-only, node:crypto):
// the same sha256(notes + "\0" + trimmed extraContext), via Web Crypto, so the
// client can tell whether a saved visualization / Key Points still matches
// the entry's current Review — including edits that keep the same length.
import { useEffect, useState } from 'react';

export async function contentHashHex(notes, extraContext) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null; // insecure context / very old browser: staleness unknown
  const enc = new TextEncoder();
  const parts = [enc.encode(String(notes || '')), enc.encode('\u0000'), enc.encode(String(extraContext || '').trim())];
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  const digest = await subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Current content hash of `notes` (+ extraContext), or null until computed / when unavailable. */
export function useContentHash(notes, extraContext = '') {
  const [hash, setHash] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setHash(null);
    contentHashHex(notes, extraContext).then(h => { if (!cancelled) setHash(h); }, () => {});
    return () => { cancelled = true; };
  }, [notes, extraContext]);
  return hash;
}
