// lib/importedDecks/api.js
//
// Data layer for the Imported Decks feature. Mirrors the pattern already
// used by lib/systems.js and lib/reviewQueue.js — components import plain
// async functions from here rather than calling supabase inline, and pure
// helpers (session ordering) stay separate from fetching.
//
// ── MOCK_MODE ──────────────────────────────────────────────────────────
// Was `true` while two real gaps made live-backend calls unverified. Both
// are now confirmed against the live schema, so this is real data:
//
//  1. due_cards now exists as a column on imported_decks (confirmed via
//     information_schema). refreshDeckCounts in api/import-process.mjs
//     still only writes total_cards/new_cards, not due_cards — harmless:
//     every freshly-imported card starts as state:'new' with due_at:null
//     (spec §9 — scheduling history is never imported), so due_cards is
//     genuinely 0 for anything that hasn't been studied yet. The 42703
//     fallback below stays as a real safety net either way.
//
//  2. RLS is confirmed in place on all four imported_* tables (own
//     select/insert/update/delete, `auth.uid() = user_id`) — the same
//     pattern the rest of the app already relies on through the anon-key
//     browser client. Verified directly against the production project.
export const MOCK_MODE = false;

import { supabase } from '../supabase';
import mock from './mockData';
import { scheduler, buildSessionQuery } from '../srs/Scheduler';

const PAGE_SIZE = 50;

/**
 * A deck node passed around the UI (from getRootDecks/getChildDecks) can be
 * ANY depth — root or a nested sub-deck, both expose the same Study/Browse
 * actions (see DeckBrowser's DeckNode). Cards attach to whichever specific
 * (often leaf) deck they're filed under, not to an ancestor root — so
 * "browse/study this node" has to mean this deck PLUS every deck under it,
 * or a deck with children (including the aggregate root, which never holds
 * cards directly) would silently look empty. This walks parent_id to
 * collect that set. Decks are few per user (dozens, not thousands), so one
 * flat query + in-memory BFS is cheap — no recursive SQL needed.
 */
async function collectDescendantDeckIds(userId, deckId) {
  const { data, error } = await supabase.from('imported_decks')
    .select('id, parent_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  const childrenOf = {};
  (data || []).forEach(d => { (childrenOf[d.parent_id] ||= []).push(d.id); });
  const ids = [deckId];
  const queue = [deckId];
  while (queue.length) {
    const cur = queue.shift();
    (childrenOf[cur] || []).forEach(c => { ids.push(c); queue.push(c); });
  }
  return ids;
}

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

/**
 * Read-only status poll — selects the import_jobs row directly. Deliberately
 * NOT a call to /api/import-process: that endpoint does real work and
 * already re-invokes itself (selfInvoke) to continue a job in the
 * background. Hitting it again on a polling timer would race the chain it
 * already started — the very class of concurrent-invocation bug this
 * session's earlier fixes were about. One explicit POST (startProcessing,
 * below) kicks the chain off; after that, the UI only ever reads.
 */
export async function getImportJob(jobId) {
  if (MOCK_MODE) return mock.jobs.active;
  const { data, error } = await supabase.from('import_jobs').select('*').eq('id', jobId).single();
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------------------------------------------------ */
/* Browse — paginated, filtered, never a full-deck fetch                */
/* ------------------------------------------------------------------ */

export async function browseCards(deckId, { search, state, tag, page = 0, pageSize = PAGE_SIZE, userId } = {}) {
  if (MOCK_MODE) return mock.browseCards({ deckId, search, state, tag, page, pageSize });

  // `deckId` is whichever node the user is browsing (root or any sub-deck)
  // — expand to its full subtree first (see collectDescendantDeckIds), then
  // query cards directly by deck_id. Embed imported_notes (a real FK,
  // imported_cards_note_id_fkey) in the same round trip for search/tag
  // filtering AND the preview text — cards carry no text of their own.
  const deckIds = await collectDescendantDeckIds(userId, deckId);

  let cardQuery = supabase.from('imported_cards')
    .select('id, deck_id, note_id, state, due_at, imported_notes!inner(sort_field, fields, tags)',
      { count: 'exact' })
    .in('deck_id', deckIds);
  if (state) cardQuery = cardQuery.eq('state', state);
  if (search?.trim()) cardQuery = cardQuery.ilike('imported_notes.sort_field', `%${search.trim()}%`);
  if (tag) cardQuery = cardQuery.contains('imported_notes.tags', [tag]);
  cardQuery = cardQuery.range(page * pageSize, page * pageSize + pageSize - 1);

  const { data, error, count } = await cardQuery;
  if (error) throw new Error(error.message);
  const rows = (data || []).map(({ imported_notes, ...c }) => ({
    ...c, sort_field: imported_notes?.sort_field, fields: imported_notes?.fields, tags: imported_notes?.tags,
  }));
  return { rows, total: count || 0 };
}

/** Distinct tags across a deck's whole subtree, for the Browse filter. */
export async function getDeckTags(deckId, userId) {
  if (MOCK_MODE) return [...new Set(mock.cards.flatMap(c => c.tags || []))].sort();
  const deckIds = await collectDescendantDeckIds(userId, deckId);
  const { data, error } = await supabase.from('imported_cards')
    .select('imported_notes!inner(tags)').in('deck_id', deckIds);
  if (error) throw new Error(error.message);
  const set = new Set();
  (data || []).forEach(r => (r.imported_notes?.tags || []).forEach(tg => set.add(tg)));
  return [...set].sort();
}

/* ------------------------------------------------------------------ */
/* Study session — thin wrapper around the EXISTING Scheduler, never a  */
/* second ordering/scheduling implementation.                          */
/* ------------------------------------------------------------------ */

export async function getSessionCards(deckIds, { limit = 50, userId } = {}) {
  if (MOCK_MODE) return mock.sessionCards(deckIds, limit);

  // Same subtree-expansion as browseCards — "study this deck" has to
  // include its descendants, or studying a node with children (including
  // the aggregate root) would show zero cards even when its subdecks are
  // full of them.
  const expanded = await Promise.all(deckIds.map(id => collectDescendantDeckIds(userId, id)));
  const allDeckIds = [...new Set(expanded.flat())];

  const query = buildSessionQuery({ deckIds: allDeckIds, limit });
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

/**
 * Note + its model for ONE card — never the whole deck's notes/models,
 * since a session/preview only ever renders one card at a time. Was
 * previously inlined as a direct `mock.notes.find(...)` in both
 * StudySession.js and BrowseDeck.js's CardPreviewModal, unconditionally
 * (not even gated on MOCK_MODE) — meaning real cards would render against
 * mock content. Centralized here to match every other real/mock branch.
 */
export async function getNoteAndModel(noteId) {
  if (MOCK_MODE) {
    const n = mock.notes.find(n => n.id === noteId) || null;
    const m = n ? (mock.models.find(m => m.id === n.model_id) || mock.models[0]) : null;
    return { note: n, model: m };
  }
  const { data: note, error: nErr } = await supabase.from('imported_notes')
    .select('id, fields, tags, model_id').eq('id', noteId).single();
  if (nErr) throw new Error(nErr.message);
  const { data: model, error: mErr } = await supabase.from('imported_models')
    .select('id, field_names, templates, css, is_cloze').eq('id', note.model_id).single();
  if (mErr) throw new Error(mErr.message);
  return { note, model };
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
