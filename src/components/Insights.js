import { useMemo } from 'react';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { computeSystemStats } from '../lib/systemStats';
import { IconRepeat } from '../lib/icons';

// ============================================================================
// MOCK / PLACEHOLDER DATA — clearly isolated from the real calculations below.
// ============================================================================
//
// TODO(study-time): MedBook does not currently track study session duration
// anywhere — no `study_sessions` table, no duration column, no session
// start/end events recorded from DetailView, ReviewQueue, or FlashCards.
// To make this section real:
//   1. Add a lightweight duration record (e.g. a `study_sessions` table:
//      user_id, started_at, duration_seconds) or a per-day counter.
//   2. Start a timer when a study/review screen mounts (DetailView on open,
//      ReviewQueue/FlashCards on session start) and persist elapsed time on
//      unmount/session end.
//   3. Aggregate per day for the 7-day chart and compute week-over-week %.
// Until then this card shows clearly-labeled sample data (see <SampleTag/>)
// rather than a live number that could be mistaken for something real.
const MOCK_STUDY_MINUTES_BY_DAY = [95, 130, 60, 145, 120, 88, 130]; // Mon..Sun — sums to 768min = 12h 48m
const MOCK_STUDY_WOW_PCT = 18;

// TODO(retention): true retention (% of reviews actually recalled) needs a
// per-review outcome log — entry_id, rating, reviewed_at — written on every
// Review Queue rating. The current schema only keeps the LATEST aggregate
// state per entry (review_interval, ease_factor), not a history of ratings.
// Two specific reasons ease_factor/review_interval alone aren't reliable
// enough to present as "retention": calcNext() in ReviewQueue.js only moves
// ease_factor on Hard/Easy ratings (Good and Again both leave it untouched),
// so for most entries it can't distinguish "reviewed with Good repeatedly"
// from "never reviewed"; and review_interval resets to 1 on Again with no
// timestamp of when, so a week-over-week trend isn't reconstructable either.
// To make this real: add a `review_log` table and compute retention as
// (Good+Easy ratings) / (total ratings) over a rolling window.
// Until then: clearly-labeled sample data, both here and in the per-system
// numbers Needs Attention shows below.
const MOCK_RETENTION_PCT = 87;
const MOCK_RETENTION_WOW_PCT = 4;

// Deterministic (not random) per-system placeholder for the Needs Attention
// rows — seeded off the system name so it's at least stable across renders,
// not a real per-system retention calculation (see TODO above).
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
// Small hand-rolled chart primitives — no charting library added, matching
// the rest of the app's hand-rolled-icon convention (unnecessary dependency
// avoided, bundle size unchanged).
// ============================================================================

// Smooth-ish path through points using a simple midpoint cubic-bezier trick
// (control points at each segment's horizontal midpoint) — reads as a calm
// curve rather than a jagged spreadsheet line, without needing a real spline
// implementation for 7 points.
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

