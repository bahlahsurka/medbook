import { computeProgress, formatCoveragePct, buildSystemRegister, allActiveEntries, computeOverallProgress,
  computeTimeSpentSeconds, formatTimeSpent } from '../lib/syllabusProgress';
import { ensureDarkContrastFloor, barFillGradient } from '../lib/colorContrast';

describe('syllabusProgress — targeted verification', () => {
  test('formatCoveragePct boundary cases', () => {
    expect(formatCoveragePct(0, 10)).toBe('0.0%');
    expect(formatCoveragePct(10, 10)).toBe('100.0%');
    expect(formatCoveragePct(1, 100000)).toBe('<0.1%');
    expect(formatCoveragePct(1, 800)).toBe('0.1%');
    expect(formatCoveragePct(9999, 10000)).toBe('99.9%');
    expect(formatCoveragePct(999, 1000)).toBe('99.9%');
    expect(formatCoveragePct(0, 0)).toBe(null);
    expect(formatCoveragePct(1, 1)).toBe('100.0%');
  });

  test('computeProgress basic + empty + permanence of reviewed status', () => {
    expect(computeProgress([{ review_count:1 },{ review_count:0 },{ review_count:3 },{ review_count:0 }]))
      .toEqual({ total:4, reviewed:2, unreviewed:2, coverage:50 });
    expect(computeProgress([])).toEqual({ total:0, reviewed:0, unreviewed:0, coverage:0 });
    expect(computeProgress([{ review_count:5, next_review:null, difficulty:'Hard' }]))
      .toEqual({ total:1, reviewed:1, unreviewed:0, coverage:100 });
  });

  test('overall progress never exceeds total; deleted entries structurally excluded', () => {
    const allEntriesObj = {
      Cardiology: [{ id:'c1', system:'Cardiology', review_count:2 }, { id:'c2', system:'Cardiology', review_count:0 }],
      Neurology: [{ id:'n1', system:'Neurology', review_count:1 }],
    };
    expect(allActiveEntries(allEntriesObj)).toHaveLength(3);
    const overall = computeOverallProgress(allEntriesObj);
    expect(overall).toEqual({ total:3, reviewed:2, unreviewed:1, coverage:(2/3)*100 });
    expect(overall.reviewed).toBeLessThanOrEqual(overall.total);
  });

  test('empty systems handled safely, no NaN', () => {
    const allEntriesObj = { Cardiology: [{ id:'c1', system:'Cardiology', review_count:1 }] };
    const userSystems = [{ name:'Cardiology', color:'#111' }, { name:'Dermatology', color:'#333' }];
    const reg = buildSystemRegister(allEntriesObj, userSystems);
    expect(reg.empty.map(r=>r.name)).toEqual(['Dermatology']);
    expect(reg.empty[0].coverage).toBe(0);
    expect(Number.isNaN(reg.empty[0].coverage)).toBe(false);
  });

  test('Uncategorized row only surfaces when non-empty', () => {
    const base = { Cardiology: [{ id:'c1', system:'Cardiology', review_count:1 }] };
    const userSystems = [{ name:'Cardiology', color:'#111' }];
    const regNoStray = buildSystemRegister(base, userSystems);
    const flatNoStray = [...regNoStray.inProgress, ...regNoStray.notStarted, ...regNoStray.completed, ...regNoStray.empty];
    expect(flatNoStray.some(r => r.uncategorized)).toBe(false);

    const withStray = { ...base, 'Renamed/Deleted System': [{ id:'x1', system:'X', review_count:0 }] };
    const regStray = buildSystemRegister(withStray, userSystems);
    const flatStray = [...regStray.inProgress, ...regStray.notStarted, ...regStray.completed, ...regStray.empty];
    const row = flatStray.find(r => r.uncategorized);
    expect(row?.name).toBe('Uncategorized');
    expect(row.total).toBe(1);
  });

  test('three-tier ranking + tie-breaking rules', () => {
    const mk = (n, reviewedCount) => Array.from({length:n}, (_,i) => ({ id:`${n}-${i}`, review_count: i < reviewedCount ? 1 : 0 }));
    const rankingEntries = {
      A: mk(10, 2),   // unreviewed=8
      B: mk(10, 5),   // unreviewed=5
      Z: mk(20, 10),  // unreviewed=10
      D: mk(50, 0),   // not started, total=50
      E: mk(10, 0),   // not started, total=10
      F: mk(30, 30),  // completed, total=30
      G: mk(5, 5),    // completed, total=5
    };
    const rankingSystems = Object.keys(rankingEntries).map(name => ({ name, color:'#000' }));
    const reg = buildSystemRegister(rankingEntries, rankingSystems);
    expect(reg.inProgress.map(r=>r.name)).toEqual(['Z','A','B']);
    expect(reg.notStarted.map(r=>r.name)).toEqual(['D','E']);
    expect(reg.completed.map(r=>r.name)).toEqual(['F','G']);
  });

  test('in-progress tie-break: same unreviewed -> ascending coverage -> then name', () => {
    // H: total=10,reviewed=5 -> unreviewed=5, coverage=50
    // I: total=20,reviewed=15 -> unreviewed=5, coverage=75
    // both unreviewed=5, so ascending coverage puts H before I
    const mk = (n, reviewedCount) => Array.from({length:n}, (_,i) => ({ id:`${n}-${i}-${reviewedCount}`, review_count: i < reviewedCount ? 1 : 0 }));
    const entries = { H: mk(10,5), I: mk(20,15) };
    const systems = [{ name:'I', color:'#000' }, { name:'H', color:'#000' }];
    const reg = buildSystemRegister(entries, systems);
    expect(reg.inProgress.map(r=>r.name)).toEqual(['H','I']);
  });

  test('computeTimeSpentSeconds: empty, single card, capped gaps, session baseline', () => {
    expect(computeTimeSpentSeconds([])).toBe(0);
    // One card alone in a session -> just the 20s baseline.
    expect(computeTimeSpentSeconds([1000])).toBe(20);
    // Two cards 40s apart within one sitting -> baseline + 40s (under the 90s cap).
    expect(computeTimeSpentSeconds([0, 40_000])).toBe(60);
    // A 200s gap between two cards is capped at 90s, not counted in full.
    expect(computeTimeSpentSeconds([0, 200_000])).toBe(20 + 90);
    // A gap past the 30-minute session threshold starts a NEW session —
    // credited another 20s baseline instead of the (huge) raw gap.
    const past30Min = 31 * 60 * 1000;
    expect(computeTimeSpentSeconds([0, past30Min])).toBe(20 + 20);
  });

  test('formatTimeSpent renders 0m / Xm / Xh Ym', () => {
    expect(formatTimeSpent(0)).toBe('0m');
    expect(formatTimeSpent(28 * 60)).toBe('28m');
    expect(formatTimeSpent(59 * 60 + 40)).toBe('1h'); // 59m40s rounds to 60m = 1h
    expect(formatTimeSpent(74 * 60)).toBe('1h 14m');
    expect(formatTimeSpent(120 * 60)).toBe('2h');
  });

  test('ensureDarkContrastFloor: no-op in light mode, raises a near-invisible dark color only in dark mode', () => {
    expect(ensureDarkContrastFloor('#065f46', false)).toBe('#065f46');
    const floored = ensureDarkContrastFloor('#065f46', true);
    expect(floored).not.toBe('#065f46');
    // Already-bright colors should barely move (stay close to themselves).
    const brightFloored = ensureDarkContrastFloor('#3b82f6', true);
    expect(brightFloored.toLowerCase()).not.toBe('#000000');
  });

  test('barFillGradient returns a two-stop left-to-right gradient', () => {
    const g = barFillGradient('#dc2626', true);
    expect(g).toMatch(/^linear-gradient\(90deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/i);
  });
});
