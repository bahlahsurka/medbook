// api/imported-media-resolve.mjs
//
// Phase J3 — the ONLY place the browser touches media resolution. Wraps
// MediaService.resolveMany() server-side because generating a real URL
// (R2 presigned GET) needs the R2 secret key, which — like the Blob
// read-write token — must never reach the browser. The renderer that
// calls this (via lib/importedDecks/api.js resolveMedia) never learns
// whether a file lives in R2 or Supabase Storage; it just gets back
// { filename: url|null }, exactly MediaService.resolveMany()'s own shape.

import { createClient } from '@supabase/supabase-js';
import { createMediaService } from '../src/lib/media/MediaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers?.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization bearer token' });

  const { rootDeckId, filenames } = req.body || {};
  if (!rootDeckId || !Array.isArray(filenames)) {
    return res.status(400).json({ error: 'rootDeckId and filenames[] required' });
  }

  const anonClient = createClient(
    process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY
  );
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  // Service-role client for the actual lookup — imported_media rows are
  // scoped to root_deck_id, and deck ownership is checked explicitly below
  // rather than relying on RLS (same "not yet verified" gap noted in
  // lib/importedDecks/api.js).
  const db = createClient(
    process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: deck, error: deckErr } = await db.from('imported_decks')
    .select('id, user_id, parent_id').eq('id', rootDeckId).single();
  if (deckErr || !deck || deck.user_id !== user.id) {
    return res.status(403).json({ error: 'Not your deck' });
  }

  // `rootDeckId` here is really "whichever deck node the caller is
  // studying/previewing" — StudySession.js and BrowseDeck's preview both
  // pass the clicked node's own id, which is the ROOT only when that node
  // happens to be one. imported_media.root_deck_id is always the TRUE
  // root, same as imported_notes — so resolving media for a sub-deck study
  // session (the overwhelmingly common case, since the aggregate root
  // itself never holds cards directly) always found zero rows and showed
  // "image unavailable" on every card, regardless of whether the media
  // actually imported fine. Walk parent_id up to the real root before
  // querying. Bounded by the deck tree's actual depth (a handful of
  // queries at most — decks are never more than a few levels deep).
  let root = deck;
  while (root.parent_id) {
    const { data: parent, error: parentErr } = await db.from('imported_decks')
      .select('id, user_id, parent_id').eq('id', root.parent_id).single();
    if (parentErr || !parent) break; // orphaned row — resolve with whatever we have
    root = parent;
  }

  try {
    const media = createMediaService({ db });
    const resolved = await media.resolveMany({ rootDeckId: root.id, filenames });
    return res.status(200).json(resolved);
  } catch (err) {
    console.error('[imported-media-resolve] failed', { rootDeckId: root.id, message: err.message });
    return res.status(500).json({ error: err.message });
  }
}
