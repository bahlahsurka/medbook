// lib/importedDecks/favorites.js
//
// Batch 3 — data layer only. No Favorites screen yet; this exists so
// StudySession (and whatever screen comes next) can favorite/unfavorite a
// card through a small focused module, same as api.js/flags.js already do
// for the rest of Imported Decks, instead of Supabase calls scattered
// through components.
//
// Table: imported_card_favorites (SUPABASE_MIGRATION_IMPORTED_FAVORITES.sql)
//   id uuid pk, user_id uuid fk->auth.users, imported_card_id uuid
//   fk->imported_cards, favorited_at timestamptz, unique(user_id,
//   imported_card_id). RLS: select/insert/delete scoped to auth.uid() =
//   user_id (no update — a favorite is added or removed, never edited).
// Run that migration before any of this will work against a real project.
//
// Every function here takes `userId` explicitly, matching getSessionCards/
// browseCards/getDeckTags elsewhere in api.js (not the narrower rateCard/
// setCardFlag pattern, which can skip it only because those act on an
// already-scoped existing row via UPDATE — an INSERT needs a concrete
// user_id in the payload from somewhere, and the caller already has it
// rather than this module doing an extra supabase.auth.getUser() round
// trip before every write).
//
// Same MOCK_MODE switch as the rest of Imported Decks — one flag, not two,
// so this can never drift out of sync with api.js about whether the app is
// pointed at real data.

import { supabase } from '../supabase';
import { MOCK_MODE } from './api';
import mock from './mockData';

// MOCK_MODE store — userId -> Set<imported_card_id>. Session-only, like
// mockData.js's own arrays; not real persistence, just enough for the UI
// to exercise real add/remove/toggle logic in dev without a live project.
// Keyed by userId (not a single flat Set) specifically so MOCK_MODE can
// exercise real per-user isolation in a preview harness, the same
// isolation RLS enforces for real.
const mockFavoritesByUser = new Map();
function mockSetFor(userId) {
  if (!mockFavoritesByUser.has(userId)) mockFavoritesByUser.set(userId, new Set());
  return mockFavoritesByUser.get(userId);
}

/** Is this one card favorited by this user? A single-row existence check —
 *  for checking one card in isolation (e.g. a detail view). Building a
 *  study queue's favorite state for many cards at once should use
 *  getFavoriteCardIds() instead and check membership locally; calling this
 *  per-card in a loop would be exactly the "network round trip per card"
 *  the optimistic-UI/no-refetch requirement is about avoiding. */
