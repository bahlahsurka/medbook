// components/StatsCharts.js
//
// Small presentational chart pieces shared between ImportedStats.js
// (Imported Decks/Favorites) and OwnCardsStats.js (My Cards) — Engram
// Stage 2 item 4 asks for "same visual language as ImportedStats, reuse/
// extend it if clean." Extracted verbatim from ImportedStats.js (pure
// functions/components, no behavior change there) rather than duplicated,
// so the two stats screens can never visually drift apart from each
// other. Each piece takes its own theme/data as props — neither knows
// which screen it's rendered from.

import { useState, useRef } from 'react';

/** Consecutive days with >=1 review, walking back from today. Today not
 *  having a review yet doesn't zero an in-progress streak (the day isn't
 *  over) — it only breaks once yesterday is also missing. */
export function computeStreak(activeDaySet) {
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

/** One series, one hue (t.accent) — no categorical palette question here. */
export function TrendChart({ t, values, dayLabels, width = 100, height = 56 }) {
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
  const gradId = 'mb-stats-grad';

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

export function RetentionRing({ t, pct, size = 84, stroke = 7 }) {
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

/** Small 7-bar forecast — how many cards are due on each of the next 7
 *  days (today..+6). A different shape from TrendChart (bars, not a
 *  smoothed line) since "how many are coming due" reads better as
 *  discrete daily buckets than a continuous trend. */
export function DueForecastBars({ t, values, dayLabels, height = 56 }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
          <div title={`${dayLabels[i]}: ${v} due`} style={{
            width: '100%', minHeight: v > 0 ? 3 : 1,
            height: `${Math.max(v > 0 ? 6 : 1, (v / max) * (height - 18))}px`,
            background: v > 0 ? t.accent : t.surface3, borderRadius: 3,
          }} />
          <div style={{ fontSize: 9.5, color: t.text4, fontWeight: 600 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}
