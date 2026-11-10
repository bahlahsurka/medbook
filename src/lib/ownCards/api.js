// lib/ownCards/api.js
//
// Data layer for My Cards' spaced-repetition engine (Engram Stage 1).
// Deliberately a separate, small module from lib/importedDecks/api.js —
// NOT a shared one — so nothing here can ever change Imported Decks/
// Favorites behaviour (the #1 engine-decision criterion). It mirrors that
// module's rateCard/getSessionCards/getCardsByIds shape (same scheduler,
// same "freeze the id order, never re-run the selection query on resume"
// contract from studySessionStore.js) but targets the plain `flashcards`
// table, which has no deck tree — folders are just `flashcards.system`
// values, grouped client-side.
//
// SCHEMA — SUPABASE_MIGRATION_OWN_CARDS_SRS.sql added: state, due_at,
// interval_days, ease_factor, review_count, lapse_count,
// last_reviewed_at, source_entry_id on `flashcards`, plus a new
// `flashcard_review_log` table (card_id, user_id, rating,
// prev_interval_days, new_interval_days, time_spent_seconds,
// reviewed_at). Every existing row got state='new' for free from the
// column default — "existing cards start as new" per the brief, no
// separate backfill needed for that part.

import { supabase } from '../supabase';

// Same fields a rating can change, and therefore the exact snapshot Undo
// needs to restore — identical list to imported api.js's own
// SCHEDULING_FIELDS, kept as a separate copy (not shared) since the two
// tables are independent and must stay that way per the engine decision.
// (rateCard/unrateCard, which used to live here, were replaced by the
// instant-ratings outbox — see lib/ratingOutbox.js and StudySession.js's
// rate()/goPrev() — but this list is still exactly what that snapshot/
// restore needs.)
export const SCHEDULING_FIELDS = ['state', 'due_at', 'interval_days', 'ease_factor', 'review_count', 'lapse_count', 'last_reviewed_at'];

/**
 * Builds the WHERE-clause scope for a system filter. `system` is one of:
 *   undefined/null -> no system filter (every folder, including Uncategorized)
 *   { uncategorized: true } -> only cards with system IS NULL
 *   a plain string -> only cards with that exact system name
 * Kept as one small helper rather than three call sites each re-deriving
 * the same three-way branch.
 */
function applySystemScope(query, system) {
  if (!system) return query;
  if (system.uncategorized) return query.is('system', null);
  return query.eq('system', system);
}

/**
 * Due + new cards for a My Cards study session, same due-first-then-new
 * shape as imported api.js's getSessionCards, scoped to one user and
 * (optionally) one system/folder instead of a deck subtree. New cards
 * respect `newCardsPerDay` using the same "today" + review_count===1
 * convention imported decks already use for their own daily cap — see
 * that module's own comment on why this is an approximation (inferred
 * from each card's own last_reviewed_at, not a separate ledger) and why
 * that's good enough for a soft daily cap.
 */
export async function getSessionCards({ userId, system, limit = 50, newCardsPerDay = 20 } = {}) {
  const nowIso = new Date().toISOString();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  let newCap = limit;
  if (newCardsPerDay != null) {
    let doneQuery = supabase.from('flashcards').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('review_count', 1).gte('last_reviewed_at', dayStart);
    doneQuery = applySystemScope(doneQuery, system);
    const { count } = await doneQuery;
    newCap = Math.min(newCap, Math.max(0, newCardsPerDay - (count || 0)));
  }

  let dueQuery = supabase.from('flashcards').select('*').eq('user_id', userId)
    .neq('state', 'new').neq('state', 'suspended').lte('due_at', nowIso)
    .order('due_at', { ascending: true, nullsFirst: false }).limit(limit);
  dueQuery = applySystemScope(dueQuery, system);
  const { data: dueRows, error: dueErr } = await dueQuery;
  if (dueErr) throw new Error(`Due cards query failed: ${dueErr.message}`);

  let newRows = [];
  if (newCap > 0) {
    let newQuery = supabase.from('flashcards').select('*').eq('user_id', userId)
      .eq('state', 'new').order('created_at', { ascending: true }).limit(newCap);
    newQuery = applySystemScope(newQuery, system);
    const { data, error } = await newQuery;
    if (error) throw new Error(`New cards query failed: ${error.message}`);
    newRows = data || [];
  }

  return [...(dueRows || []), ...newRows].slice(0, limit);
}

/** Re-fetch current row data for a frozen set of ids — the resume half of
 *  the same contract imported api.js's getCardsByIds follows: never
 *  re-runs the selection query, only refreshes rows for ids a session
 *  already chose. Rows come back in no particular order; the caller
 *  reassembles the frozen order itself (same as StudySession already
 *  does for Imported Decks/Favorites). */
export async function getCardsByIds(cardIds) {
  if (!cardIds?.length) return [];
  const { data, error } = await supabase.from('flashcards').select('*').in('id', cardIds);
  if (error) throw new Error(error.message);
  return data || [];
}


/**
 * New/Learning/Due counts per folder, computed live from a caller-supplied
 * card list (FlashCards.js already holds the full `cards` array in memory
 * — there's no separate deck-count table to denormalize into or go stale,
 * unlike Imported Decks' due_cards column). Grouped by the SAME key
 * FlashCards.js's own `folders` memo already uses (system name, or the
 * UNCAT sentinel for null), so a caller can zip this straight onto its
 * existing folder list. "Due" means learning/review cards whose due_at
 * has already passed — a 'new' card is never "due" until first studied.
 */
