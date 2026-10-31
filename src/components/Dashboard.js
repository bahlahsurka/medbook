import { useMemo, useState, useEffect, useRef } from 'react';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { computeSystemStats } from '../lib/systemStats';
import { SYS_COLOR } from '../lib/constants';
import { computeOverallProgress, buildSystemRegister, fetchDailyActivity, formatTimeSpent } from '../lib/syllabusProgress';
import { OverallSyllabusProgress, SystemProgressRegister } from './SyllabusProgress';
import { IconRepeat, IconPlus, IconChart, IconCheck, IconChevronDown } from '../lib/icons';

const RECENT_EXPANDED_KEY = 'medbook_dash_recent_expanded';

// Neutral (non-accented) card surface — Overall Progress / System Progress
// / Recent Entries. In dark mode only, a top-lit hairline (brighter top
// edge, quieter sides/bottom) plus a whisper-light top sheen give it a
// touch of tactile depth; light mode is untouched (plain border + existing
// shadow, exactly as before this pass).
function neutralCardSurface(t, isDark) {
  return {
    background: t.surface,
    backgroundImage: isDark ? 'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, transparent 48px)' : 'none',
    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : t.border}`,
    borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : t.border}`,
    borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : t.border}`,
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : t.border}`,
    borderRadius: RADIUS.lg,
    boxShadow: elevation(t, 'sm'),
  };
}

// A single system row inside Today's Focus — a real <button> (keyboard-
// accessible, comfortable touch height) rather than a clickable <div>.
// Clicking launches a due-review session filtered to that one system —
// see onReviewSystem's wiring in App.js (the same prop Insights.js already
// uses for its own "review this system" rows).
function FocusSystemRow({ t, system, count, onClick }) {
  return (
    <button type="button" className="mb-dash-focusrow" onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:SPACE.sm, width:'100%', textAlign:'left',
      background:'none', border:'none', borderRadius:RADIUS.sm, padding:'9px 8px', cursor:'pointer',
      minHeight:40, position:'relative', overflow:'hidden' }}>
      <div style={{ width:7, height:7, borderRadius:RADIUS.circle, background:system.color, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0, fontSize:FONT.size.sm, color:t.text2, fontWeight:FONT.weight.medium,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{system.name}</div>
      <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold, color:t.accent,
        background:t.navActiveBg, borderRadius:RADIUS.pill, padding:'2px 7px', flexShrink:0,
        fontVariantNumeric:'tabular-nums' }}>
        {count} due
      </span>
    </button>
  );
}

