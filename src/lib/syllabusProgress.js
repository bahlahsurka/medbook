// lib/syllabusProgress.js
//
// Single source of truth for "syllabus progress" — Reviewed/Total/Coverage
// across active entries, both overall and per system — shared by Dashboard
// and Review Queue so the two screens can never show different numbers for
// the same thing.
//
// ─── Definitions (non-negotiable) ──────────────────────────────────────────
//   Total      = count of active, non-deleted entries. Entries are HARD
//                deleted in this schema (DELETE, no soft-delete column —
//                see App.js's bulkDelete/deleteEntry), so "active,
//                non-deleted" is simply every row currently present in
//                `allEntries`; nothing further to filter.
//   Reviewed   = entries with review_count > 0. review_count is an integer
//                column incremented by exactly 1 per rating in
//                ReviewQueue.js's calcNext()/SystemReview's equivalent, and
//                is NEVER reset or decremented — so "reviewed once, stays
//                reviewed permanently, regardless of later scheduling state"
//                falls out of the field's own semantics for free, with no
//                separate "ever reviewed" flag needed.
//   Unreviewed = Total - Reviewed.
//   Coverage   = Reviewed / Total * 100, kept UNROUNDED everywhere this
//                module computes or sorts by it — only formatCoveragePct()
//                rounds, and only for display.
//
// ─── Why review_count, not review_log ──────────────────────────────────────
// review_log (one row per rating, added later purely for Insights/
// retention analytics — see SUPABASE_MIGRATION_INSIGHTS.sql) looks like the
// obvious source for "has this entry ever been reviewed," but it is NOT
// authoritative: it was introduced well after review_count/last_reviewed
// already existed and were already being incremented. A direct query against
// the live database (2026-10-31) confirms the gap is large, not theoretical:
// of 787 entries with review_count > 0, 406 have ZERO review_log rows at
// all, and another 95 have fewer review_log rows than their review_count —
// i.e. the majority of already-reviewed entries predate full review_log
// coverage. review_count is the field that has been authoritatively
// incremented since review scheduling itself existed, so it — not
// review_log — is what Reviewed/Total/Coverage are computed from everywhere
// in this module. review_log is still the right (and here, the only)
// source for "first review happened today" in fetchDailyActivity() below,
// but that function has to work around the exact same gap explicitly — see
// its own comment.
//
// review_log.entry_id carries `ON DELETE CASCADE` to entries.id (confirmed
// against the live schema), so a deleted entry's review_log rows can never
// outlive it — "historical reviews of subsequently deleted entries" are
// already structurally excluded by the database itself, with nothing this
// module needs to additionally filter.

import { supabase } from './supabase';
import { SYS_COLOR } from './constants';

// Flattens the {systemName: [entries...]} shape every screen already uses
// into one deduplicated (by id) array of active entries — "globally, never
// by summing per-system counts" per the brief, so a mis-grouped or
// duplicate-keyed entry can never be double-counted in the overall figure.
export function allActiveEntries(allEntriesObj) {
  const seen = new Map();
  for (const list of Object.values(allEntriesObj || {})) {
    for (const e of list) {
      if (e && e.id != null) seen.set(e.id, e);
    }
  }
  return Array.from(seen.values());
}

// Core Reviewed/Total/Unreviewed/Coverage computation — the ONE place this
// arithmetic happens, used identically for the overall figure and for every
// system row.
export function computeProgress(list) {
  const total = list.length;
  let reviewed = 0;
  for (const e of list) if ((e.review_count || 0) > 0) reviewed++;
  const unreviewed = total - reviewed;
  const coverage = total > 0 ? (reviewed / total) * 100 : 0; // unrounded
  return { total, reviewed, unreviewed, coverage };
}

export function computeOverallProgress(allEntriesObj) {
  return computeProgress(allActiveEntries(allEntriesObj));
}

// Display-only formatter — the one place rounding/clamping happens. Returns
// null for a zero-denominator system (caller renders "No entries" instead
// of a percentage).
//
// Boundary rules (exact, per spec):
//   reviewed === 0          -> "0.0%"
//   reviewed === total       -> "100.0%"
//   rounds to 0.0 at 1dp     -> "<0.1%"   (reviewed>0 but vanishingly small)
//   rounds to 100.0 at 1dp   -> "99.9%"   (unreviewed>0, clamp below 100)
//   otherwise                -> "X.X%"
export function formatCoveragePct(reviewed, total) {
  if (total <= 0) return null;
  if (reviewed <= 0) return '0.0%';
  if (reviewed >= total) return '100.0%';
  const pct = (reviewed / total) * 100;
  let rounded = Math.round(pct * 10) / 10;
  if (rounded <= 0) return '<0.1%';
  if (rounded >= 100) rounded = 99.9;
  return `${rounded.toFixed(1)}%`;
}

const FALLBACK_COLOR = '#2563eb';

