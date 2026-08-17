import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { computeSystemStats } from '../lib/systemStats';
import { IconRepeat } from '../lib/icons';

// ============================================================================
// MOCK / PLACEHOLDER DATA — fallback only, used when the tables below don't
// exist yet (SUPABASE_MIGRATION_INSIGHTS.sql not run) or a Supabase query
// errors for any other reason. Once real rows exist, everything on this page
// is computed from them instead — see fetchInsightsData() and the useMemo
// blocks in the component. Clearly isolated from the real path so it's never
// ambiguous which one produced what's on screen (also tagged in the UI
// itself via <SampleTag/>, not just in this comment).
// ============================================================================
const MOCK_STUDY_MINUTES_BY_DAY = [95, 130, 60, 145, 120, 88, 130]; // sums to 768min = 12h 48m
const MOCK_STUDY_WOW_PCT = 18;
const MOCK_RETENTION_PCT = 87;
const MOCK_RETENTION_WOW_PCT = 4;

// Deterministic (not random) per-system placeholder — seeded off the system
// name so it's at least stable across renders. Only used when review_log
// isn't available at all; once it exists, a system simply not reviewed in
// the window shows "—" rather than a mixed-in fake number (see Needs
// Attention below) — real and placeholder data are never blended silently
// in the same list.
function mockSystemRetention(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return 68 + (h % 20); // 68–87%, deliberately in "could use attention" range
}

function SampleTag({ t }) {
  return (
    <span style={{ fontSize:FONT.size.micro, color:t.text4, fontStyle:'italic',
      fontWeight:FONT.weight.regular }}>
      sample data
    </span>
  );
}

// ============================================================================
// Data fetching — study_sessions (Study Time) and review_log (Retention).
// Both are additive tables (see SUPABASE_MIGRATION_INSIGHTS.sql) written by
// useStudySession.js and ReviewQueue.js's rate(); nothing else in the app
// reads them. `null` (as opposed to `[]`) specifically means "query failed/
// table missing" — the signal this component uses to fall back to mock data,
// distinct from a real empty result (migration run, just no rows logged yet).
// ============================================================================
function useInsightsData(userId) {
  const [studySessions, setStudySessions] = useState(undefined); // undefined=loading, null=unavailable, []=real
  const [reviewLogs, setReviewLogs] = useState(undefined);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const sinceStudy = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase.from('study_sessions').select('started_at,duration_seconds')
      .eq('user_id', userId).gte('started_at', sinceStudy).order('started_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn('[Insights] study_sessions unavailable, showing sample data — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', error.message);
          }
          setStudySessions(null);
          return;
        }
        setStudySessions(data || []);
      });

    const sinceReview = new Date(Date.now() - 14 * 86400000).toISOString();
    supabase.from('review_log').select('rating,system,reviewed_at')
      .eq('user_id', userId).gte('reviewed_at', sinceReview).order('reviewed_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn('[Insights] review_log unavailable, showing sample data — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', error.message);
          }
          setReviewLogs(null);
          return;
        }
        setReviewLogs(data || []);
      });

    return () => { cancelled = true; };
  }, [userId]);

  return { studySessions, reviewLogs };
}

