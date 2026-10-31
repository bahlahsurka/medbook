import { useMemo, useState, useEffect, useRef } from 'react';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { computeSystemStats } from '../lib/systemStats';
import { timeAgo } from '../lib/timeAgo';
import { SYS_COLOR } from '../lib/constants';
import { computeOverallProgress, buildSystemRegister, fetchDailyActivity } from '../lib/syllabusProgress';
import { OverallSyllabusProgress, SystemProgressRegister } from './SyllabusProgress';
import { formatDueCount } from '../lib/dueCount';
import EntryCard from './EntryCard';
import { IconRepeat, IconPlus, IconChart, IconCheck } from '../lib/icons';

function greetingFor(hour) {
  if (hour < 5)  return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

// One compact metric tile for the summary row — small on purpose (see the
// redesign notes above Dashboard): a row of oversized number tiles was
// exactly the kind of "collection of dashboard cards" this pass moved away
// from. `accent` marks the one metric worth a visual nudge (Due Today).
function SummaryTile({ t, icon: Icon, label, value, sub, accent }) {
  return (
    <div className="mb-dash-card" style={{
      background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
      borderTop: accent ? `2px solid ${t.accent}` : `1px solid ${t.border}`,
      padding:`${SPACE.md}px ${SPACE.md+2}px`,
      transition:`border-color ${MOTION.fast} ${MOTION.ease}` }}>
      <div style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.6, fontWeight:FONT.weight.semibold,
        textTransform:'uppercase', marginBottom:6, display:'flex', alignItems:'center', gap:5 }}>
        {Icon && <Icon size={11} />} {label}
      </div>
      <div style={{ fontSize:24, fontWeight:FONT.weight.bold, lineHeight:1.15,
        color: accent && value ? t.accent : t.text }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:FONT.size.micro, color:t.text4, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

// A "Recently Studied"/"Today's Focus" row — a system name, a coloured
// dot, and an optional badge, all clicking through to that system. Shared
// so the three lists that use this exact shape (focus/recently-studied/
// activity) stay visually identical instead of drifting apart.
function SystemRow({ t, system, badge, onClick }) {
  return (
    <div className="mb-dash-row" onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:SPACE.sm, padding:'8px',
      borderRadius:RADIUS.sm, cursor:'pointer',
      transition:`background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` }}>
      <div style={{ width:7, height:7, borderRadius:RADIUS.circle, background:system.color, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0, fontSize:FONT.size.sm, color:t.text2, fontWeight:FONT.weight.medium,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{system.name}</div>
      {badge}
    </div>
  );
}

function DueBadge({ t, count }) {
  return (
    <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold, color:t.accent,
      background:t.navActiveBg, borderRadius:RADIUS.pill, padding:'2px 7px', flexShrink:0 }}>
      {count} due
    </span>
  );
}