// Builds every row of the System Progress Register AND sorts it into the
// three ranked groups the brief specifies, so callers never re-implement
// the ranking/tie-breaking rules themselves.
//
//   In progress  (0 < reviewed < total): desc unreviewed, then asc coverage
//                (unrounded), then name.
//   Not started  (reviewed === 0, total > 0): desc total, then name.
//   Completed    (reviewed === total, total > 0): desc total, then name.
//   Empty        (total === 0): returned separately, never ranked/sorted
//                by coverage (there isn't one) — caller shows these muted
//                at the bottom with "No entries" or omits them.
//
// `allEntriesObj` keys that don't match any `userSystems` name are pooled
// into a single synthetic "Uncategorized" row (covers both genuinely
// unassigned entries and any stray/renamed system key), surfaced only when
// that pool is non-empty, exactly like any other system.
export function buildSystemRegister(allEntriesObj, userSystems, fallbackColor = FALLBACK_COLOR) {
  const known = new Map();
  for (const sys of (userSystems || [])) {
    known.set(sys.name, { name: sys.name, color: sys.color || SYS_COLOR[sys.name] || fallbackColor, list: [] });
  }

  const uncategorized = [];
  for (const [key, list] of Object.entries(allEntriesObj || {})) {
    if (known.has(key)) known.get(key).list.push(...list);
    else uncategorized.push(...list);
  }

  const rows = Array.from(known.values()).map(({ name, color, list }) => ({
    name, color, uncategorized: false, ...computeProgress(list),
  }));
  if (uncategorized.length > 0) {
    rows.push({ name: 'Uncategorized', color: null, uncategorized: true, ...computeProgress(uncategorized) });
  }

  const withEntries = rows.filter(r => r.total > 0);
  const empty = rows.filter(r => r.total === 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const inProgress = withEntries
    .filter(r => r.reviewed > 0 && r.reviewed < r.total)
    .sort((a, b) => (b.unreviewed - a.unreviewed) || (a.coverage - b.coverage) || a.name.localeCompare(b.name));

  const notStarted = withEntries
    .filter(r => r.reviewed === 0)
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));

  const completed = withEntries
    .filter(r => r.reviewed === r.total)
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));

  return { inProgress, notStarted, completed, empty };
}

// Flattened, render-order row list (groups concatenated in rank order) —
// convenient when a caller just wants "every row, correctly ordered,
// group boundaries included" without re-deriving it from buildSystemRegister
// itself.
export function flattenRegister(register) {
  return [
    ...register.inProgress.map(r => ({ ...r, group: 'in-progress' })),
    ...register.notStarted.map(r => ({ ...r, group: 'not-started' })),
    ...register.completed.map(r => ({ ...r, group: 'completed' })),
    ...register.empty.map(r => ({ ...r, group: 'empty' })),
  ];
}

// ─── Daily activity ─────────────────────────────────────────────────────
//
// Two numbers, deliberately never mixed with Overall Syllabus Coverage:
//   reviewedActionsToday — every rating recorded today (review_log row
//                          count), i.e. "review actions", not distinct
//                          entries.
//   firstTimeToday       — distinct ACTIVE entries whose true first-ever
//                          review happened today.
//
// SCHEMA LIMITATION — read before changing firstTimeToday's logic:
// review_log cannot, by itself, prove an entry's first-ever review date for
// any entry whose review history predates full review_log coverage (see
// this module's header comment — confirmed ~64% of already-reviewed entries
// are affected). Naively taking MIN(reviewed_at) from review_log per entry
// would misreport a long-since-reviewed entry's first POST-MIGRATION rating
// as "first reviewed today." This function closes that gap the only way
// the data allows: for each entry rated today, it also fetches that
// entry's COMPLETE review_log history and compares the row count against
// the entry's current review_count. Only when they match exactly (proof
// review_log has captured every rating this entry has ever received, with
// no pre-migration gap) does it trust review_log's MIN(reviewed_at) for
// that entry — and only counts it as "first time today" if that true
// minimum falls within today. Any entry with a gap is silently excluded
// from this count rather than guessed at, which can only ever UNDERcount,
// never overcount, "first reviewed today." A real fix (closing the gap for
// every already-reviewed entry) would need a one-time backfill migration
// inserting a synthetic review_log row — impossible to do accurately
// because first-review TIMESTAMPS for the gap entries were never recorded
// anywhere; only entries.last_reviewed (last, not first) survived.
export async function fetchDailyActivity(userId, allEntriesObj) {
  if (!userId) return { reviewedActionsToday: null, firstTimeToday: null };

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  const countRes = await supabase.from('review_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('reviewed_at', dayStartIso);
  if (countRes.error) return { reviewedActionsToday: null, firstTimeToday: null };
  const reviewedActionsToday = countRes.count || 0;

  const todayRows = await supabase.from('review_log')
    .select('entry_id').eq('user_id', userId).gte('reviewed_at', dayStartIso);
  if (todayRows.error) return { reviewedActionsToday, firstTimeToday: null };

  const candidateIds = Array.from(new Set((todayRows.data || []).map(r => r.entry_id)));
  if (candidateIds.length === 0) return { reviewedActionsToday, firstTimeToday: 0 };

  const histRes = await supabase.from('review_log')
    .select('entry_id,reviewed_at').eq('user_id', userId).in('entry_id', candidateIds);
  if (histRes.error) return { reviewedActionsToday, firstTimeToday: null };

  const perEntry = new Map();
  for (const row of histRes.data || []) {
    const agg = perEntry.get(row.entry_id) || { count: 0, min: null };
    agg.count++;
    const d = new Date(row.reviewed_at);
    if (!agg.min || d < agg.min) agg.min = d;
    perEntry.set(row.entry_id, agg);
  }

  const reviewCountById = new Map();
  for (const list of Object.values(allEntriesObj || {})) {
    for (const e of list) reviewCountById.set(e.id, e.review_count || 0);
  }

  let firstTimeToday = 0;
  for (const [entryId, agg] of perEntry) {
    const currentReviewCount = reviewCountById.get(entryId);
    if (currentReviewCount === undefined) continue; // no longer active — excluded
    if (agg.count === currentReviewCount && agg.min >= dayStart) firstTimeToday++;
  }

  return { reviewedActionsToday, firstTimeToday };
}
