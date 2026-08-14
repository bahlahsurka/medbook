// lib/importedDecks/api.js
//
// Data layer for the Imported Decks feature. Mirrors the pattern already
// used by lib/systems.js and lib/reviewQueue.js — components import plain
// async functions from here rather than calling supabase inline, and pure
// helpers (session ordering) stay separate from fetching.
//
// ── MOCK_MODE ──────────────────────────────────────────────────────────
// Two real, unresolved gaps make live-backend calls unverified right now:
//
//  1. due_cards does not exist as a column anywhere in the code that
//     writes imported_decks (only total_cards/new_cards are written, by
//     refreshDeckCounts in api/import-process.mjs). The spec calls for
//     "use the existing denormalized fields" for new/due/total counts,
//     but that field was never actually added. getDeckChildren() below
//     requests it and falls back to 0 (not a live COUNT scan) if the
//     column doesn't exist, rather than crashing the deck browser.
//
//  2. Every past read/write against imported_* tables ran through the
//     SERVICE ROLE key in api/import-process.mjs, which bypasses Row
//     Level Security entirely. This app's browser client (lib/supabase.js)
//     uses the anon key instead — nobody has ever verified an
//     authenticated user can actually SELECT their own imported_decks
//     rows, because nothing has tried until this feature.
//
// Until both are confirmed against the real schema, MOCK_MODE defaults to
// true so the UI is honestly demoable without silently depending on
// unverified backend behavior. Flip it (or wire up a real toggle) once
// the schema/RLS policies are confirmed.
export const MOCK_MODE = true;

import { supabase } from '../supabase';
import mock from './mockData';
import { scheduler, buildSessionQuery } from '../srs/Scheduler';

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/* Deck tree                                                           */
/* ------------------------------------------------------------------ */

