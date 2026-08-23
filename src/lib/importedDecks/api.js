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
import { scheduler } from '../srs/Scheduler';

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

// Columns from SUPABASE_MIGRATION_STUDY_CONTROLS.sql — attempt them, and if
// the migration hasn't been run yet (42703, undefined_column) retry without
// them rather than surfacing a hard error, same defensive pattern due_cards
// already used for exactly this kind of schema gap.
const DECK_COLUMNS = 'id, parent_id, full_name, display_name, is_root, total_cards, new_cards, due_cards, archived, new_cards_per_day, max_reviews_per_day';
const DECK_COLUMNS_FALLBACK = 'id, parent_id, full_name, display_name, is_root, total_cards, new_cards, archived';
function applyDeckColumnFallback(rows) {
  (rows || []).forEach(d => { d.due_cards = null; d.new_cards_per_day = null; d.max_reviews_per_day = null; });
}

/**
 * due_cards is the one denormalized count that goes stale from time alone,
 * not just from writes — a card rated "Again" isn't due yet the instant
 * it's rated (its due_at is 6 minutes out), but genuinely IS due six
 * minutes later even though nothing ever wrote to the deck row in between.
 * Reading the stored column straight (like total_cards/new_cards, which
 * only ever change via an explicit rating/reset/import that already
 * refreshes them) meant a deck's "due" count — and the Study button, which
 * disables itself when both new_cards and due_cards read 0 — could get
 * stuck showing 0 forever once its new cards ran out, no matter how much
 * time passed or how many cards were actually overdue. Anki itself always
 * computes "due" live rather than caching it; this does the same, on every
 * deck-list read, overwriting whatever the stored column says.
 */
async function liveDueCounts(userId) {
  const nowIso = new Date().toISOString();
  const [{ data: decks }, { data: dueCards }] = await Promise.all([
    supabase.from('imported_decks').select('id, parent_id').eq('user_id', userId),
    supabase.from('imported_cards').select('deck_id').eq('user_id', userId)
      .in('state', ['learning', 'review']).lte('due_at', nowIso),
  ]);
  const childrenOf = {};
  (decks || []).forEach(d => { (childrenOf[d.parent_id] ||= []).push(d.id); });
  const direct = {};
  (dueCards || []).forEach(c => { direct[c.deck_id] = (direct[c.deck_id] || 0) + 1; });
  const memo = {};
  function rollup(id) {
    if (memo[id] != null) return memo[id];
    let sum = direct[id] || 0;
    for (const childId of (childrenOf[id] || [])) sum += rollup(childId);
    return (memo[id] = sum);
  }
  const out = {};
  (decks || []).forEach(d => { out[d.id] = rollup(d.id); });
  return out;
}

/** Overwrites each row's due_cards with a live count; leaves the stored
 *  value in place (rather than erroring the whole deck list) if the live
 *  computation itself fails for some reason. */
async function withLiveDueCounts(userId, rows) {
  try {
    const live = await liveDueCounts(userId);
    (rows || []).forEach(d => { if (d.id in live) d.due_cards = live[d.id]; });
  } catch (err) {
    // Was a bare silent catch — exactly the anti-pattern that made the
    // original due_cards bug take multiple rounds to diagnose. If the live
    // count fails, the deck list falls back to the stale stored value
    // (still better than a broken page), but that fallback should never be
    // invisible — it's supposed to be rare, and "still shows the same old
    // 0" is precisely what silently landing on the fallback path looks
    // like from the outside.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[withLiveDueCounts] live due-count query failed, falling back to stale stored due_cards', err.message);
    }
  }
  return rows;
}

export async function getRootDecks(userId) {
  if (MOCK_MODE) return mock.rootDecks();

  let { data, error } = await supabase.from('imported_decks')
    .select(DECK_COLUMNS)
    .eq('user_id', userId).is('parent_id', null).eq('archived', false)
    .order('display_name');
  if (error?.code === '42703') {
    ({ data, error } = await supabase.from('imported_decks')
      .select(DECK_COLUMNS_FALLBACK)
      .eq('user_id', userId).is('parent_id', null).eq('archived', false)
      .order('display_name'));
    applyDeckColumnFallback(data);
  }
  if (error) throw new Error(error.message);
  return withLiveDueCounts(userId, data || []);
}

