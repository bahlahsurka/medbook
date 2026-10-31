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
// in this module. review_log is still the right source for today/this-week
// activity in fetchDailyActivity() below — a reviewed-today count and a
// time-spent estimate only ever need RECENT rows, not full lifetime
// coverage, so the gap above doesn't affect them.
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

// Supabase/PostgREST caps a single request at 1000 rows (project default)
// and silently truncates past it rather than erroring — see Insights.js's
// own fetchAllRows for the first place this bit MedBook. A 7-day review_log
// window is normally nowhere near that, but a heavy/long-running account
// deserves the same safety net rather than a second, unguarded fetch path.
const PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (data) all = all.concat(data);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null };
}

// ─── Daily activity ─────────────────────────────────────────────────────
//
// Three figures, deliberately never mixed with Overall Syllabus Coverage
// (that's cumulative; these are just today):
//   reviewedActionsToday — every rating recorded today (review_log row
//                          count), i.e. "review actions", not distinct
//                          entries.
//   timeSpentTodaySeconds — active review study time today (see
//                          computeTimeSpentSeconds below for the exact
//                          schema-constrained formula).
//
// SCHEMA — why this is built from review_log.reviewed_at rather than a
// per-review duration field: review_log (user_id, entry_id, system,
// rating, reviewed_at) has no duration column, and the one table that DOES
// record a measured duration (review_sessions.duration_seconds, one row
// per finished Review Queue session) is written ONLY by ReviewQueue.js —
// SystemReview.js's per-system review modal and DetailView's single-card
// "mark reviewed" both write review_log but never review_sessions. Using
// review_sessions for Time Spent would silently undercount any review done
// outside ReviewQueue.js's own session flow. review_log, by contrast, is
// written by every review path, so reconstructing active time FROM its
// timestamps (below) is the only source that covers all of them uniformly.
export function computeTimeSpentSeconds(sortedMsTimestamps) {
  if (!sortedMsTimestamps || sortedMsTimestamps.length === 0) return 0;
  // A gap this long or longer means whatever came next is a fresh sitting,
  // not a continuation of the same one (an open tab left idle, a lunch
  // break) — so it resets the per-session baseline instead of being summed
  // in as reviewing time.
  const SESSION_GAP_SEC = 30 * 60;
  // Within one sitting, the time between two consecutive ratings is a
  // reasonable proxy for "time spent on the card that was just rated" —
  // capped so a genuinely idle gap (stepped away mid-session, phone call)
  // can't inflate the total.
  const PER_REVIEW_CAP_SEC = 90;
  // Credited once per sitting, for its first card — no preceding timestamp
  // exists to measure that one against, so without this a session's first
  // card would otherwise read as free.
  const SESSION_BASELINE_SEC = 20;

  let total = SESSION_BASELINE_SEC;
  for (let i = 1; i < sortedMsTimestamps.length; i++) {
    const gapSec = (sortedMsTimestamps[i] - sortedMsTimestamps[i - 1]) / 1000;
    total += gapSec > SESSION_GAP_SEC ? SESSION_BASELINE_SEC : Math.min(gapSec, PER_REVIEW_CAP_SEC);
  }
  return Math.round(total);
}

// "0m" / "28m" / "1h 14m" — same shape as Insights.js's own formatMinutes,
// kept as a separate copy here (not imported) since that one lives in a
// component file and takes whole minutes, not raw seconds.
export function formatTimeSpent(totalSeconds) {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export async function fetchDailyActivity(userId) {
  if (!userId) return { reviewedActionsToday: null, timeSpentTodaySeconds: null };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  const { data, error } = await fetchAllRows((from, to) =>
    supabase.from('review_log').select('reviewed_at')
      .eq('user_id', userId).gte('reviewed_at', todayStartIso)
      .order('reviewed_at', { ascending: true }).range(from, to)
  );
  if (error) return { reviewedActionsToday: null, timeSpentTodaySeconds: null };

  const todayTimestampsMs = (data || []).map(row => new Date(row.reviewed_at).getTime());

  return {
    reviewedActionsToday: todayTimestampsMs.length,
    timeSpentTodaySeconds: computeTimeSpentSeconds(todayTimestampsMs),
  };
}