export default function Dashboard({ entries, userSystems, userId, onOpenEntry, onNavigateSystem,
  onStartReview, onAddEntry }) {
  const { t } = useTheme();

  // Always-current entries for the daily-activity fetch below, without
  // making that effect re-run (and re-query review_log) on every entries
  // change — same pattern ReviewQueue.js uses for its own entriesRef.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Daily activity — two real counts from review_log (see
  // SUPABASE_MIGRATION_INSIGHTS.sql), written by ReviewQueue/SystemReview's
  // rate(): every review action taken today, and distinct active entries
  // whose true first-ever review happened today (see
  // lib/syllabusProgress.js's fetchDailyActivity for the exact, carefully
  // scoped logic — and the review_log coverage gap it works around).
  // Deliberately NOT derived from entries.last_reviewed (a single
  // overwritten timestamp per entry that can't distinguish "reviewed once
  // today" from "reviewed three times today", and would conflate cards
  // reviewed with entries studied).
  // undefined=loading (card renders with a neutral placeholder, no layout
  // shift), null=table unavailable (card omitted entirely rather than
  // showing a guessed number), object=real counts for the viewer's LOCAL day.
  const [dailyActivity, setDailyActivity] = useState(undefined);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchDailyActivity(userId, entriesRef.current).then(result => {
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
  // populates (next_review / review_count / last_reviewed / created_at) — the
  // same "due" definition ReviewQueue uses, nothing new invented.
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

    const recentlyStudied = bySystem
      .filter(s => s.lastStudied)
      .sort((a, b) => b.lastStudied - a.lastStudied)
      .slice(0, 4);

    // Systems that actually have due work, most-due first — "Today's Focus"
    // needs to answer "where do I start", not just repeat the raw count.
    const focusSystems = bySystem
      .filter(s => s.dueCount > 0)
      .sort((a, b) => b.dueCount - a.dueCount)
      .slice(0, 4);

    return {
      total: all.length,
      dueCount: due.length,
      nextDue: upcoming[0] || null,
      recent,
      bySystem,
      recentlyStudied,
      focusSystems,
    };
  }, [entries, userSystems, t.accent]);

  // Syllabus progress — Reviewed/Total/Coverage, overall and per system.
  // See lib/syllabusProgress.js for the shared definitions/ranking rules
  // (the exact same module Review Queue's compact version reads).
  const overallProgress = useMemo(() => computeOverallProgress(entries), [entries]);
  const register = useMemo(() => buildSystemRegister(entries, userSystems, t.accent), [entries, userSystems, t.accent]);
  const [registerExpanded, setRegisterExpanded] = useState(false);

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

  const greeting = greetingFor(new Date().getHours());
  const today = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });

  const card = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
    padding:SPACE.lg, boxShadow:elevation(t,'sm') };
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

  // Only reserve a grid row/area for the card once we know it'll actually
  // render (loading or real count) — never reserve space for a card that
  // turns out to be permanently omitted (review_log unavailable), which
  // would otherwise leave a hollow gap next to "Recent Entries" spanning it.
  const showReviewedCard = dailyActivity !== null;
  const mobileAreas = ['"focus"', '"recent"', showReviewedCard && '"reviewed"', '"studied"', '"activity"']
    .filter(Boolean).join(' ');
  const desktopAreas = ['"recent focus"', showReviewedCard && '"recent reviewed"', '"recent studied"', '"activity activity"']
    .filter(Boolean).join(' ');

  return (
    <div className="mb-dash-shell">
      <style>{`
        /* No cap on mobile (the surrounding content pane already handles
           margins); from tablet up, a wide-but-bounded shell so the grid
           below has real width to work with without running edge to edge
           on a large monitor. */
        .mb-dash-shell { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }
        @media (min-width:768px) { .mb-dash-shell { max-width:1160px; margin:0 auto; } }

        .mb-dash-card:hover { border-color: ${t.borderStrong}; }
        .mb-dash-row:hover { background: ${t.surface2}; }
        .mb-dash-row:active { transform: scale(0.99); }
        .mb-hero-cta:hover { filter: brightness(1.05); }
        .mb-hero-cta:active { transform: scale(0.97); }
        .mb-ghost-cta:hover { background: ${t.surface2}; border-color: ${t.borderStrong}; }
        .mb-ghost-cta:active { transform: scale(0.97); }

        /* Summary row: 2-up on phones (no tiny/cramped 4-across squeeze),
           4-up once there's room. A short staggered fade-in on mount is
           the "metric appearance" touch — backwards fill so tiles don't
           flash visible before their delay. */
        .mb-dash-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
        @media (min-width:640px) { .mb-dash-summary { grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; } }
        .mb-dash-summary > * { animation: medbook-fade-in 220ms ease backwards; }
        .mb-dash-summary > *:nth-child(1) { animation-delay: 0ms; }
        .mb-dash-summary > *:nth-child(2) { animation-delay: 30ms; }
        .mb-dash-summary > *:nth-child(3) { animation-delay: 60ms; }

        .mb-dash-progress { background:${t.surface}; border:1px solid ${t.border}; border-radius:${RADIUS.lg}px;
          padding:${SPACE.lg}px ${SPACE.lg+2}px; box-shadow:${elevation(t,'sm')};
          margin-bottom:${SPACE.xl2}px; animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }

        /* Primary content (Recent Entries) + actionable secondary column
           (Today's Focus / Recently Studied), with System Activity using
           the full width underneath — stacked on mobile, ~70/30 from
           tablet up. Named areas rather than DOM order, specifically so
           mobile can put Today's Focus first (near the top, per the
           brief) while desktop still reads Recent Entries as primary. */
        .mb-dash-grid {
          display:grid; grid-template-columns:minmax(0,1fr); gap:20px;
          grid-template-areas: ${mobileAreas};
        }
        @media (min-width:768px) {
          .mb-dash-grid {
            grid-template-columns:minmax(0,1fr) 340px; gap:24px; align-items:start;
            grid-template-areas: ${desktopAreas};
          }
        }
        .mb-dash-recent   { grid-area:recent; }
        .mb-dash-focus    { grid-area:focus; }
        .mb-dash-reviewed { grid-area:reviewed; }
        .mb-dash-studied  { grid-area:studied; }
        .mb-dash-activity { grid-area:activity; }
      `}</style>

      {/* Page header — the greeting already reads as this screen's own
          heading (batch 3); a one-line contextual subtitle under it is
          enough, not a separate hero section. */}
      <div style={{ marginBottom:SPACE.xl2, animation:`medbook-fade-in ${MOTION.normal} ${MOTION.ease}` }}>
        <div style={{ fontSize:FONT.size.xl3, fontWeight:FONT.weight.bold, color:t.text, lineHeight:FONT.leading.tight }}>
          {greeting}
        </div>
        <div style={{ fontSize:FONT.size.base, color:t.text3, marginTop:4 }}>
          {today} · Your study overview
        </div>
      </div>

      {/* Overall Syllabus Progress — one integrated composition (coverage %,
          reviewed/total, a quiet remaining label, one proportional bar),
          not a statistic tile. See lib/syllabusProgress.js for the shared
          Reviewed/Total/Coverage definitions this reads. */}
      <div className="mb-dash-progress">
        <div style={capLabel}>Overall Syllabus Progress</div>
        <OverallSyllabusProgress colors={syllabusColors} total={overallProgress.total}
          reviewed={overallProgress.reviewed} unreviewed={overallProgress.unreviewed} />
      </div>

      {/* Compact summary row — due-review stats stay here (existing SRS
          functionality), deliberately kept out of the syllabus-progress
          composition above per the brief. */}
      <div className="mb-dash-summary" style={{ marginBottom:SPACE.xl2 }}>
        <SummaryTile t={t} icon={IconRepeat} label="Due Today" value={formatDueCount(stats.dueCount)} accent={stats.dueCount>0} />
        <SummaryTile t={t} label="Review Entries" value={stats.total} />
        <SummaryTile t={t} label="Active Systems" value={stats.bySystem.length} />
      </div>

      <div className="mb-dash-grid">

        {/* Primary content — Recent Review Entries */}
        <div className="mb-dash-recent" style={card}>
          <div style={capLabel}>Recent Review Entries</div>
          <div style={{ display:'flex', flexDirection:'column', gap:SPACE.sm }}>
            {stats.recent.map(e => (
              <EntryCard key={e.id} entry={e}
                color={userSystems?.find(s=>s.name===e.system)?.color || SYS_COLOR[e.system] || t.accent}
                showSystem onClick={() => onOpenEntry(e)} />
            ))}
          </div>
        </div>

        {/* Today's Focus — "what should I do next", using the exact same
            due/system data the summary row and Review Queue already use. */}
        <div className="mb-dash-focus" style={{ ...card,
          borderTop:`3px solid ${stats.dueCount>0?t.accent:t.ok}` }}>
          <div style={capLabel}><IconRepeat size={12} /> Today's Focus</div>

          {stats.dueCount > 0 ? (
            <>
              <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1,
                fontVariantNumeric:'tabular-nums' }}>
                {formatDueCount(stats.dueCount)} due
              </div>
              <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3, marginBottom:SPACE.md }}>
                {stats.focusSystems.length > 0
                  ? `across ${stats.focusSystems.length} system${stats.focusSystems.length===1?'':'s'}`
                  : 'ready to review now'}
              </div>
              <button className="mb-hero-cta" onClick={onStartReview} style={{
                width:'100%', background:t.accent, color:'#fff', border:'none',
                borderRadius:RADIUS.sm+1, padding:'10px 14px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold,
                cursor:'pointer', marginBottom: stats.focusSystems.length>0 ? SPACE.md : 0,
                transition:`transform ${MOTION.fast} ${MOTION.ease}` }}>
                Start Review
              </button>
              {stats.focusSystems.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                  {stats.focusSystems.map(s => (
                    <SystemRow key={s.name} t={t} system={s} onClick={()=>onNavigateSystem(s.name)}
                      badge={<DueBadge t={t} count={s.dueCount} />} />
                  ))}
                </div>
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

        {/* Daily Activity — two real per-day counts from review_log, see
            the hook above. A separate, compact presentation, deliberately
            never mixed with Overall Syllabus Progress above (that's
            cumulative coverage; this is just today). Omitted entirely (not
            rendered as 0) when the table isn't reachable, so this card
            never shows a guess. */}
        {showReviewedCard && (
          <div className="mb-dash-reviewed" style={{ ...card, borderTop:`3px solid ${t.ok}` }}>
            <div style={capLabel}><IconCheck size={12} /> Daily Activity</div>
            <div style={{ display:'flex', gap:SPACE.lg }}>
              <div>
                <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1,
                  fontVariantNumeric:'tabular-nums' }}>
                  {dailyActivity === undefined ? '–' : dailyActivity.reviewedActionsToday}
                </div>
                <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3 }}>
                  {dailyActivity === undefined ? 'Loading…'
                    : dailyActivity.reviewedActionsToday === 1 ? 'review today' : 'reviews today'}
                </div>
              </div>
              <div>
                <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1,
                  fontVariantNumeric:'tabular-nums' }}>
                  {dailyActivity === undefined || dailyActivity.firstTimeToday === null ? '–' : dailyActivity.firstTimeToday}
                </div>
                <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3 }}>
                  {dailyActivity === undefined ? 'Loading…' : 'new entries started'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recently Studied — secondary, underneath Today's Focus rather
            than standing alone with a column of empty space around it. */}
        <div className="mb-dash-studied" style={card}>
          <div style={capLabel}>Recently Studied</div>
          {stats.recentlyStudied.length === 0 ? (
            <div style={{ fontSize:FONT.size.sm, color:t.text4, lineHeight:FONT.leading.relaxed }}>
              Nothing studied yet. Ratings from Review Queue will show up here.
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {stats.recentlyStudied.map(s => (
                <SystemRow key={s.name} t={t} system={s} onClick={()=>onNavigateSystem(s.name)}
                  badge={s.dueCount > 0
                    ? <DueBadge t={t} count={s.dueCount} />
                    : <span style={{ fontSize:FONT.size.micro, color:t.text4, flexShrink:0 }}>{timeAgo(s.lastStudied)}</span>} />
              ))}
            </div>
          )}
        </div>

        {/* System Progress — the ranked register (In Progress / Not
            Started / Completed), not a decorative chart. Whole rows
            navigate to that system, same as the rest of this page. */}
        <div className="mb-dash-activity" style={card}>
          <div style={capLabel}><IconChart size={12} /> System Progress</div>
          <SystemProgressRegister colors={syllabusColors} register={register}
            onRowClick={onNavigateSystem} maxRows={8} expanded={registerExpanded}
            onToggleExpand={() => setRegisterExpanded(e => !e)} />
        </div>

      </div>
    </div>
  );
}