// Deliberately minimal: no axis lines, no gridlines, no per-point labels or
// dots — a trend, not a spreadsheet, per the brief.
function TrendChart({ t, values, width = 100, height = 56 }) {
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

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
      style={{ display:'block', overflow:'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={t.accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={t.accent} strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_LETTERS = ['M','T','W','T','F','S','S'];

export default function Insights({ entries, userSystems, onNavigateSystem, onReviewSystem }) {
  const { t } = useTheme();

  // ── Review consistency — REAL, derived from last_reviewed across entries ──
  const consistency = useMemo(() => {
    const all = Object.values(entries).flat();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push(d);
    }
    // Each entry only carries its MOST RECENT review date, not a full log —
    // but for "which of the last 7 days had ANY review", that's still
    // accurate: an active day only needs one entry's last_reviewed to land
    // on it, and every entry contributes its true latest review date.
    const activeDaySet = new Set();
    all.forEach(e => {
      if (!e.last_reviewed) return;
      const d = new Date(e.last_reviewed); d.setHours(0, 0, 0, 0);
      activeDaySet.add(d.getTime());
    });
    const activeDays = days.filter(d => activeDaySet.has(d.getTime())).length;

    // Distinct entries with a review this calendar month — NOT a count of
    // individual review actions. See the retention TODO above: without a
    // review_log, an entry reviewed 3x this month still only shows once.
    const now = new Date();
    const reviewedThisMonth = all.filter(e => {
      if (!e.last_reviewed) return false;
      const d = new Date(e.last_reviewed);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;

    return { days, activeDaySet, activeDays, reviewedThisMonth };
  }, [entries]);

  // ── Needs attention — REAL ranking (due count + a real "struggling"
  // signal), retention % shown is the sample data disclosed above ──
  const attention = useMemo(() => {
    const stats = computeSystemStats(entries, userSystems, t.accent).filter(s => s.dueCount > 0);
    // Ranking intentionally does NOT factor in the placeholder retention
    // number — sorting by sample data would defeat the point of ranking.
    // TODO: once real per-system retention exists (see TODO above), blend
    // it into this score too.
    const scored = stats.map(s => ({ ...s, score: s.dueCount * 2 + s.strugglingCount }));
    return scored.sort((a, b) => b.score - a.score).slice(0, 3);
  }, [entries, userSystems, t.accent]);

  const totalMinutes = MOCK_STUDY_MINUTES_BY_DAY.reduce((a, b) => a + b, 0);
  const studyHours = Math.floor(totalMinutes / 60);
  const studyMins = totalMinutes % 60;

  const card = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
    padding:SPACE.lg, boxShadow:elevation(t, 'sm') };
  const capLabel = { fontSize:FONT.size.xs, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
    textTransform:'uppercase', display:'flex', alignItems:'center', gap:8 };
  const trendUp = (pct) => (
    <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:t.ok }}>
      ↑ {pct}% {pct === MOCK_STUDY_WOW_PCT ? 'vs last week' : 'this week'}
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

        /* Retention + Review Consistency: 2-up from tablet, stacked on mobile. */
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
          <SampleTag t={t} />
        </div>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between',
          flexWrap:'wrap', gap:8, marginBottom:SPACE.lg }}>
          <div style={{ fontSize:FONT.size.xl3, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1 }}>
            {studyHours}h {studyMins}m
          </div>
          {trendUp(MOCK_STUDY_WOW_PCT)}
        </div>

        <TrendChart t={t} values={MOCK_STUDY_MINUTES_BY_DAY} />

        <div style={{ display:'flex', marginTop:SPACE.sm }}>
          {DAY_LABELS.map(d => (
            <div key={d} style={{ flex:1, textAlign:'center', fontSize:FONT.size.micro, color:t.text4 }}>{d}</div>
          ))}
        </div>
      </div>

      {/* Retention + Review Consistency */}
      <div className="mb-insights-pair" style={{ marginBottom:SPACE.xl2 }}>

        <div style={card}>
          <div style={{ ...capLabel, marginBottom:SPACE.md, justifyContent:'space-between' }}>
            <span>Retention</span>
            <SampleTag t={t} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:SPACE.lg }}>
            <RetentionRing t={t} pct={MOCK_RETENTION_PCT} />
            <div>
              <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:t.ok }}>
                ↑ {MOCK_RETENTION_WOW_PCT}% this week
              </div>
              <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:4, maxWidth:150, lineHeight:FONT.leading.normal }}>
                How well you're recalling what you've reviewed.
              </div>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={{ ...capLabel, marginBottom:SPACE.md }}>Review consistency</div>
          <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, marginBottom:SPACE.md }}>
            {consistency.activeDays} / 7 days
          </div>
          <div className="mb-insights-week">
            {consistency.days.map((d, i) => {
              const active = consistency.activeDaySet.has(d.getTime());
              return (
                <div key={i} className="mb-insights-day" style={{
                  background: active ? t.navActiveBg : t.surface2,
                  color: active ? t.accent : t.text4,
                  border: `1px solid ${active ? t.navActiveBorder : t.border}`,
                }}>
                  {DAY_LETTERS[i]}
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
            {attention.map((s, i) => (
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
                  {mockSystemRetention(s.name)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