export async function isFavorite(cardId, userId) {
  if (MOCK_MODE) return mockSetFor(userId).has(cardId);
  const { data, error } = await supabase.from('imported_card_favorites')
    .select('id').eq('user_id', userId).eq('imported_card_id', cardId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** Every favorited card id for this user, as a Set — the cheap bulk read a
 *  study screen loads once (e.g. alongside the session queue) so each
 *  card's favorite star can be a local Set.has() check instead of its own
 *  request. Deliberately just ids, not full card rows — getFavoriteCards()
 *  below is the one that joins in card content, for the actual Favorites
 *  screen a later batch builds. */
export async function getFavoriteCardIds(userId) {
  if (MOCK_MODE) return new Set(mockSetFor(userId));
  const { data, error } = await supabase.from('imported_card_favorites')
    .select('imported_card_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return new Set((data || []).map(r => r.imported_card_id));
}

/**
 * Favorite a card. Idempotent: favoriting an already-favorited card is a
 * harmless no-op, not an error — upsert with ignoreDuplicates leans on the
 * table's own unique(user_id, imported_card_id) constraint (ON CONFLICT DO
 * NOTHING) so a double-tap or a race between two calls can never produce
 * a duplicate row or a scary error toast for something that's already
 * effectively true.
 *
 * Returns nothing on success; throws on real failure (RLS rejection,
 * network error, missing migration) so the caller — the future optimistic
 * UI this is built for — knows to roll back its local state and surface
 * the error, per "do not silently lose the user's action". This module
 * intentionally does NOT do optimistic state itself; that's a UI-layer
 * concern (what to show immediately, what to roll back to) that belongs
 * next to the component's own state, not hidden inside the data layer.
 */
export async function addFavorite(cardId, userId) {
  if (MOCK_MODE) { mockSetFor(userId).add(cardId); return; }
  const { error } = await supabase.from('imported_card_favorites')
    .upsert({ user_id: userId, imported_card_id: cardId },
      { onConflict: 'user_id,imported_card_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** Unfavorite a card. Also idempotent — deleting a favorite that isn't
 *  there (already removed, or never existed) matches zero rows and is not
 *  an error, same as any other DELETE with no matching WHERE rows. */
export async function removeFavorite(cardId, userId) {
  if (MOCK_MODE) { mockSetFor(userId).delete(cardId); return; }
  const { error } = await supabase.from('imported_card_favorites')
    .delete().eq('user_id', userId).eq('imported_card_id', cardId);
  if (error) throw new Error(error.message);
}

/**
 * Flip a card's favorite state. Takes the CURRENTLY KNOWN state rather
 * than looking it up itself — the caller (a study screen tracking favorite
 * state locally via getFavoriteCardIds()) already knows it, and re-reading
 * it here would be exactly the extra round trip this module exists to
 * avoid, working against "the interface should feel immediate". Returns
 * the new state so the caller can commit it to local state on success;
 * throws on failure (see addFavorite's doc comment on why this module
 * doesn't attempt rollback itself).
 */
export async function toggleFavorite(cardId, userId, currentlyFavorited) {
  if (currentlyFavorited) { await removeFavorite(cardId, userId); return false; }
  await addFavorite(cardId, userId); return true;
}

/**
 * Favorited cards with their content, most-recently-favorited first — what
 * an eventual Favorites screen renders. Joins through the FK PostgREST
 * already knows about (imported_card_favorites.imported_card_id ->
 * imported_cards.id), one request rather than fetching ids then a second
 * batch-by-id lookup. Each row comes back as the card's own fields plus
 * `favorited_at`.
 *
 * RLS on imported_cards is ALSO already scoped to auth.uid() = user_id
 * (confirmed in api.js's own MOCK_MODE comment), so the embedded card rows
 * are independently guaranteed to be this user's own — not just filtered
 * by this table's user_id, real defense in depth rather than one policy
 * doing double duty.
 */
export async function getFavoriteCards(userId) {
  if (MOCK_MODE) {
    const ids = mockSetFor(userId);
    const decksById = Object.fromEntries(mock.decks.map(d => [d.id, d]));
    return mock.cards.filter(c => ids.has(c.id))
      .map(c => ({ ...c, favorited_at: new Date().toISOString(), deck: decksById[c.deck_id] || null }));
  }

  // imported_cards!inner(*, ...) — the full row, not a hand-picked column
  // list: rateCard()/Scheduler.calculateNextReview() read several fields
  // off a card (ease_factor, interval_days, review_count, lapse_count,
  // user_id for the review-log insert) that have nothing to do with what
  // this screen displays. Selecting `*` means a card favorited-and-studied
  // here carries exactly the same shape browseCards()/getSessionCards()
  // already produce, with no risk of quietly dropping a column Scheduler
  // needs the next time it changes.
  const { data, error } = await supabase.from('imported_card_favorites')
    .select('favorited_at, imported_cards!inner(*, imported_notes!inner(sort_field, fields, tags))')
    .eq('user_id', userId)
    .order('favorited_at', { ascending: false });
  if (error) throw new Error(error.message);

  // Filter out rows whose card no longer exists — shouldn't happen (the FK
  // is ON DELETE CASCADE, so the favorite row is gone the same instant the
  // card is), but a defensive null-check here is free and cheap insurance
  // against ever rendering a favorite with nothing behind it.
  const rows = (data || []).filter(r => r.imported_cards).map(r => {
    const { imported_notes, ...card } = r.imported_cards;
    return { ...card, sort_field: imported_notes?.sort_field, fields: imported_notes?.fields,
      tags: imported_notes?.tags, favorited_at: r.favorited_at };
  });

  // Deck display_name/full_name (for "deck / subdeck" context in the list)
  // via a SEPARATE small query keyed on the distinct deck_ids actually
  // present, rather than a third embed hop (imported_cards -> imported_decks)
  // stacked onto the query above — that relationship has never been
  // exercised anywhere else in the codebase, unlike the cards -> notes hop
  // browseCards() already proves works, so this doesn't lean on it being
  // set up as a real FK PostgREST can traverse.
  const deckIds = [...new Set(rows.map(r => r.deck_id).filter(Boolean))];
  let decksById = {};
  if (deckIds.length) {
    const { data: deckRows, error: deckErr } = await supabase.from('imported_decks')
      .select('id, display_name, full_name').in('id', deckIds);
    if (!deckErr) decksById = Object.fromEntries((deckRows || []).map(d => [d.id, d]));
  }
  return rows.map(r => ({ ...r, deck: decksById[r.deck_id] || null }));
}