export async function getRootDecks(userId) {
  if (MOCK_MODE) return mock.rootDecks();

  // due_cards: attempt the real column; if it 42703s (undefined_column),
  // retry without it rather than surfacing a hard error for a documented
  // schema gap. Either way, this is ONE query, not a per-render scan.
  let { data, error } = await supabase.from('imported_decks')
    .select('id, parent_id, full_name, display_name, is_root, total_cards, new_cards, due_cards, archived')
    .eq('user_id', userId).is('parent_id', null).eq('archived', false)
    .order('display_name');
  if (error?.code === '42703') {
    ({ data, error } = await supabase.from('imported_decks')
      .select('id, parent_id, full_name, display_name, is_root, total_cards, new_cards, archived')
      .eq('user_id', userId).is('parent_id', null).eq('archived', false)
      .order('display_name'));
    (data || []).forEach(d => { d.due_cards = null; }); // null = "unknown", not "zero"
  }
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getChildDecks(userId, parentId) {
  if (MOCK_MODE) return mock.childDecksOf(parentId);

  let { data, error } = await supabase.from('imported_decks')
    .select('id, parent_id, full_name, display_name, is_root, total_cards, new_cards, due_cards, archived')
    .eq('user_id', userId).eq('parent_id', parentId).eq('archived', false)
    .order('display_name');
  if (error?.code === '42703') {
    ({ data, error } = await supabase.from('imported_decks')
      .select('id, parent_id, full_name, display_name, is_root, total_cards, new_cards, archived')
      .eq('user_id', userId).eq('parent_id', parentId).eq('archived', false)
      .order('display_name'));
    (data || []).forEach(d => { d.due_cards = null; });
  }
  if (error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------------------------------------------ */
/* Deck actions — rename / archive / delete / reset progress            */
/* ------------------------------------------------------------------ */

export async function renameDeck(deckId, displayName) {
  if (MOCK_MODE) return { id: deckId, display_name: displayName };
  const { error } = await supabase.from('imported_decks')
    .update({ display_name: displayName }).eq('id', deckId);
  if (error) throw new Error(error.message);
}

export async function archiveDeck(deckId, archived = true) {
  if (MOCK_MODE) return;
  const { error } = await supabase.from('imported_decks')
    .update({ archived }).eq('id', deckId);
  if (error) throw new Error(error.message);
}

/**
 * Reset only scheduling state for every card under this deck subtree —
 * cards/notes/media/tags/hierarchy untouched. Scoped through imported_notes
 * (root_deck_id) same as countCardsForRoot in api/import-process.mjs, since
 * imported_cards itself carries no root_deck_id of its own.
 */
export async function resetDeckProgress(rootDeckId) {
  if (MOCK_MODE) return;
  const { data: noteRows, error: nErr } = await supabase.from('imported_notes')
    .select('id').eq('root_deck_id', rootDeckId);
  if (nErr) throw new Error(nErr.message);
  const noteIds = (noteRows || []).map(n => n.id);
  for (let i = 0; i < noteIds.length; i += 1000) {
    const { error } = await supabase.from('imported_cards')
      .update({ state: 'new', due_at: null, interval_days: 0, ease_factor: 2.5, review_count: 0, lapse_count: 0 })
      .in('note_id', noteIds.slice(i, i + 1000));
    if (error) throw new Error(error.message);
  }
}

/**
 * Delete a deck subtree. Per spec: imported cards/notes/deck hierarchy and
 * THIS deck's imported media — never Review Entry media, never My Cards,
 * never other imported decks. Mirrors MediaService.deleteDeckMedia's own
 * scoping (by root_deck_id) for the media half; DB rows cascade via the
 * ON DELETE CASCADE the schema comment in import-process.mjs says exists
 * from imported_decks — deleting the root row is expected to cascade to
 * imported_notes/imported_cards/imported_models for that root_deck_id.
 * NOT yet verified against the live schema (see MOCK_MODE note above) —
 * this only runs in MOCK_MODE today.
 */
export async function deleteDeck(rootDeckId) {
  if (MOCK_MODE) return;
  const { error } = await supabase.from('imported_decks').delete().eq('id', rootDeckId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Import jobs                                                         */
/* ------------------------------------------------------------------ */

export async function getActiveImportJob(userId) {
  if (MOCK_MODE) return null; // components pass a mock job explicitly for dev states
  const { data, error } = await supabase.from('import_jobs')
    .select('*').eq('user_id', userId)
    .in('status', ['pending', 'processing_metadata', 'importing_cards', 'importing_media', 'verifying', 'failed'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function pollImportJob(jobId) {
  if (MOCK_MODE) return mock.jobs.active;
  const res = await fetch(`/api/import-process?jobId=${jobId}`, { method: 'POST' });
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Browse — paginated, filtered, never a full-deck fetch                */
/* ------------------------------------------------------------------ */

export async function browseCards(rootDeckId, { deckId, search, state, tag, page = 0, pageSize = PAGE_SIZE } = {}) {
  if (MOCK_MODE) return mock.browseCards({ deckId, search, state, tag, page, pageSize });

  // imported_cards has no full-text field of its own — search runs against
  // the note's sort_field, so this filters notes first, then cards.
  let noteQuery = supabase.from('imported_notes').select('id').eq('root_deck_id', rootDeckId);
  if (search?.trim()) noteQuery = noteQuery.ilike('sort_field', `%${search.trim()}%`);
  if (tag) noteQuery = noteQuery.contains('tags', [tag]);
  const { data: noteRows, error: nErr } = await noteQuery;
  if (nErr) throw new Error(nErr.message);
  const noteIds = (noteRows || []).map(n => n.id);
  if (!noteIds.length) return { rows: [], total: 0 };

  let cardQuery = supabase.from('imported_cards')
    .select('id, deck_id, note_id, state, due_at', { count: 'exact' })
    .in('note_id', noteIds.slice(0, 1000)); // PostgREST .in() practical cap
  if (deckId) cardQuery = cardQuery.eq('deck_id', deckId);
  if (state) cardQuery = cardQuery.eq('state', state);
  cardQuery = cardQuery.range(page * pageSize, page * pageSize + pageSize - 1);

  const { data, error, count } = await cardQuery;
  if (error) throw new Error(error.message);
  return { rows: data || [], total: count || 0 };
}

/* ------------------------------------------------------------------ */
/* Study session — thin wrapper around the EXISTING Scheduler, never a  */
/* second ordering/scheduling implementation.                          */
/* ------------------------------------------------------------------ */

export async function getSessionCards(deckIds, { limit = 50 } = {}) {
  if (MOCK_MODE) return mock.sessionCards(deckIds, limit);

  const query = buildSessionQuery({ deckIds, limit });
  let q = supabase.from('imported_cards').select('*')
    .in('deck_id', query.deckIds).neq('state', 'suspended')
    .or(`due_at.lte.${query.nowIso},state.eq.new`);
  for (const o of query.order) q = q.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
  const { data, error } = await q.limit(query.limit);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Persist a rating via the existing scheduler — no interval math here. */
export async function rateCard(card, rating) {
  const patch = scheduler.calculateNextReview(card, rating);
  if (MOCK_MODE) return { ...card, ...patch };
  const { data, error } = await supabase.from('imported_cards')
    .update(patch).eq('id', card.id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------------------------------------------------ */
/* Media — resolved server-side only. R2 signing needs a secret key,   */
/* so the browser calls a thin API route wrapping MediaService itself  */
/* rather than touching storage details directly (Phase J3).           */
/* ------------------------------------------------------------------ */

export async function resolveMedia(rootDeckId, filenames) {
  if (MOCK_MODE) return mock.resolveMany(filenames);
  if (!filenames?.length) return {};
  const res = await fetch('/api/imported-media-resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootDeckId, filenames }),
  });
  if (!res.ok) return Object.fromEntries(filenames.map(f => [f, null]));
  return res.json();
}