export function computeFolderCounts(cards, uncatKey) {
  const nowMs = Date.now();
  const counts = {}; // key -> { new, learning, due }
  const bump = (key, field) => {
    const row = (counts[key] ||= { new: 0, learning: 0, due: 0 });
    row[field]++;
  };
  for (const c of cards || []) {
    const key = c.system || uncatKey;
    if (c.state === 'new' || !c.state) { bump(key, 'new'); continue; }
    if (c.state === 'suspended') continue;
    if (c.due_at && new Date(c.due_at).getTime() <= nowMs) bump(key, 'due');
    else if (c.state === 'learning') bump(key, 'learning');
  }
  return counts;
}

/** Overall New/Learning/Due across every folder — same shape as a single
 *  computeFolderCounts row, for "Study due (all folders)" at the top level. */
export function computeOverallCounts(cards) {
  const nowMs = Date.now();
  const row = { new: 0, learning: 0, due: 0 };
  for (const c of cards || []) {
    if (c.state === 'new' || !c.state) { row.new++; continue; }
    if (c.state === 'suspended') continue;
    if (c.due_at && new Date(c.due_at).getTime() <= nowMs) row.due++;
    else if (c.state === 'learning') row.learning++;
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Stats (Stage 2 item 4) — reads flashcard_review_log. Mirrors imported */
/* api.js's getImportedReviewStats shape (null = unavailable, same      */
/* undefined/null/real convention OwnCardsStats.js uses), scoped to My  */
/* Cards' own log table. Embeds each row's CURRENT card review_count    */
/* (a real FK, flashcard_review_log.card_id -> flashcards.id) so the    */
/* caller can filter to "cards seen >= 3 times" without a second query. */
/* ------------------------------------------------------------------ */
export async function getOwnCardsReviewStats(userId) {
  try {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [{ count, error: countErr }, { data: rows, error: rowsErr }] = await Promise.all([
      supabase.from('flashcard_review_log').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('flashcard_review_log')
        .select('rating, reviewed_at, flashcards!inner(review_count)')
        .eq('user_id', userId).gte('reviewed_at', since).order('reviewed_at', { ascending: true }),
    ]);
    if (countErr || rowsErr) throw (countErr || rowsErr);
    return {
      totalAllTime: count || 0,
      rows: (rows || []).map(r => ({ rating: r.rating, reviewed_at: r.reviewed_at, cardReviewCount: r.flashcards?.review_count ?? 0 })),
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[getOwnCardsReviewStats] unavailable, Stats screen will show its empty state', err.message);
    }
    return null;
  }
}

/**
 * Weak spots (Stage 3 item 9) — systems ranked by retention, weakest
 * first, restricted to systems with at least `minReviews` graded ratings
 * (a system with only a handful of reviews would rank as "weak" or
 * "strong" almost at random — not meaningful enough to act on). Reuses
 * the same `flashcards!inner` embed getOwnCardsReviewStats already uses
 * to pull each log row's card system, rather than a second join shape.
 * No time window — unlike the 90-day stats sample, "which systems am I
 * actually weak in" should reflect the whole history, not just recently.
 */
export async function getWeakSpots(userId, minReviews) {
  try {
    const { data, error } = await supabase.from('flashcard_review_log')
      .select('rating, flashcards!inner(system)')
      .eq('user_id', userId);
    if (error) throw error;
    const bySystem = {};
    (data || []).forEach(r => {
      const system = r.flashcards?.system || null;
      if (system == null) return; // Uncategorized isn't a "system" to rank
      const row = (bySystem[system] ||= { system, total: 0, good: 0 });
      row.total++;
      if (r.rating === 'good' || r.rating === 'easy') row.good++;
    });
    return Object.values(bySystem)
      .filter(r => r.total >= minReviews)
      .map(r => ({ system: r.system, total: r.total, retentionPct: Math.round((r.good / r.total) * 100) }))
      .sort((a, b) => a.retentionPct - b.retentionPct || b.total - a.total);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[getWeakSpots] unavailable', err.message);
    }
    return [];
  }
}

/**
 * How many cards are due on each of the next `days` calendar days
 * (today..+days-1) — a flat count per day, not cumulative. Anything
 * already overdue is bucketed into "today" (day 0): the forecast is
 * about workload per day, and an overdue card's workload lands the
 * moment you'd actually study it (today), not on whatever day it was
 * originally due.
 */
export async function getDueForecast(userId, days = 7) {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const horizon = new Date(todayStart.getTime() + days * 86400_000);
  const buckets = new Array(days).fill(0);
  const { data, error } = await supabase.from('flashcards')
    .select('due_at').eq('user_id', userId)
    .neq('state', 'new').neq('state', 'suspended')
    .not('due_at', 'is', null).lte('due_at', horizon.toISOString());
  if (error) return buckets;
  (data || []).forEach(r => {
    const dayIdx = Math.max(0, Math.floor((new Date(r.due_at).getTime() - todayStart.getTime()) / 86400_000));
    if (dayIdx < days) buckets[dayIdx]++;
  });
  return buckets;
}
