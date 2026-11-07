// components/OwnCardsStats.js
//
// Engram Stage 2 item 4 — "Stats for My Cards. Same visual language as
// ImportedStats (reuse/extend it if clean)." The chart pieces themselves
// (TrendChart/RetentionRing/computeStreak) now live in StatsCharts.js,
// extracted from ImportedStats.js so both screens share one
// implementation rather than two drifting copies. This file is the
// My-Cards-specific data (flashcard_review_log via lib/ownCards/api.js)
// and the two pieces ImportedStats doesn't have: a 7-day due forecast,
// and retention scoped to "cards seen >= 3 times" rather than a weekly
// window (My Cards' own brief asks for the former explicitly).

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../lib/theme';
import * as ownCardsApi from '../lib/ownCards/api';
import { computeStreak, TrendChart, RetentionRing, DueForecastBars } from './StatsCharts';

// Cards need at least this many graded reviews before their ratings count
// toward retention — a card rated once or twice is too early to say
// anything meaningful about how well it's actually being retained.
const MATURE_THRESHOLD = 3;

function useOwnCardsStatsData(userId) {
  const [stats, setStats] = useState(undefined); // undefined=loading, null=unavailable, else real
  const [forecast, setForecast] = useState(null); // 7-element array, or null while loading
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    ownCardsApi.getOwnCardsReviewStats(userId).then(s => { if (!cancelled) setStats(s); });
    ownCardsApi.getDueForecast(userId, 7).then(f => { if (!cancelled) setForecast(f); });
    return () => { cancelled = true; };
  }, [userId]);
  return { stats, forecast };
}

const RATING_META = {
  again: { label: 'Again', tokenKey: 'danger' },
  hard: { label: 'Hard', tokenKey: 'warn' },
  good: { label: 'Good', tokenKey: 'ok' },
  easy: { label: 'Easy', tokenKey: 'accent' },
};

export default function OwnCardsStats({ userId, onExit }) {
  const { t } = useTheme();
  const { stats, forecast } = useOwnCardsStatsData(userId);

  const last7Days = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d); }
    return days;
  }, []);

  const next7Days = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(today); d.setDate(d.getDate() + i); days.push(d); }
    return days;
  }, []);

  const derived = useMemo(() => {
    if (!stats) return null;
    const { rows, totalAllTime } = stats;

    const countByDay = last7Days.map(day => {
      const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);
      return rows.filter(r => { const d = new Date(r.reviewed_at); return d >= day && d < dayEnd; }).length;
    });

    const activeDaySet = new Set();
    rows.forEach(r => { const d = new Date(r.reviewed_at); d.setHours(0, 0, 0, 0); activeDaySet.add(d.getTime()); });
    const streak = computeStreak(activeDaySet);

    // Retention — "% Good/Easy among cards seen >= 3 times" (Stage 1's
    // own item 4 wording, no time window given) — scored over every
    // rating in the lookback whose card had already reached the mature
    // threshold at the moment of that rating, not just this week's.
    const matureRows = rows.filter(r => r.cardReviewCount >= MATURE_THRESHOLD);
    const retentionPct = matureRows.length
      ? Math.round((matureRows.filter(r => r.rating === 'good' || r.rating === 'easy').length / matureRows.length) * 100)
      : null;

    const breakdown = { again: 0, hard: 0, good: 0, easy: 0 };
    rows.forEach(r => { if (breakdown[r.rating] != null) breakdown[r.rating]++; });

    return { totalAllTime, countByDay, streak, retentionPct, matureCount: matureRows.length, breakdown, hasAnyData: rows.length > 0 };
  }, [stats, last7Days]);

  const card = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
    padding: 18, boxShadow: `0 1px 2px ${t.shadow}` };
  const capLabel = { fontSize: 11, color: t.text4, letterSpacing: .6, fontWeight: 700, textTransform: 'uppercase' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>My Cards — Study Stats</div>
          <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>How My Cards studying is actually going.</div>
        </div>
        <button onClick={onExit} style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text2,
          borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'Inter,sans-serif' }}>
          ← Back
        </button>
      </div>

      {stats === undefined && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: t.text4, fontSize: 13 }}>Loading stats…</div>
      )}

      {stats === null && (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
          <div style={{ fontSize: 14, color: t.text3 }}>Stats aren't available right now.</div>
        </div>
      )}

      {derived && !derived.hasAnyData && (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
          <div style={{ fontSize: 14, color: t.text3 }}>No reviews logged yet. Study a folder to see stats here.</div>
        </div>
      )}

      {derived && derived.hasAnyData && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={capLabel}>Current streak</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: t.text, marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {derived.streak > 0 && '🔥'} {derived.streak} <span style={{ fontSize: 14, fontWeight: 500, color: t.text3 }}>day{derived.streak === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div style={card}>
              <div style={capLabel}>Total reviews</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: t.text, marginTop: 6 }}>
                {derived.totalAllTime.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Reviews: last 7 days</div>
            <TrendChart t={t} values={derived.countByDay}
              dayLabels={last7Days.map(d => d.toLocaleDateString('en-GB', { weekday: 'short' }))} />
            <div style={{ display: 'flex', marginTop: 8 }}>
              {last7Days.map((d, i) => (
                <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: t.text4 }}>
                  {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Retention — cards reviewed {MATURE_THRESHOLD}+ times</div>
            {derived.retentionPct == null ? (
              <div style={{ fontSize: 13, color: t.text4, padding: '8px 0' }}>No cards have reached {MATURE_THRESHOLD} reviews yet.</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <RetentionRing t={t} pct={derived.retentionPct} />
                <div style={{ fontSize: 12, color: t.text4, maxWidth: 260, lineHeight: 1.5 }}>
                  Share of ratings that were Good or Easy, among the {derived.matureCount} rating{derived.matureCount === 1 ? '' : 's'} on cards you've already reviewed {MATURE_THRESHOLD}+ times.
                </div>
              </div>
            )}
          </div>

          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Due forecast — next 7 days</div>
            {forecast == null ? (
              <div style={{ fontSize: 13, color: t.text4, padding: '8px 0' }}>Loading…</div>
            ) : (
              <DueForecastBars t={t} values={forecast}
                dayLabels={next7Days.map((d, i) => i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' }))} />
            )}
          </div>

          <div style={card}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Rating breakdown: last 90 days</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
              {Object.entries(RATING_META).map(([key, meta]) => (
                <div key={key} style={{ background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 8,
                  padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t[meta.tokenKey], margin: '0 auto 6px' }} />
                  <div style={{ fontSize: 18, fontWeight: 700, color: t.text }}>{derived.breakdown[key]}</div>
                  <div style={{ fontSize: 11.5, color: t.text3, fontWeight: 600, marginTop: 2 }}>{meta.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
