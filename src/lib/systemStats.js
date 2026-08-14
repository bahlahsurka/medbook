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
      lastStudied,
    };
  });
}
