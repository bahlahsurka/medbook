import { useMemo } from 'react';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { computeSystemStats } from '../lib/systemStats';
import { timeAgo } from '../lib/timeAgo';
import { SYS_COLOR } from '../lib/constants';
import EntryCard from './EntryCard';
import { IconRepeat, IconPlus, IconChart } from '../lib/icons';

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

export default function Dashboard({ entries, userSystems, onOpenEntry, onNavigateSystem,
  onStartReview, onAddEntry }) {
  const { t } = useTheme();

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
    const reviewedCount = all.filter(e => e.review_count > 0).length;
    const recent = [...all].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);

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

    // The biggest few systems by volume — where the study workload is
    // actually concentrated, not an exhaustive list of every system the
    // user has ever touched (which could be 20+).
    const activitySystems = [...bySystem].sort((a, b) => b.count - a.count).slice(0, 6);

    return {
      total: all.length,
      dueCount: due.length,
      nextDue: upcoming[0] || null,
      reviewedCount,
      recent,
      bySystem,
      recentlyStudied,
      focusSystems,
      activitySystems,
    };
  }, [entries, userSystems, t.accent]);

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
          Your dashboard fills in once you start capturing what you're learning —
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

  const reviewedPct = stats.total ? Math.round((stats.reviewedCount / stats.total) * 100) : 0;

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
        @media (min-width:640px) { .mb-dash-summary { grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; } }
        .mb-dash-summary > * { animation: medbook-fade-in 220ms ease backwards; }
        .mb-dash-summary > *:nth-child(1) { animation-delay: 0ms; }
        .mb-dash-summary > *:nth-child(2) { animation-delay: 30ms; }
        .mb-dash-summary > *:nth-child(3) { animation-delay: 60ms; }
        .mb-dash-summary > *:nth-child(4) { animation-delay: 90ms; }

        /* Primary content (Recent Entries) + actionable secondary column
           (Today's Focus / Recently Studied), with System Activity using
           the full width underneath — stacked on mobile, ~70/30 from
           tablet up. Named areas rather than DOM order, specifically so
           mobile can put Today's Focus first (near the top, per the
           brief) while desktop still reads Recent Entries as primary. */
        .mb-dash-grid {
          display:grid; grid-template-columns:minmax(0,1fr); gap:20px;
          grid-template-areas: "focus" "recent" "studied" "activity";
        }
        @media (min-width:768px) {
          .mb-dash-grid {
            grid-template-columns:minmax(0,1fr) 340px; gap:24px; align-items:start;
            grid-template-areas: "recent focus" "recent studied" "activity activity";
          }
        }
        .mb-dash-recent   { grid-area:recent; }
        .mb-dash-focus    { grid-area:focus; }
        .mb-dash-studied  { grid-area:studied; }
        .mb-dash-activity { grid-area:activity; }

        /* System Activity: a single narrow list stretched across the full
           ~70% width would just relocate the empty-space problem this
           redesign exists to fix — two columns once there's room instead. */
        .mb-dash-activity-grid { display:flex; flex-direction:column; gap:${SPACE.xs}px; }
        @media (min-width:768px) {
          .mb-dash-activity-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:${SPACE.xs}px ${SPACE.lg}px; }
        }
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

      {/* Compact summary row */}
      <div className="mb-dash-summary" style={{ marginBottom:SPACE.xl2 }}>
        <SummaryTile t={t} icon={IconRepeat} label="Due Today" value={stats.dueCount} accent={stats.dueCount>0} />
        <SummaryTile t={t} label="Review Entries" value={stats.total} />
        <SummaryTile t={t} label="Reviewed" value={`${reviewedPct}%`} sub={`${stats.reviewedCount} entries`} />
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
              <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.1 }}>
                {stats.dueCount} due
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

        {/* Recently Studied — secondary, underneath Today's Focus rather
            than standing alone with a column of empty space around it. */}
        <div className="mb-dash-studied" style={card}>
          <div style={capLabel}>Recently Studied</div>
          {stats.recentlyStudied.length === 0 ? (
            <div style={{ fontSize:FONT.size.sm, color:t.text4, lineHeight:FONT.leading.relaxed }}>
              Nothing studied yet — ratings from Review Queue will show up here.
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

        {/* System Activity — where the workload is concentrated, not a
            decorative chart. Real per-system counts, same colours as the
            rest of the app. */}
        <div className="mb-dash-activity" style={card}>
          <div style={capLabel}><IconChart size={12} /> System Activity</div>
          <div className="mb-dash-activity-grid">
            {stats.activitySystems.map(s => {
              const pct = Math.round((s.reviewedCount / s.count) * 100);
              return (
                <div key={s.name} className="mb-dash-row" onClick={()=>onNavigateSystem(s.name)} style={{
                  padding:8, borderRadius:RADIUS.sm, cursor:'pointer',
                  transition:`background ${MOTION.fast} ${MOTION.ease}` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:FONT.size.sm, color:t.text2, fontWeight:FONT.weight.medium,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</span>
                    <span style={{ fontSize:FONT.size.micro, color:t.text4, flexShrink:0 }}>
                      {s.reviewedCount}/{s.count} reviewed{s.dueCount>0?` · ${s.dueCount} due`:''}
                    </span>
                  </div>
                  <div style={{ height:5, background:t.surface3, borderRadius:RADIUS.sm }}>
                    <div style={{ height:'100%', borderRadius:RADIUS.sm, background:s.color,
                      width:`${Math.max(pct>0?4:0, pct)}%`,
                      transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