// One Recent Review Entries row — Dashboard-local (not the shared
// EntryCard, which is also reused by SystemHome/Search/the marketing
// landing page and shouldn't change shape just for this one compact
// drawer). Title/meta always start at the same left edge regardless of
// whether the entry has an image; a small uniform thumbnail sits near the
// date on the right instead of shifting anything on the left. In dark
// mode, a bright white-background thumbnail (a textbook screenshot) gets a
// mild brightness/contrast pull-down plus a soft inner border so it sits
// comfortably in the card instead of glaring.
function RecentEntryRow({ t, isDark, entry, color, onClick }) {
  const hasImage = entry.images?.length > 0;
  return (
    <button type="button" className="mb-dash-row" onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:SPACE.md, width:'100%', textAlign:'left',
      background:'none', border:'none', borderRadius:RADIUS.sm, padding:'9px 8px', cursor:'pointer',
      minHeight:44 }}>
      <span aria-hidden="true" style={{ width:4, alignSelf:'stretch', borderRadius:RADIUS.pill,
        background:color, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, color:t.text,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{entry.title}</div>
        <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:2 }}>
          {entry.system}{entry.review_count > 0 ? ` · reviewed ×${entry.review_count}` : ''}
        </div>
      </div>
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:FONT.size.micro, color:t.text4 }}>
          {new Date(entry.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
        </span>
        {hasImage && (
          <img src={entry.images[0]} alt="" loading="lazy" decoding="async" style={{
            width:36, height:36, borderRadius:RADIUS.sm, objectFit:'cover', flexShrink:0,
            filter: isDark ? 'brightness(0.9) contrast(0.95)' : 'none',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : t.border}` }} />
        )}
      </div>
    </button>
  );
}

// Ultra-compact 7-day activity strip — one dot per local day, oldest to
// newest, ending today. Intensity (not a new color) marks whether that day
// had any reviews at all; today gets a ring so "where am I" is unambiguous
// at a glance. Purely presentational — see fetchDailyActivity for the data.
function ActivityStrip({ t, isDark, strip }) {
  if (!strip) return null;
  const todayKey = strip[strip.length - 1]?.dayKey;
  return (
    <div style={{ display:'flex', gap:5, marginTop:SPACE.md }}>
      {strip.map(day => {
        const active = day.count > 0;
        return (
          <div key={day.dayKey} title={new Date(day.dayKey).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
            style={{
              width:9, height:9, borderRadius:RADIUS.circle, flexShrink:0,
              background: active ? t.ok : (isDark ? 'rgba(255,255,255,0.07)' : t.surface3),
              boxShadow: day.dayKey === todayKey ? `0 0 0 2px ${isDark ? 'rgba(255,255,255,0.18)' : t.border}` : 'none',
            }} />
        );
      })}
    </div>
  );
}

export default function Dashboard({ entries, userSystems, userId, onOpenEntry, onNavigateSystem,
  onReviewSystem, onStartReview, onAddEntry }) {
  const { t, isDark } = useTheme();

  // Always-current entries for the daily-activity fetch below, without
  // making that effect re-run (and re-query review_log) on every entries
  // change — same pattern ReviewQueue.js uses for its own entriesRef.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Daily activity — reviews today, active study time today, and a 7-day
  // consistency strip, all from review_log (see
  // SUPABASE_MIGRATION_INSIGHTS.sql), written by every review path
  // (ReviewQueue/SystemReview's rate(), DetailView's markReviewed). See
  // lib/syllabusProgress.js's fetchDailyActivity for the exact, schema-
  // constrained Time Spent formula. Deliberately NOT derived from
  // entries.last_reviewed (a single overwritten timestamp per entry that
  // can't distinguish "reviewed once today" from "reviewed three times
  // today").
  // undefined=loading (card renders with a neutral placeholder, no layout
  // shift), null=table unavailable (card omitted entirely rather than
  // showing a guessed number), object=real counts for the viewer's LOCAL day.
  const [dailyActivity, setDailyActivity] = useState(undefined);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchDailyActivity(userId).then(result => {
      if (cancelled) return;
      if (result.reviewedActionsToday === null) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[Dashboard] review_log unavailable, hiding Daily Activity — has SUPABASE_MIGRATION_INSIGHTS.sql been run?');
        }
        setDailyActivity(null);
        return;
      }
      setDailyActivity(result);
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Everything below is read straight off fields the rest of the app already
  // populates (next_review / review_count / created_at) — the same "due"
  // definition ReviewQueue uses, nothing new invented.
  const stats = useMemo(() => {
    const all = Object.values(entries).flat();
    const now = new Date();

    const due = all.filter(e => e.next_review && new Date(e.next_review) <= now);
    const upcoming = all
      .filter(e => e.next_review && new Date(e.next_review) > now)
      .map(e => new Date(e.next_review))
      .sort((a, b) => a - b);
    const recent = [...all].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 4);

    const bySystem = computeSystemStats(entries, userSystems, t.accent).filter(s => s.count > 0);

    // EVERY system with due work, most-due first — Today's Focus shows the
    // top 5 by default with an explicit expand toggle for the rest, rather
    // than silently dropping systems past a hardcoded slice.
    const dueSystemsAll = bySystem
      .filter(s => s.dueCount > 0)
      .sort((a, b) => b.dueCount - a.dueCount);

    return {
      total: all.length,
      dueCount: due.length,
      nextDue: upcoming[0] || null,
      recent,
      bySystem,
      dueSystemsAll,
    };
  }, [entries, userSystems, t.accent]);

  // Syllabus progress — Reviewed/Total/Coverage, overall and per system.
  // See lib/syllabusProgress.js for the shared definitions/ranking rules
  // (the exact same module Review Queue's compact version reads).
  const overallProgress = useMemo(() => computeOverallProgress(entries), [entries]);
  const register = useMemo(() => buildSystemRegister(entries, userSystems, t.accent), [entries, userSystems, t.accent]);
  const [registerExpanded, setRegisterExpanded] = useState(false);
  const [registerGroup, setRegisterGroup] = useState('all');

  const [focusExpanded, setFocusExpanded] = useState(false);

  // Recent Review Entries — collapsed by default, state persisted across
  // visits so a user who opens it once doesn't have to again every time.
  const [recentExpanded, setRecentExpanded] = useState(() => {
    try { return localStorage.getItem(RECENT_EXPANDED_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(RECENT_EXPANDED_KEY, recentExpanded ? '1' : '0'); } catch {}
  }, [recentExpanded]);

  // Maps this screen's global theme onto the small flat shape
  // SyllabusProgress.js's components expect — see that file's own header
  // comment for why (Dashboard's `t` and Review Queue's `rt` don't share
  // field names).
  const syllabusColors = useMemo(() => ({
    text:t.text, text2:t.text2, text3:t.text3, text4:t.text4,
    border:t.border, borderStrong:t.borderStrong,
    surface:t.surface, surfaceTrack:t.surface3,
    accent:t.accent, accentBg:t.navActiveBg, accentBorder:t.navActiveBorder,
  }), [t]);

  const card = neutralCardSurface(t, isDark);
  const capLabel = { fontSize:FONT.size.xs, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
    textTransform:'uppercase', marginBottom:SPACE.md, display:'flex', alignItems:'center', gap:6 };

  // Brand-new account — nothing to summarise yet. A stats/progress dashboard
  // with all-zero tiles would just be noise, so this is a distinct state
  // rather than the same layout with empty cards everywhere.
  if (stats.total === 0) {
    return (
      <div style={{ maxWidth:520, margin:'0 auto', textAlign:'center', paddingTop:'12vh' }}>
        <style>{`
          .mb-dash-cta { transition: background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
          .mb-dash-cta:active { transform: scale(0.97); }
        `}</style>
        <div style={{ width:56, height:56, borderRadius:RADIUS.xl2, background:t.navActiveBg,
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          <IconChart size={24} style={{ color:t.accent }} />
        </div>
        <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, marginBottom:8 }}>
          Welcome to MedBook
        </div>
        <div style={{ fontSize:FONT.size.base, color:t.text3, marginBottom:24, lineHeight:FONT.leading.relaxed }}>
          Your dashboard fills in once you start capturing what you're learning:
          due reviews, recent entries, and study progress will all show up here.
        </div>
        <button className="mb-dash-cta" onClick={onAddEntry} style={{ background:t.accent, color:'#fff',
          border:'none', borderRadius:RADIUS.md, padding:'12px 26px', fontSize:FONT.size.base,
          fontWeight:FONT.weight.semibold, cursor:'pointer', display:'inline-flex',
          alignItems:'center', gap:8 }}>
          <IconPlus size={15} /> Add Your First Entry
        </button>
      </div>
    );
  }

  const showDailyActivity = dailyActivity !== null;
  const visibleFocusSystems = stats.dueSystemsAll.slice(0, focusExpanded ? undefined : 5);

  return (
    <div className="mb-dash-shell">
      <style>{`
        .mb-dash-shell { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }
        @media (min-width:768px) { .mb-dash-shell { max-width:1160px; margin:0 auto; } }

        .mb-dash-card:hover { border-color: ${t.borderStrong}; }
        .mb-dash-row:hover, .mb-dash-focusrow:hover { background: ${t.surface2}; }
        .mb-dash-row:active, .mb-dash-focusrow:active { transform: scale(0.99); }
        .mb-dash-row:focus-visible, .mb-dash-focusrow:focus-visible,
        .mb-dash-collapse:focus-visible, .mb-dash-expand:focus-visible {
          outline:2px solid ${t.accent}; outline-offset:2px;
        }
        /* Tactile vertical depth — crisp blue top to a slightly deeper blue
           bottom, with a thin inner highlight along the top edge, so the
           primary action reads as a raised, pressable surface rather than
           a flat color fill. Built from the app's own two accent blues
           (dark-mode's #3B82F6, light-mode's #2563EB), not a new hue. */
        .mb-hero-cta {
          background: linear-gradient(180deg, #3B82F6 0%, #2563EB 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
          transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease};
        }
        .mb-hero-cta:hover { filter: brightness(1.05); }
        .mb-hero-cta:active { transform: scale(0.97); }
        .mb-ghost-cta:hover { background: ${t.surface2}; border-color: ${t.borderStrong}; }
        .mb-ghost-cta:active { transform: scale(0.97); }

        .mb-dash-progress { ${isDark
          ? `background:${t.surface}; background-image:linear-gradient(180deg, rgba(255,255,255,0.018) 0%, transparent 48px); border-top:1px solid rgba(255,255,255,0.09); border-left:1px solid rgba(255,255,255,0.05); border-right:1px solid rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.05);`
          : `background:${t.surface}; border:1px solid ${t.border};` }
          border-radius:${RADIUS.lg}px; padding:${SPACE.lg}px ${SPACE.lg+2}px; box-shadow:${elevation(t,'sm')};
          margin-bottom:${SPACE.xl2}px; animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }

        /* Two-zone workspace: left (~65%) System Progress + Recent Entries,
           right (~35%) Today's Focus + Daily Activity, sticky on desktop
           scroll. DOM order is rail-then-main specifically so the single-
           column mobile layout (which just stacks this grid's children in
           source order) puts Today's Focus/Daily Activity near the top,
           per the brief — grid-area placement below re-positions them to
           the right column on wider viewports regardless of DOM order. */
        .mb-dash-grid {
          display:grid; grid-template-columns:minmax(0,1fr); gap:20px;
          grid-template-areas: "rail" "main";
        }
        @media (min-width:768px) {
          .mb-dash-grid {
            grid-template-columns:minmax(0,1fr) 360px; gap:24px; align-items:start;
            grid-template-areas: "main rail";
          }
          .mb-dash-rail { position:sticky; top:${SPACE.lg}px; }
        }
        .mb-dash-main { grid-area:main; display:flex; flex-direction:column; gap:20px; min-width:0; }
        .mb-dash-rail { grid-area:rail; display:flex; flex-direction:column; gap:20px; min-width:0; }
      `}</style>

      {/* Overall Syllabus Progress — one integrated composition (coverage %,
          reviewed/total, active-systems context, a quiet remaining label,
          one proportional bar), sitting immediately at the top of the
          page — not a statistic tile, and not buried under a hero block.
          See lib/syllabusProgress.js for the shared Reviewed/Total/
          Coverage definitions this reads. */}
      <div className="mb-dash-progress">
        <div style={capLabel}>Overall Syllabus Progress</div>
        <OverallSyllabusProgress colors={syllabusColors} isDark={isDark}
          total={overallProgress.total} reviewed={overallProgress.reviewed}
          unreviewed={overallProgress.unreviewed} systemCount={stats.bySystem.length} />
      </div>

      <div className="mb-dash-grid">

        {/* ── Right rail (sticky): Today's Focus, then Daily Activity ── */}
        <div className="mb-dash-rail">

          {/* Today's Focus — the true, uncapped due count across every
              system (no "50+" display cap here — see the brief's explicit
              call for exact math), the primary Start Review action, and
              the systems actually carrying that work, each one a real,
              keyboard-accessible button that launches a due session
              filtered to just that system. */}
          <div style={{ ...card, borderTop:`2px solid ${stats.dueCount>0?t.accent:t.ok}`,
            backgroundImage: stats.dueCount>0
              ? 'linear-gradient(180deg, rgba(59,130,246,0.055) 0%, transparent 56px)'
              : card.backgroundImage }}>
            <div style={capLabel}><IconRepeat size={12} /> Today's Focus</div>

            {stats.dueCount > 0 ? (
              <>
                <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1,
                  fontVariantNumeric:'tabular-nums' }}>
                  {stats.dueCount.toLocaleString()} due
                </div>
                <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3, marginBottom:SPACE.md }}>
                  {stats.dueSystemsAll.length > 0
                    ? `across ${stats.dueSystemsAll.length} system${stats.dueSystemsAll.length===1?'':'s'}`
                    : 'ready to review now'}
                </div>
                <button className="mb-hero-cta" onClick={onStartReview} style={{
                  width:'100%', color:'#fff', border:'none',
                  borderRadius:RADIUS.sm+1, padding:'10px 14px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold,
                  cursor:'pointer', marginBottom: visibleFocusSystems.length>0 ? SPACE.md : 0 }}>
                  Start Review
                </button>
                {visibleFocusSystems.length > 0 && (
                  <>
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      {visibleFocusSystems.map(s => (
                        <FocusSystemRow key={s.name} t={t} system={s} count={s.dueCount}
                          onClick={() => onReviewSystem?.(s.name)} />
                      ))}
                    </div>
                    {stats.dueSystemsAll.length > 5 && (
                      <button type="button" className="mb-dash-expand" onClick={() => setFocusExpanded(e => !e)} style={{
                        display:'block', width:'100%', textAlign:'center', marginTop:SPACE.xs, background:'none',
                        border:'none', color:t.accent, fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold,
                        cursor:'pointer', padding:'6px 0', minHeight:32 }}>
                        {focusExpanded ? 'Show less' : `View all ${stats.dueSystemsAll.length} due systems`}
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.ok, marginBottom:4 }}>
                  All caught up 🎉
                </div>
                <div style={{ fontSize:FONT.size.xs, color:t.text4, marginBottom:SPACE.md }}>
                  {stats.nextDue
                    ? `Next due ${stats.nextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`
                    : 'Rate entries in Review Queue to start scheduling'}
                </div>
                <button className="mb-ghost-cta" onClick={onStartReview} style={{
                  width:'100%', background:t.surface3, color:t.text2, border:`1px solid ${t.border}`,
                  borderRadius:RADIUS.sm+1, padding:'9px 14px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold,
                  cursor:'pointer', transition:`background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` }}>
                  Review Queue
                </button>
              </>
            )}
          </div>

          {/* Daily Activity — two balanced counts for TODAY only (reviews
              completed, active study time), plus a 7-day consistency
              strip. Deliberately separate from Overall Syllabus Progress
              above — that's cumulative coverage, this is just today.
              Omitted entirely (not rendered as 0) when review_log isn't
              reachable, so this card never shows a guess. */}
          {showDailyActivity && (
            <div style={{ ...card, borderTop:`2px solid ${t.ok}`,
              backgroundImage: 'linear-gradient(180deg, rgba(16,185,129,0.05) 0%, transparent 56px)' }}>
              <div style={capLabel}><IconCheck size={12} /> Daily Activity</div>
              <div style={{ display:'flex', gap:SPACE.lg }}>
                <div>
                  <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1,
                    fontVariantNumeric:'tabular-nums' }}>
                    {dailyActivity === undefined ? '–' : dailyActivity.reviewedActionsToday.toLocaleString()}
                  </div>
                  <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3 }}>
                    {dailyActivity === undefined ? 'Loading…'
                      : dailyActivity.reviewedActionsToday === 1 ? 'review today' : 'reviews today'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1,
                    fontVariantNumeric:'tabular-nums' }}>
                    {dailyActivity === undefined ? '–' : formatTimeSpent(dailyActivity.timeSpentTodaySeconds)}
                  </div>
                  <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3 }}>
                    {dailyActivity === undefined ? 'Loading…' : 'time spent'}
                  </div>
                </div>
              </div>
              {dailyActivity !== undefined && (
                <ActivityStrip t={t} isDark={isDark} strip={dailyActivity.sevenDayStrip} />
              )}
            </div>
          )}
        </div>

        {/* ── Main column: System Progress (primary), then Recent Review
            Entries as a collapsible drawer beneath it ── */}
        <div className="mb-dash-main">

          {/* System Progress — the ranked register (In Progress / Not
              Started / Completed), the primary thing this column exists
              to show. Whole rows navigate to that system. */}
          <div style={card}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              flexWrap:'wrap', gap:SPACE.sm, marginBottom:SPACE.md }}>
              <div style={{ ...capLabel, marginBottom:0 }}><IconChart size={12} /> System Progress</div>
            </div>
            <SystemProgressRegister colors={syllabusColors} register={register} isDark={isDark}
              onRowClick={onNavigateSystem} maxRows={10} expanded={registerExpanded}
              onToggleExpand={() => setRegisterExpanded(e => !e)}
              filterPills activeGroup={registerGroup} onActiveGroupChange={setRegisterGroup} />
          </div>

          {/* Recent Review Entries — collapsed by default (state persisted
              in localStorage), so this drawer doesn't compete with System
              Progress for the top of the column on a return visit. */}
          <div style={card}>
            <button type="button" className="mb-dash-collapse" onClick={() => setRecentExpanded(e => !e)}
              aria-expanded={recentExpanded} style={{
                display:'flex', alignItems:'center', width:'100%', background:'none', border:'none',
                cursor:'pointer', padding:0, minHeight:32, color:'inherit', textAlign:'left' }}>
              <div style={{ ...capLabel, marginBottom:0, flex:1 }}>
                Recent Review Entries
                <span style={{ fontVariantNumeric:'tabular-nums', color:t.text4, fontWeight:FONT.weight.medium,
                  textTransform:'none', letterSpacing:0 }}>· {stats.recent.length}</span>
              </div>
              <IconChevronDown size={14} style={{ color:t.text4, flexShrink:0,
                transform: recentExpanded ? 'rotate(180deg)' : 'none',
                transition:`transform ${MOTION.fast} ${MOTION.ease}` }} />
            </button>
            {recentExpanded && (
              <div style={{ display:'flex', flexDirection:'column', gap:2, marginTop:SPACE.sm }}>
                {stats.recent.map(e => (
                  <RecentEntryRow key={e.id} t={t} isDark={isDark} entry={e}
                    color={userSystems?.find(s=>s.name===e.system)?.color || SYS_COLOR[e.system] || t.accent}
                    onClick={() => onOpenEntry(e)} />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
