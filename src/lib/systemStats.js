import { SYS_COLOR } from './constants';

// Per-system rollup shared between Dashboard and Sidebar (batch 4) — pulled
// out so both read the exact same numbers rather than two components
// computing "due"/"recently studied" slightly differently over time.
// Presentation-only: reads the same entries/userSystems every screen already
// has, invents no new fields, and doesn't touch how entries are stored.
export function computeSystemStats(entries, userSystems, fallbackColor = '#2563eb') {
  const now = new Date();
  return (userSystems || []).map(s => {
    const list = entries[s.name] || [];
    const lastStudied = list.reduce((max, e) => {
      if (!e.last_reviewed) return max;
      const d = new Date(e.last_reviewed);
      return (!max || d > max) ? d : max;
    }, null);
    return {
      name: s.name,
      color: s.color || SYS_COLOR[s.name] || fallbackColor,
      count: list.length,
      reviewedCount: list.filter(e => e.review_count > 0).length,
      dueCount: list.filter(e => e.next_review && new Date(e.next_review) <= now).length,
      // Real, derived signal (used by Insights' "Needs attention" ranking) —
      // NOT a retention calculation. An entry whose interval is still sitting
      // at the SM-2 floor despite having been reviewed more than once has had
      // its interval reset at least once, which only happens on an "Again"
      // rating in calcNext() — a coarse but genuine sign of struggling recall,
      // derived from real review_count/review_interval, not fabricated.
      strugglingCount: list.filter(e => (e.review_count||0) > 1 && (e.review_interval||1) <= 1).length,
      lastStudied,
    };
  });
}