export async function getChildDecks(userId, parentId) {
  if (MOCK_MODE) return mock.childDecksOf(parentId);

  let { data, error } = await supabase.from('imported_decks')
    .select(DECK_COLUMNS)
    .eq('user_id', userId).eq('parent_id', parentId).eq('archived', false)
    .order('display_name');
  if (error?.code === '42703') {
    ({ data, error } = await supabase.from('imported_decks')
      .select(DECK_COLUMNS_FALLBACK)
      .eq('user_id', userId).eq('parent_id', parentId).eq('archived', false)
      .order('display_name'));
    applyDeckColumnFallback(data);
  }
  if (error) throw new Error(error.message);
  return withLiveDueCounts(userId, data || []);
}

/**
 * Read/write a deck's own new-cards/max-reviews daily caps (null = no
 * cap — the default, so existing decks are unaffected until someone
 * actually opens Deck Options). Applied to whichever node a study session
 * is started from; see getSessionCards for how "already done today" gets
 * counted against these.
 */
export async function updateDeckOptions(deckId, { newCardsPerDay, maxReviewsPerDay }) {
  if (MOCK_MODE) return;
  const { error } = await supabase.from('imported_decks')
    .update({ new_cards_per_day: newCardsPerDay, max_reviews_per_day: maxReviewsPerDay })
    .eq('id', deckId);
  if (error) {
    if (error.code === '42703') {
      throw new Error('Deck Options aren’t set up on this database yet (run SUPABASE_MIGRATION_STUDY_CONTROLS.sql).');
    }
    throw new Error(error.message);
  }
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
 * cards/notes/media/tags/hierarchy untouched. `deckId` can be ANY node
 * (root or a sub-deck — Reset Progress is offered at every depth, same as
 * Rename/Archive/Delete), so this expands to the full descendant subtree
 * and filters cards by deck_id directly, same fix as browseCards/
 * getSessionCards — filtering via imported_notes.root_deck_id would only
 * ever be correct when `deckId` already IS the true root.
 */
export async function resetDeckProgress(deckId, userId) {
  if (MOCK_MODE) return;
  const deckIds = await collectDescendantDeckIds(userId, deckId);
  const { error } = await supabase.from('imported_cards')
    .update({ state: 'new', due_at: null, interval_days: 0, ease_factor: 2.5, review_count: 0, lapse_count: 0 })
    .in('deck_id', deckIds);
  if (error) throw new Error(error.message);
  // Every card in the subtree just moved back to 'new' — recompute the
  // whole subtree's counts rather than walking up from one leaf, since
  // there's no single leaf here.
  await refreshDeckCountsForSubtree(deckId, userId);
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

export async function browseCards(deckId, { search, state, tag, flag, page = 0, pageSize = PAGE_SIZE, userId } = {}) {
  if (MOCK_MODE) return mock.browseCards({ deckId, search, state, tag, flag, page, pageSize });

  // `deckId` is whichever node the user is browsing (root or any sub-deck)
  // — expand to its full subtree first (see collectDescendantDeckIds), then
  // query cards directly by deck_id. Embed imported_notes (a real FK,
  // imported_cards_note_id_fkey) in the same round trip for search/tag
  // filtering AND the preview text — cards carry no text of their own.
  const deckIds = await collectDescendantDeckIds(userId, deckId);

  // `flag` is a SUPABASE_MIGRATION_STUDY_CONTROLS.sql column — same 42703
  // fallback pattern as DECK_COLUMNS above, since Browse loads automatically
  // (not an opt-in action) and must keep working for every user until that
  // migration has actually been run against the live database.
  const buildQuery = (withFlag) => {
    const cols = withFlag
      ? 'id, deck_id, note_id, state, due_at, flag, imported_notes!inner(sort_field, fields, tags)'
      : 'id, deck_id, note_id, state, due_at, imported_notes!inner(sort_field, fields, tags)';
    let q = supabase.from('imported_cards').select(cols, { count: 'exact' }).in('deck_id', deckIds);
    if (state) q = q.eq('state', state);
    if (withFlag && flag != null) q = q.eq('flag', flag);
    if (search?.trim()) q = q.ilike('imported_notes.sort_field', `%${search.trim()}%`);
    if (tag) q = q.contains('imported_notes.tags', [tag]);
    return q.range(page * pageSize, page * pageSize + pageSize - 1);
  };

  let { data, error, count } = await buildQuery(true);
  if (error?.code === '42703') {
    ({ data, error, count } = await buildQuery(false));
  }
  if (error) throw new Error(error.message);
  const rows = (data || []).map(({ imported_notes, ...c }) => ({
    ...c, flag: c.flag ?? 0, sort_field: imported_notes?.sort_field, fields: imported_notes?.fields, tags: imported_notes?.tags,
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

  // Per-day caps (SUPABASE_MIGRATION_STUDY_CONTROLS.sql) live on whichever
  // node was actually clicked to study — deckIds[0] in practice
  // (StudySession.js always passes a single id). A cap set on a parent
  // covers the whole session pulled from beneath it; sub-deck-level
  // overrides aren't layered in on top of it — a deliberate simplification
  // vs. Anki's real per-child aggregation, not an oversight.
  let newLimit = null, reviewLimit = null;
  if (deckIds[0]) {
    const { data: node } = await supabase.from('imported_decks')
      .select('new_cards_per_day, max_reviews_per_day').eq('id', deckIds[0]).maybeSingle();
    newLimit = node?.new_cards_per_day ?? null;
    reviewLimit = node?.max_reviews_per_day ?? null;
  }

  const nowIso = new Date().toISOString();
  let newCap = limit, reviewCap = limit;

  if (newLimit != null || reviewLimit != null) {
    // "Today" = the studying browser's own local calendar day — computed
    // here, not stored, so it always matches whoever's actually studying
    // rather than depending on a stored timezone. Approximate by design:
    // there's no separate per-rating log for imported cards (unlike the
    // main app's review_log), so "done today" is inferred from each
    // card's OWN last_reviewed_at/review_count — a card rated twice in
    // one day only shows its latest timestamp, so a rare multi-rating
    // binge on the same card could undercount slightly. Good enough for
    // a soft daily cap; not a ledger.
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    if (newLimit != null) {
      const { count } = await supabase.from('imported_cards').select('*', { count: 'exact', head: true })
        .in('deck_id', allDeckIds).eq('review_count', 1).gte('last_reviewed_at', dayStart);
      newCap = Math.min(newCap, Math.max(0, newLimit - (count || 0)));
    }
    if (reviewLimit != null) {
      const { count } = await supabase.from('imported_cards').select('*', { count: 'exact', head: true })
        .in('deck_id', allDeckIds).gt('review_count', 1).gte('last_reviewed_at', dayStart);
      reviewCap = Math.min(reviewCap, Math.max(0, reviewLimit - (count || 0)));
    }
  }

  // Due and new pulled separately so each can respect its own (possibly
  // capped) limit independently, then combined due-first-then-new and
  // trimmed to the session's overall `limit` — same effective order as a
  // single combined query when no caps are set (reviewCap/newCap both
  // just equal `limit`), since the trailing slice does the real work.
  let dueRows = [];
  if (reviewCap > 0) {
    const { data, error } = await supabase.from('imported_cards').select('*')
      .in('deck_id', allDeckIds).neq('state', 'new').neq('state', 'suspended')
      .lte('due_at', nowIso)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(reviewCap);
    if (error) throw new Error(`Due cards query failed: ${error.message}`);
    dueRows = data || [];
  }

  let newRows = [];
  if (newCap > 0) {
    const { data, error } = await supabase.from('imported_cards').select('*')
      .in('deck_id', allDeckIds).eq('state', 'new')
      .limit(newCap);
    if (error) throw new Error(`New cards query failed: ${error.message}`);
    newRows = data || [];
  }

  return [...dueRows, ...newRows].slice(0, limit);
}

/**
 * Set (or clear, with 0) a card's flag — Anki's 7-color flag system,
 * SUPABASE_MIGRATION_STUDY_CONTROLS.sql. Independent of rating/scheduling:
 * flagging a card never touches state/due_at/review_count, so unlike
 * rateCard() there's no deck-count refresh to fire here.
 */
export async function setCardFlag(cardId, flag) {
  if (MOCK_MODE) {
    const existing = mock.cards.find(c => c.id === cardId);
    if (existing) existing.flag = flag; // mutate in place so a later browseCards() re-query sees it
    return { ...existing, id: cardId, flag };
  }
  const { data, error } = await supabase.from('imported_cards')
    .update({ flag }).eq('id', cardId).select().single();
  if (error) {
    if (error.code === '42703') {
      throw new Error('Flags aren’t set up on this database yet (run SUPABASE_MIGRATION_STUDY_CONTROLS.sql).');
    }
    throw new Error(error.message);
  }
  return data;
}

/** Persist a rating via the existing scheduler — no interval math here. */
export async function rateCard(card, rating) {
  const patch = scheduler.calculateNextReview(card, rating);
  if (MOCK_MODE) return { ...card, ...patch };
  const { data, error } = await supabase.from('imported_cards')
    .update(patch).eq('id', card.id).select().single();
  if (error) throw new Error(error.message);
  // Fire-and-forget: the denormalized total/new/due_cards on imported_decks
  // (what DeckBrowser actually renders — it never scans imported_cards
  // itself) only ever got recomputed by the import pipeline. A rating
  // changes a card's state/due_at without going anywhere near that, so
  // counts silently went stale the moment anyone actually studied. Not
  // awaited: refreshing counts shouldn't add latency to flipping cards,
  // and a failure here shouldn't block a rating that already saved fine.
  refreshDeckCountsAfterRating(card.deck_id).catch(() => {});
  // Same fire-and-forget spirit as the count refresh above, and the same
  // pattern ReviewQueue.js already uses for the main app's review_log:
  // supplementary stats, never allowed to block or fail a rating that
  // already saved. SUPABASE_MIGRATION_IMPORTED_REVIEW_LOG.sql — powers the
  // Stats screen (streak/retention/reviews-per-day); nothing else reads it.
  supabase.from('imported_review_log').insert({
    user_id: card.user_id, card_id: card.id, deck_id: card.deck_id, rating,
  }).then(({ error: logError }) => {
    if (logError && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[rateCard] imported_review_log insert failed — has SUPABASE_MIGRATION_IMPORTED_REVIEW_LOG.sql been run?', logError.message);
    }
  });
  return data;
}

/** Direct (own, not rolled-up) total/new/due for exactly one deck node. */
async function directDeckCounts(id, nowIso = new Date().toISOString()) {
  const { count: total } = await supabase.from('imported_cards')
    .select('*', { count: 'exact', head: true }).eq('deck_id', id);
  const { count: newCount } = await supabase.from('imported_cards')
    .select('*', { count: 'exact', head: true }).eq('deck_id', id).eq('state', 'new');
  const { count: dueCount } = await supabase.from('imported_cards')
    .select('*', { count: 'exact', head: true }).eq('deck_id', id)
    .in('state', ['learning', 'review']).lte('due_at', nowIso);
  return { total: total || 0, new: newCount || 0, due: dueCount || 0 };
}

/**
 * Recompute total/new/due_cards for the rated card's own deck, then roll
 * that up through every ancestor to the root — same rollup shape as
 * refreshDeckCounts in api/import-process.mjs, just scoped to one branch
 * of the tree (walking up from a single leaf) instead of every deck a
 * full import touches, since a single rating only ever moves one card.
 */
async function refreshDeckCountsAfterRating(deckId) {
  const nowIso = new Date().toISOString();
  let id = deckId;
  const own = await directDeckCounts(id, nowIso);
  await supabase.from('imported_decks')
    .update({ total_cards: own.total, new_cards: own.new, due_cards: own.due }).eq('id', id);

  // Walk up: each ancestor = its own direct count (cards filed literally on
  // it, usually 0 for an aggregate node) + the sum of its immediate
  // children's CURRENT stored rollups — those are already correct going
  // into this loop, either from a prior pass or because we just wrote the
  // leaf above, so this never needs to re-descend the whole subtree.
  for (;;) {
    const { data: row } = await supabase.from('imported_decks').select('parent_id').eq('id', id).single();
    const parentId = row?.parent_id;
    if (!parentId) break;
    const ownParent = await directDeckCounts(parentId, nowIso);
    const { data: kids } = await supabase.from('imported_decks')
      .select('total_cards, new_cards, due_cards').eq('parent_id', parentId);
    const sum = (kids || []).reduce((a, k) => ({
      total: a.total + (k.total_cards || 0), new: a.new + (k.new_cards || 0), due: a.due + (k.due_cards || 0),
    }), { total: 0, new: 0, due: 0 });
    const rolled = { total: ownParent.total + sum.total, new: ownParent.new + sum.new, due: ownParent.due + sum.due };
    await supabase.from('imported_decks')
      .update({ total_cards: rolled.total, new_cards: rolled.new, due_cards: rolled.due }).eq('id', parentId);
    id = parentId;
  }
}

/**
 * Full recompute for an entire subtree — every deck from `rootId` down —
 * used after an operation that can touch many cards at once (reset), where
 * walking a single leaf upward (refreshDeckCountsAfterRating) isn't enough
 * because there's no single leaf: every deck in the subtree needs its own
 * direct counts redone, then rolled up bottom-up (deepest first) so each
 * parent sums already-correct children.
 */
async function refreshDeckCountsForSubtree(rootId, userId) {
  const deckIds = await collectDescendantDeckIds(userId, rootId);
  const { data: rows } = await supabase.from('imported_decks')
    .select('id, parent_id').in('id', deckIds);
  const list = rows || [];
  const nowIso = new Date().toISOString();

  const direct = {};
  for (const d of list) direct[d.id] = await directDeckCounts(d.id, nowIso);

  const childrenOf = {};
  list.forEach(d => { (childrenOf[d.parent_id] ||= []).push(d.id); });
  const memo = {};
  function rollup(id) {
    if (memo[id]) return memo[id];
    let total = direct[id]?.total || 0, newCount = direct[id]?.new || 0, due = direct[id]?.due || 0;
    for (const childId of (childrenOf[id] || [])) {
      const c = rollup(childId);
      total += c.total; newCount += c.new; due += c.due;
    }
    return (memo[id] = { total, new: newCount, due });
  }

  for (const d of list) {
    const r = rollup(d.id);
    await supabase.from('imported_decks')
      .update({ total_cards: r.total, new_cards: r.new, due_cards: r.due }).eq('id', d.id);
  }
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
  // THE actual bug behind every card's images/audio showing "unavailable"
  // — this request never carried the Authorization header the endpoint
  // requires (imported-media-resolve.mjs 401s without one), so it never
  // once resolved anything, regardless of whether the media itself
  // imported fine or the root_deck_id scoping was correct. Every other
  // authenticated call in this file (uploadApkg, imported-blob-upload)
  // sends this same Bearer token; this one just never did.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return Object.fromEntries(filenames.map(f => [f, null]));
  const res = await fetch('/api/imported-media-resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ rootDeckId, filenames }),
  });
  if (!res.ok) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[resolveMedia] request failed', res.status, await res.text().catch(() => ''));
    }
    return Object.fromEntries(filenames.map(f => [f, null]));
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Stats — reads imported_review_log (see rateCard's insert above and  */
/* SUPABASE_MIGRATION_IMPORTED_REVIEW_LOG.sql). Nothing else reads it.  */
/* ------------------------------------------------------------------ */

/**
 * Raw log rows for the Stats screen to derive streak/retention/daily-count
 * from, plus a separate all-time total (a cheap head-count query — no
 * reason to pull potentially years of rows just to know how many there
 * are). `null` — not an error throw — means "unavailable", same
 * undefined/null/real convention Insights.js's useInsightsData already
 * uses for review_log/study_sessions: covers both "table doesn't exist
 * yet" (migration not run) and any other transient failure alike, so the
 * Stats screen has one simple "show the empty/sample state" branch rather
 * than needing to distinguish failure modes it can't act on differently.
 * 90 days is enough for a genuine streak in practice while staying a
 * bounded query — this is a display feature, not an audit log.
 */
export async function getImportedReviewStats(userId) {
  if (MOCK_MODE) return null;
  try {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [{ count, error: countErr }, { data: rows, error: rowsErr }] = await Promise.all([
      supabase.from('imported_review_log').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('imported_review_log').select('rating, reviewed_at')
        .eq('user_id', userId).gte('reviewed_at', since).order('reviewed_at', { ascending: true }),
    ]);
    if (countErr || rowsErr) throw (countErr || rowsErr);
    return { totalAllTime: count || 0, rows: rows || [] };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[getImportedReviewStats] unavailable, Stats screen will show its empty state — has SUPABASE_MIGRATION_IMPORTED_REVIEW_LOG.sql been run?', err.message);
    }
    return null;
  }
}

/**
 * TEMPORARY diagnostic snapshot — not a permanent feature, just a way to
 * see raw rows from a phone with no desktop access, to split "ratings
 * aren't persisting" from "ratings persist fine but the read side is
 * wrong" without needing Supabase's own dashboard or live tool access
 * this session. Every query here is read-only. Remove this + its one
 * caller in ImportedStats.js once the due_cards/Stats bug is confirmed
 * fixed — it's not meant to ship long-term.
 */
export async function getDebugSnapshot(userId) {
  if (MOCK_MODE) return null;
  const [cardsRes, logCountRes, logSampleRes] = await Promise.all([
    supabase.from('imported_cards')
      .select('id, deck_id, state, due_at, review_count, last_reviewed_at')
      .eq('user_id', userId).order('last_reviewed_at', { ascending: false, nullsFirst: false }).limit(5),
    supabase.from('imported_review_log').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('imported_review_log').select('*').eq('user_id', userId).order('reviewed_at', { ascending: false }).limit(5),
  ]);
  return {
    recentCards: cardsRes.data || [], recentCardsErr: cardsRes.error?.message || null,
    logCount: logCountRes.count ?? null, logCountErr: logCountRes.error?.message || null,
    logSample: logSampleRes.data || [], logSampleErr: logSampleRes.error?.message || null,
  };
}
