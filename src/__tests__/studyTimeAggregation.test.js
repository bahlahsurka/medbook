// Verifies the "Today" stat added alongside the existing weekly Study Time
// number — and that both are computed consistently with each other and
// with the day-by-day chart, not by a second, parallel day-boundary
// computation that could drift from it.
import { computeStudyTime } from '../components/Insights';

// Builds the same `last7Days` shape the real component computes (local
// midnight, oldest to newest, ending on `today`) — a fixed `today` here
// instead of `new Date()` so the test is deterministic regardless of when
// it runs.
function last7DaysEndingOn(today) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

function atLocal(y, m, d, h = 12, min = 0) {
  return new Date(y, m, d, h, min, 0).toISOString();
}

describe('computeStudyTime', () => {
  const today = new Date(2026, 9, 24); // 24 Oct 2026, local midnight
  const last7Days = last7DaysEndingOn(today);

  test("today's total is exactly the sum of sessions on today's local calendar date", () => {
    const studySessions = [
      { started_at: atLocal(2026, 9, 24, 9, 0), duration_seconds: 600 },  // today, 10m
      { started_at: atLocal(2026, 9, 24, 14, 0), duration_seconds: 1200 }, // today, 20m
      { started_at: atLocal(2026, 9, 23, 23, 59), duration_seconds: 3000 }, // yesterday — must NOT count
    ];

    const { todayMinutes } = computeStudyTime(studySessions, last7Days);

    expect(todayMinutes).toBe(30); // 10m + 20m, yesterday's 50m excluded
  });

  test("today's total matches the chart's own last bucket exactly (no second, drifting computation)", () => {
    const studySessions = [
      { started_at: atLocal(2026, 9, 24, 8, 0), duration_seconds: 900 },
      { started_at: atLocal(2026, 9, 22, 8, 0), duration_seconds: 1800 },
    ];

    const { minutesByDay, todayMinutes } = computeStudyTime(studySessions, last7Days);

    expect(todayMinutes).toBe(minutesByDay[minutesByDay.length - 1]);
    expect(todayMinutes).toBe(15);
  });

  test('day-over-day percent compares today against yesterday only, not the whole week', () => {
    const studySessions = [
      { started_at: atLocal(2026, 9, 24, 9, 0), duration_seconds: 1200 }, // today: 20m
      { started_at: atLocal(2026, 9, 23, 9, 0), duration_seconds: 600 },  // yesterday: 10m
      { started_at: atLocal(2026, 9, 18, 9, 0), duration_seconds: 6000 }, // 6 days ago — irrelevant to dowPct
    ];

    const { dowPct } = computeStudyTime(studySessions, last7Days);

    expect(dowPct).toBe(100); // 20m is a 100% increase over 10m
  });

  test('day-over-day percent is null (not 0 or a crash) when yesterday had no sessions at all', () => {
    const studySessions = [
      { started_at: atLocal(2026, 9, 24, 9, 0), duration_seconds: 600 },
    ];

    const { dowPct, todayMinutes } = computeStudyTime(studySessions, last7Days);

    expect(todayMinutes).toBe(10);
    expect(dowPct).toBeNull();
  });

  test("this week's total still sums the full 7-day window, independent of the new today/dow numbers", () => {
    const studySessions = last7Days.map((day, i) => ({
      started_at: new Date(day.getTime() + 10 * 3600000).toISOString(), // 10am each day
      duration_seconds: (i + 1) * 60, // 1,2,3,4,5,6,7 minutes across the week
    }));

    const { minutesByDay, todayMinutes } = computeStudyTime(studySessions, last7Days);
    const weekTotal = minutesByDay.reduce((a, b) => a + b, 0);

    expect(weekTotal).toBe(1 + 2 + 3 + 4 + 5 + 6 + 7);
    expect(todayMinutes).toBe(7); // today is the 7th (last) day in the series
  });

  test('a session logged exactly at local midnight belongs to the day it starts, not the previous one', () => {
    const studySessions = [
      { started_at: atLocal(2026, 9, 24, 0, 0), duration_seconds: 300 },
    ];

    const { todayMinutes } = computeStudyTime(studySessions, last7Days);

    expect(todayMinutes).toBe(5);
  });
});
