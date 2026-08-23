// components/ImportedDecks/ImportedStats.js
//
// Streak / retention / reviews-per-day for Imported Decks — the thing
// missing that made the whole feature feel incomplete once due_cards
// itself was fixed: per-deck new/due numbers say what's LEFT to do, not
// how studying is actually going over time. Reads imported_review_log
// (SUPABASE_MIGRATION_IMPORTED_REVIEW_LOG.sql), one row per rating,
// written by api.rateCard(). Mirrors Insights.js's real/sample-data
// pattern (undefined=loading, null=unavailable, object=real) but scoped
// to imported-deck ratings only — imported decks have no "system" concept
// to blend into that page's existing per-system breakdowns.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';

function useImportedStatsData(userId) {
  const [stats, setStats] = useState(undefined); // undefined=loading, null=unavailable, else real
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.getImportedReviewStats(userId).then(s => { if (!cancelled) setStats(s); });
    return () => { cancelled = true; };
  }, [userId]);
  return stats;
}

// Consecutive days with >=1 review, walking back from today. Today not
// having a review yet doesn't zero an in-progress streak (the day isn't
// over) — it only breaks once yesterday is also missing.
function computeStreak(activeDaySet) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cursor = new Date(today);
  if (!activeDaySet.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activeDaySet.has(cursor.getTime())) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

// One series (reviews/day), one hue (t.accent) — no categorical palette
// question here, matching the app's existing Insights.js trend chart.
function TrendChart({ t, values, dayLabels, width = 100, height = 56 }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const max = Math.max(...values, 1);
  const padY = 6;
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: padY + (1 - v / max) * (height - padY * 2),
  }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;
  const gradId = 'mb-imported-stats-grad';

  const nearestIdx = (clientX) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * width;
    let nearest = 0, nearestDist = Infinity;
    points.forEach((p, i) => { const d = Math.abs(p.x - relX); if (d < nearestDist) { nearestDist = d; nearest = i; } });
    return nearest;
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={(e) => setHoverIdx(nearestIdx(e.clientX))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => { if (e.touches[0]) setHoverIdx(nearestIdx(e.touches[0].clientX)); }}
        onTouchEnd={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.accent} stopOpacity="0.18" />
            <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={t.accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        {hoverIdx !== null && (
          <>
            <line x1={points[hoverIdx].x} y1={padY} x2={points[hoverIdx].x} y2={height}
              stroke={t.border} strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
            <circle cx={points[hoverIdx].x} cy={points[hoverIdx].y} r="3"
              fill={t.accent} stroke={t.surface} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hoverIdx !== null && (
        <div style={{
          position: 'absolute', top: -4, pointerEvents: 'none',
          left: `clamp(4px, ${(points[hoverIdx].x / width) * 100}%, calc(100% - 4px))`,
          transform: hoverIdx === 0 ? 'translate(0,-100%)'
            : hoverIdx === values.length - 1 ? 'translate(-100%,-100%)' : 'translate(-50%,-100%)',
          background: t.text, color: t.appBg, fontSize: 11, fontWeight: 600,
          padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap', boxShadow: `0 4px 16px ${t.shadowStrong}` }}>
          {dayLabels[hoverIdx]} · {values[hoverIdx]} review{values[hoverIdx] === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function RetentionRing({ t, pct, size = 84, stroke = 7 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={t.surface3} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={t.accent} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .4s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, fontWeight: 700, color: t.text }}>
        {pct}%
      </div>
    </div>
  );
}

const RATING_META = {
  // Reuses the exact colors the rating buttons themselves already use
  // throughout Study/Browse — recognizable, not a new palette. Each tile
  // is always text-labeled (name + count), so identity never depends on
  // telling the colors apart by eye — the label does that unambiguously.
  again: { label: 'Again', tokenKey: 'danger' },
  hard: { label: 'Hard', tokenKey: 'warn' },
  good: { label: 'Good', tokenKey: 'ok' },
  easy: { label: 'Easy', tokenKey: 'accent' },
};

export default function ImportedStats({ userId, onExit }) {
  const { t } = useTheme();
  const stats = useImportedStatsData(userId);

  const last7Days = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(d); }
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

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400_000);
    const scoreOf = (list) => list.length
      ? Math.round((list.filter(r => r.rating === 'good' || r.rating === 'easy').length / list.length) * 100)
      : null;
    const thisWeekRows = rows.filter(r => new Date(r.reviewed_at) >= weekAgo);
    const lastWeekRows = rows.filter(r => { const d = new Date(r.reviewed_at); return d >= twoWeeksAgo && d < weekAgo; });
    const retentionPct = scoreOf(thisWeekRows);
    const lastRetentionPct = scoreOf(lastWeekRows);
    const retentionTrend = (retentionPct != null && lastRetentionPct != null) ? retentionPct - lastRetentionPct : null;

    const breakdown = { again: 0, hard: 0, good: 0, easy: 0 };
    rows.forEach(r => { if (breakdown[r.rating] != null) breakdown[r.rating]++; });

    return { totalAllTime, countByDay, streak, retentionPct, retentionTrend, breakdown, hasAnyData: rows.length > 0 };
  }, [stats, last7Days]);

  const card = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
    padding: 18, boxShadow: `0 1px 2px ${t.shadow}` };
  const capLabel = { fontSize: 11, color: t.text4, letterSpacing: .6, fontWeight: 700, textTransform: 'uppercase' };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>Study Stats</div>
          <div style={{ fontSize: 13, color: t.text3, marginTop: 2 }}>How Imported Decks studying is actually going.</div>
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
          <div style={{ fontSize: 14, color: t.text3, marginBottom: 6 }}>Stats aren't set up on this database yet.</div>
          <div style={{ fontSize: 13, color: t.text4 }}>
            Run SUPABASE_MIGRATION_IMPORTED_REVIEW_LOG.sql in Supabase, then rate a few cards to see this fill in.
          </div>
        </div>
      )}

      {derived && !derived.hasAnyData && (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
          <div style={{ fontSize: 14, color: t.text3 }}>No reviews logged yet — study a deck to see stats here.</div>
        </div>
      )}

      {derived && derived.hasAnyData && (
        <>
          {/* Streak + all-time total — the two headline numbers */}
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

          {/* Reviews per day */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Reviews — last 7 days</div>
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

          {/* Retention */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Retention this week</div>
            {derived.retentionPct == null ? (
              <div style={{ fontSize: 13, color: t.text4, padding: '8px 0' }}>Not enough reviews this week yet.</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <RetentionRing t={t} pct={derived.retentionPct} />
                <div>
                  {derived.retentionTrend == null ? (
                    <span style={{ fontSize: 12, color: t.text4 }}>Not enough history for a trend yet</span>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 600, color: derived.retentionTrend >= 0 ? t.ok : t.danger }}>
                      {derived.retentionTrend >= 0 ? '↑' : '↓'} {Math.abs(derived.retentionTrend)}% vs last week
                    </span>
                  )}
                  <div style={{ fontSize: 12, color: t.text4, marginTop: 4, maxWidth: 220, lineHeight: 1.5 }}>
                    Share of ratings this week that were Good or Easy.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Rating breakdown — last 90 days, always text-labeled */}
          <div style={card}>
            <div style={{ ...capLabel, marginBottom: 10 }}>Rating breakdown — last 90 days</div>
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