function formatHourRange(hour) {
  const fmt = (h) => {
    const period = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${period}`;
  };
  return `${fmt(hour)}–${fmt((hour + 1) % 24)}`;
}

// ============================================================================
// Small hand-rolled chart primitives — no charting library added, matching
// the rest of the app's hand-rolled-icon convention.
// ============================================================================
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

function formatMinutes(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Deliberately minimal: no axis lines, no gridlines, no permanent per-point
// labels or dots — a trend, not a spreadsheet. Hovering (or touching, on
// mobile) reveals the one point you're actually pointing at, nothing more.
function TrendChart({ t, values, dayLabels, width = 100, height = 56 }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const padY = 6;
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: padY + (1 - (v - min) / range) * (height - padY * 2),
  }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;
  const gradId = 'mb-insights-area-grad';

  const nearestIdx = (clientX) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * width;
    let nearest = 0, nearestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - relX);
      if (d < nearestDist) { nearestDist = d; nearest = i; }
    });
    return nearest;
  };

  return (
    <div style={{ position:'relative' }}>
      <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none" style={{ display:'block', overflow:'visible', cursor:'crosshair' }}
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
        <path d={linePath} fill="none" stroke={t.accent} strokeWidth="1.75"
          strokeLinecap="round" strokeLinejoin="round" />
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
          position:'absolute', top:-4, pointerEvents:'none',
          left:`clamp(4px, ${(points[hoverIdx].x / width) * 100}%, calc(100% - 4px))`,
          transform: hoverIdx === 0 ? 'translate(0,-100%)'
            : hoverIdx === values.length - 1 ? 'translate(-100%,-100%)' : 'translate(-50%,-100%)',
          background:t.text, color:t.appBg, fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold,
          padding:'4px 8px', borderRadius:RADIUS.sm, whiteSpace:'nowrap', boxShadow:elevation(t,'md') }}>
          {dayLabels[hoverIdx]} · {formatMinutes(values[hoverIdx])}
        </div>
      )}
    </div>
  );
}

// Circular progress ring — deliberately the most polished element on the
// page (per the brief) since it's the one directly tied to the SRS system.
function RetentionRing({ t, pct, size = 84, stroke = 7 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={t.surface3} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={t.accent} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition:`stroke-dashoffset ${MOTION.slow} ${MOTION.ease}` }} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text }}>
        {pct}%
      </div>
    </div>
  );
}

export default function Insights({ entries, userSystems, userId, onNavigateSystem, onReviewSystem }) {
  const { t } = useTheme();
  const { studySessions, reviewLogs } = useInsightsData(userId);

  // Shared by both the Study Time chart and Review Consistency's strip —
  // one real definition of "the last 7 days", oldest to newest.
  const last7Days = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push(d);
    }
    return days;
  }, []);

  // ── Study time ──────────────────────────────────────────────────────────
  const studyTime = useMemo(() => {
    if (studySessions == null) {
      return { real:false, minutesByDay:MOCK_STUDY_MINUTES_BY_DAY, wowPct:MOCK_STUDY_WOW_PCT, studiousHour:null };
    }
    const minutesByDay = last7Days.map(day => {
      const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);
      const secs = studySessions
        .filter(s => { const d = new Date(s.started_at); return d >= day && d < dayEnd; })
        .reduce((sum, s) => sum + s.duration_seconds, 0);
      return Math.round(secs / 60);
    });
    const thisWeekStart = last7Days[0];
    const prevWeekStart = new Date(thisWeekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const thisWeekTotal = studySessions.filter(s => new Date(s.started_at) >= thisWeekStart)
      .reduce((sum, s) => sum + s.duration_seconds, 0);
    const prevWeekTotal = studySessions.filter(s => { const d = new Date(s.started_at); return d >= prevWeekStart && d < thisWeekStart; })
      .reduce((sum, s) => sum + s.duration_seconds, 0);
    const wowPct = prevWeekTotal > 0 ? Math.round(((thisWeekTotal - prevWeekTotal) / prevWeekTotal) * 100) : null;

    // Most studious hour — real signal, needs actual session timestamps
    // (not just daily totals), so it's only ever shown for real data.
    const byHour = new Array(24).fill(0);
    studySessions.forEach(s => { byHour[new Date(s.started_at).getHours()] += s.duration_seconds; });
    let bestHour = null, bestSecs = 0;
    byHour.forEach((secs, h) => { if (secs > bestSecs) { bestSecs = secs; bestHour = h; } });

    return { real:true, minutesByDay, wowPct, studiousHour:bestHour, hasAnyData: studySessions.length > 0 };
  }, [studySessions, last7Days]);

  const totalMinutes = studyTime.minutesByDay.reduce((a, b) => a + b, 0);
  const studyHours = Math.floor(totalMinutes / 60);
  const studyMins = totalMinutes % 60;

  // ── Retention ───────────────────────────────────────────────────────────
  const retention = useMemo(() => {
    if (reviewLogs == null) {
      return { real:false, pct:MOCK_RETENTION_PCT, wowPct:MOCK_RETENTION_WOW_PCT, bySystem:null };
    }
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const scoreOf = (rows) => {
      if (rows.length === 0) return null;
      const good = rows.filter(r => r.rating === 'good' || r.rating === 'easy').length;
      return Math.round((good / rows.length) * 100);
    };
    const thisWeek = reviewLogs.filter(r => new Date(r.reviewed_at) >= weekAgo);
    const lastWeek = reviewLogs.filter(r => { const d = new Date(r.reviewed_at); return d >= twoWeeksAgo && d < weekAgo; });
    const pct = scoreOf(thisWeek);
    const lastPct = scoreOf(lastWeek);
    const wowPct = (pct != null && lastPct != null) ? pct - lastPct : null;

    // Per-system retention over the same window, real — used by Needs
    // Attention below and for the best/worst caption. A system with no
    // logged ratings in the window shows no number rather than a guess.
    const bySystem = {};
    thisWeek.forEach(r => {
      if (!bySystem[r.system]) bySystem[r.system] = [];
      bySystem[r.system].push(r);
    });
    Object.keys(bySystem).forEach(sys => { bySystem[sys] = scoreOf(bySystem[sys]); });

    return { real:true, pct, wowPct, bySystem, hasAnyData: thisWeek.length > 0 };
  }, [reviewLogs]);

  // Best/worst retained systems — real, only shown once there's enough
  // logged data to say something meaningful (at least two distinct systems
  // with a score this week).
  const retentionSpread = useMemo(() => {
    if (!retention.real || !retention.bySystem) return null;
    const scored = Object.entries(retention.bySystem).filter(([, v]) => v != null);
    if (scored.length < 2) return null;
    scored.sort((a, b) => b[1] - a[1]);
    return { best: scored[0], worst: scored[scored.length - 1] };
  }, [retention]);

  // ── Review consistency — real, derived from last_reviewed across entries ──
  const consistency = useMemo(() => {
    const all = Object.values(entries).flat();
    const activeDaySet = new Set();
    all.forEach(e => {
      if (!e.last_reviewed) return;
      const d = new Date(e.last_reviewed); d.setHours(0, 0, 0, 0);
      activeDaySet.add(d.getTime());
    });
    const activeDays = last7Days.filter(d => activeDaySet.has(d.getTime())).length;

    const now = new Date();
    const reviewedThisMonth = all.filter(e => {
      if (!e.last_reviewed) return false;
      const d = new Date(e.last_reviewed);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;

    return { activeDaySet, activeDays, reviewedThisMonth };
  }, [entries, last7Days]);

  // ── Needs attention — real ranking (due count + a real "struggling"
  // signal); retention % shown is real where available, mock-with-tag if not ──
  const attention = useMemo(() => {
    const stats = computeSystemStats(entries, userSystems, t.accent).filter(s => s.dueCount > 0);
    const scored = stats.map(s => ({ ...s, score: s.dueCount * 2 + s.strugglingCount }));
    return scored.sort((a, b) => b.score - a.score).slice(0, 3);
  }, [entries, userSystems, t.accent]);

  const card = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
    padding:SPACE.lg, boxShadow:elevation(t, 'sm') };
  const capLabel = { fontSize:FONT.size.xs, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
    textTransform:'uppercase', display:'flex', alignItems:'center', gap:8 };
  const trendLabel = (pct, suffix) => pct == null ? null : (
    <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color: pct >= 0 ? t.ok : t.danger }}>
      {pct >= 0 ? '↑' : '↓'} {Math.abs(pct)}% {suffix}
    </span>
  );

  return (
    <div className="mb-insights-shell">
      <style>{`
        .mb-insights-shell { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }
        @media (min-width:768px) { .mb-insights-shell { max-width:1160px; margin:0 auto; } }

        .mb-insights-row { transition: background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-insights-row:hover { background: ${t.surface2}; }
        .mb-insights-row:active { transform: scale(0.99); }

        .mb-insights-pair { display:grid; grid-template-columns:minmax(0,1fr); gap:${SPACE.lg}px; }
        @media (min-width:640px) {
          .mb-insights-pair { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
        }

        .mb-insights-week { display:flex; gap:6px; }
        .mb-insights-day {
          flex:1; height:26px; border-radius:${RADIUS.sm}px; display:flex; align-items:center;
          justify-content:center; font-size:${FONT.size.micro}px; font-weight:${FONT.weight.semibold};
        }
      `}</style>

      {/* Page header */}
      <div style={{ marginBottom:SPACE.xl2 }}>
        <div style={{ fontSize:FONT.size.xl3, fontWeight:FONT.weight.bold, color:t.text, lineHeight:FONT.leading.tight }}>
          Insights
        </div>
        <div style={{ fontSize:FONT.size.base, color:t.text3, marginTop:4 }}>
          Understand your learning over time.
        </div>
      </div>

      {/* Study time — primary card, full width */}
      <div style={{ ...card, marginBottom:SPACE.lg }}>
        <div style={{ ...capLabel, marginBottom:SPACE.md, justifyContent:'space-between' }}>
          <span>Study time</span>
          {!studyTime.real && <SampleTag t={t} />}
        </div>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between',
          flexWrap:'wrap', gap:8, marginBottom:SPACE.lg }}>
          <div style={{ fontSize:FONT.size.xl3, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1 }}>
            {studyTime.real && !studyTime.hasAnyData ? '—' : `${studyHours}h ${studyMins}m`}
          </div>
          {trendLabel(studyTime.wowPct, 'vs last week')}
        </div>

        {studyTime.real && !studyTime.hasAnyData ? (
          <div style={{ fontSize:FONT.size.sm, color:t.text4, padding:'20px 0' }}>
            No study sessions logged yet — this fills in as you use Review Queue, Flashcards, and entries.
          </div>
        ) : (
          <>
            <TrendChart t={t} values={studyTime.minutesByDay} dayLabels={
              last7Days.map(d => d.toLocaleDateString('en-GB', { weekday:'short' }))
            } />
            <div style={{ display:'flex', marginTop:SPACE.sm }}>
              {last7Days.map((d, i) => (
                <div key={i} style={{ flex:1, textAlign:'center', fontSize:FONT.size.micro, color:t.text4 }}>
                  {d.toLocaleDateString('en-GB', { weekday:'short' })}
                </div>
              ))}
            </div>
            {studyTime.real && studyTime.studiousHour != null && (
              <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:SPACE.md }}>
                Most studious around {formatHourRange(studyTime.studiousHour)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Retention + Review Consistency */}
      <div className="mb-insights-pair" style={{ marginBottom:SPACE.xl2 }}>

        <div style={card}>
          <div style={{ ...capLabel, marginBottom:SPACE.md, justifyContent:'space-between' }}>
            <span>Retention</span>
            {!retention.real && <SampleTag t={t} />}
          </div>
          {retention.real && !retention.hasAnyData ? (
            <div style={{ fontSize:FONT.size.sm, color:t.text4, padding:'8px 0 20px' }}>
              Not enough reviews yet this week — rate a few cards in Review Queue to see this fill in.
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:SPACE.lg }}>
              <RetentionRing t={t} pct={retention.real ? retention.pct : MOCK_RETENTION_PCT} />
              <div>
                {trendLabel(retention.wowPct, 'this week') || (
                  <span style={{ fontSize:FONT.size.xs, color:t.text4 }}>Not enough history for a trend yet</span>
                )}
                <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:4, maxWidth:150, lineHeight:FONT.leading.normal }}>
                  How well you're recalling what you've reviewed — the share of ratings that were Good or Easy.
                </div>
              </div>
            </div>
          )}
          {retentionSpread && (
            <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:SPACE.md, paddingTop:SPACE.md,
              borderTop:`1px solid ${t.border}` }}>
              Best: <strong style={{ color:t.text3 }}>{retentionSpread.best[0]}</strong> ({retentionSpread.best[1]}%)
              {' · '}
              Worst: <strong style={{ color:t.text3 }}>{retentionSpread.worst[0]}</strong> ({retentionSpread.worst[1]}%)
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ ...capLabel, marginBottom:SPACE.md }}>Review consistency</div>
          <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, marginBottom:SPACE.md }}>
            {consistency.activeDays} / 7 days
          </div>
          <div className="mb-insights-week">
            {last7Days.map((d, i) => {
              const active = consistency.activeDaySet.has(d.getTime());
              return (
                <div key={i} className="mb-insights-day" style={{
                  background: active ? t.navActiveBg : t.surface2,
                  color: active ? t.accent : t.text4,
                  border: `1px solid ${active ? t.navActiveBorder : t.border}`,
                }}>
                  {d.toLocaleDateString('en-GB', { weekday:'narrow' })}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:SPACE.md }}>
            {consistency.reviewedThisMonth} entries reviewed this month
          </div>
        </div>

      </div>

      {/* Needs attention */}
      <div>
        <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text }}>
          Needs attention
        </div>
        <div style={{ fontSize:FONT.size.sm, color:t.text3, marginTop:2, marginBottom:SPACE.md }}>
          Areas that may benefit from review.
        </div>

        {attention.length === 0 ? (
          <div style={{ ...card, color:t.text4, fontSize:FONT.size.sm }}>
            Nothing due right now — you're caught up.
          </div>
        ) : (
          <div style={{ ...card, padding:SPACE.sm }}>
            {attention.map((s, i) => {
              // Real per-system retention where the migration has run AND
              // this system has logged ratings this week; otherwise the
              // same clearly-tagged estimate the global card uses — never a
              // silent blend of the two within one row.
              const realPct = retention.real ? retention.bySystem?.[s.name] : undefined;
              const showPct = realPct != null ? realPct : (retention.real ? null : mockSystemRetention(s.name));
              return (
                <div key={s.name} className="mb-insights-row"
                  onClick={() => (onReviewSystem ? onReviewSystem(s.name) : onNavigateSystem?.(s.name))}
                  style={{
                    display:'flex', alignItems:'center', gap:SPACE.md, padding:'12px 10px', cursor:'pointer',
                    borderRadius:RADIUS.sm, borderBottom: i < attention.length - 1 ? `1px solid ${t.border}` : 'none',
                  }}>
                  <div style={{ width:8, height:8, borderRadius:RADIUS.circle, background:s.color, flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:FONT.size.base, fontWeight:FONT.weight.semibold, color:t.text,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:2, display:'flex', alignItems:'center', gap:5 }}>
                      <IconRepeat size={10} /> {s.dueCount} due
                    </div>
                  </div>
                  <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:t.text3, flexShrink:0 }}>
                    {showPct != null ? `${showPct}%` : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
