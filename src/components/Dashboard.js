import { useMemo } from 'react';
import { SYS_COLOR } from '../lib/constants';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import EntryCard from './EntryCard';
import { IconRepeat, IconCards, IconSearch, IconPlus, IconChart } from '../lib/icons';

function timeAgo(date) {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
}

function greetingFor(hour) {
  if (hour < 5)  return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export default function Dashboard({ entries, userSystems, onOpenEntry, onNavigateSystem,
  onStartReview, onAddEntry, onStudyFlashcards, onGlobalSearch }) {
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
    const recent = [...all].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

    const bySystem = (userSystems || []).map(s => {
      const list = entries[s.name] || [];
      const lastStudied = list.reduce((max, e) => {
        if (!e.last_reviewed) return max;
        const d = new Date(e.last_reviewed);
        return (!max || d > max) ? d : max;
      }, null);
      return {
        name: s.name,
        color: s.color || SYS_COLOR[s.name] || t.accent,
        count: list.length,
        reviewedCount: list.filter(e => e.review_count > 0).length,
        dueCount: list.filter(e => e.next_review && new Date(e.next_review) <= now).length,
        lastStudied,
      };
    }).filter(s => s.count > 0);

    const recentlyStudied = bySystem
      .filter(s => s.lastStudied)
      .sort((a, b) => b.lastStudied - a.lastStudied)
      .slice(0, 4);

    return {
      total: all.length,
      dueCount: due.length,
      nextDue: upcoming[0] || null,
      reviewedCount,
      recent,
      bySystem: [...bySystem].sort((a, b) => b.count - a.count),
      recentlyStudied,
    };
  }, [entries, userSystems, t.accent]);

  const greeting = greetingFor(new Date().getHours());
  const today = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });

  const shell = { fontSize:FONT.size.xs, transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` };
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

  return (
    <div style={{ maxWidth:820, margin:'0 auto' }}>
      <style>{`
        .mb-dash-card:hover { border-color: ${t.borderStrong}; }
        .mb-dash-row:hover { background: ${t.surface2}; }
        .mb-dash-row:active { transform: scale(0.99); }
        .mb-quickaction:hover { background: ${t.surface2}; border-color: ${t.borderStrong}; }
        .mb-quickaction:active { transform: scale(0.96); }
        .mb-hero-cta:active { transform: scale(0.97); }
      `}</style>

      {/* Greeting */}
      <div style={{ marginBottom:SPACE.xl2 }}>
        <div style={{ fontSize:FONT.size.xl3, fontWeight:FONT.weight.bold, color:t.text, lineHeight:FONT.leading.tight }}>
          {greeting}
        </div>
        <div style={{ fontSize:FONT.size.base, color:t.text3, marginTop:4 }}>{today}</div>
      </div>

      {/* Today's workload */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',
        gap:SPACE.md, marginBottom:SPACE.lg }}>

        {/* Due for review — the primary, emphasised tile */}
        <div className="mb-dash-card" style={{ ...card, ...shell, gridColumn:'span 1',
          borderTop:`3px solid ${stats.dueCount>0?t.accent:t.ok}`,
          display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
          <div>
            <div style={capLabel}><IconRepeat size={12} /> Due for review</div>
            {stats.dueCount > 0 ? (
              <div style={{ fontSize:FONT.size.display-8, fontWeight:FONT.weight.bold, color:t.text }}>
                {stats.dueCount}
              </div>
            ) : (
              <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.ok }}>All caught up 🎉</div>
            )}
            <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:4 }}>
              {stats.dueCount > 0
                ? `card${stats.dueCount===1?'':'s'} ready to review now`
                : stats.nextDue
                  ? `Next due ${stats.nextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`
                  : 'Rate entries in Review Queue to start scheduling'}
            </div>
          </div>
          <button className="mb-hero-cta" onClick={onStartReview} style={{ marginTop:SPACE.md,
            background:stats.dueCount>0?t.accent:t.surface3, color:stats.dueCount>0?'#fff':t.text2,
            border:stats.dueCount>0?'none':`1px solid ${t.border}`,
            borderRadius:RADIUS.sm+1, padding:'9px 14px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold,
            cursor:'pointer', transition:`background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` }}>
            {stats.dueCount > 0 ? 'Start Review' : 'Review Queue'}
          </button>
        </div>

        <div className="mb-dash-card" style={{ ...card, ...shell }}>
          <div style={capLabel}>Total Entries</div>
          <div style={{ fontSize:FONT.size.display-8, fontWeight:FONT.weight.bold, color:t.text }}>{stats.total}</div>
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:4 }}>
            across {stats.bySystem.length} system{stats.bySystem.length===1?'':'s'}
          </div>
        </div>

        <div className="mb-dash-card" style={{ ...card, ...shell }}>
          <div style={capLabel}>Reviewed</div>
          <div style={{ fontSize:FONT.size.display-8, fontWeight:FONT.weight.bold, color:t.text }}>{stats.reviewedCount}</div>
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:4 }}>
            {Math.round((stats.reviewedCount / stats.total) * 100)}% of all entries
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display:'flex', gap:SPACE.sm, marginBottom:SPACE.xl2, flexWrap:'wrap' }}>
        {[
          { label:'Add Entry',       icon:IconPlus,   onClick:onAddEntry },
          { label:'Review Queue',    icon:IconRepeat, onClick:onStartReview },
          { label:'Flashcards',      icon:IconCards,  onClick:onStudyFlashcards },
          { label:'Search',          icon:IconSearch, onClick:onGlobalSearch },
        ].map(a => (
          <button key={a.label} className="mb-quickaction" onClick={a.onClick} style={{
            display:'flex', alignItems:'center', gap:7, background:t.surface, color:t.text2,
            border:`1px solid ${t.border}`, borderRadius:RADIUS.sm+1, padding:'9px 14px',
            fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
            transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` }}>
            <a.icon size={14} style={{ color:t.text3 }} />
            {a.label}
          </button>
        ))}
      </div>

      {/* Recent entries + recently studied */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',
        gap:SPACE.md, marginBottom:SPACE.lg, alignItems:'start' }}>

        <div style={card}>
          <div style={capLabel}>Recent Review Entries</div>
          <div style={{ display:'flex', flexDirection:'column', gap:SPACE.sm }}>
            {stats.recent.map(e => (
              <EntryCard key={e.id} entry={e}
                color={userSystems?.find(s=>s.name===e.system)?.color || SYS_COLOR[e.system] || t.accent}
                showSystem onClick={() => onOpenEntry(e)} />
            ))}
          </div>
        </div>

        <div style={card}>
          <div style={capLabel}>Recently Studied</div>
          {stats.recentlyStudied.length === 0 ? (
            <div style={{ fontSize:FONT.size.sm, color:t.text4, lineHeight:FONT.leading.relaxed }}>
              Nothing studied yet — ratings from Review Queue will show up here.
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {stats.recentlyStudied.map(s => (
                <div key={s.name} className="mb-dash-row" onClick={()=>onNavigateSystem(s.name)}
                  style={{ display:'flex', alignItems:'center', gap:SPACE.sm, padding:'9px 8px',
                    borderRadius:RADIUS.sm, cursor:'pointer',
                    transition:`background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` }}>
                  <div style={{ width:8, height:8, borderRadius:RADIUS.circle, background:s.color, flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:FONT.size.sm, color:t.text2, fontWeight:FONT.weight.medium,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                    <div style={{ fontSize:FONT.size.micro, color:t.text4 }}>studied {timeAgo(s.lastStudied)}</div>
                  </div>
                  {s.dueCount > 0 && (
                    <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold, color:t.accent,
                      background:t.navActiveBg, borderRadius:RADIUS.pill, padding:'2px 7px', flexShrink:0 }}>
                      {s.dueCount} due
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Progress by system */}
      <div style={card}>
        <div style={capLabel}><IconChart size={12} /> Progress by System</div>
        <div style={{ display:'flex', flexDirection:'column', gap:SPACE.md }}>
          {stats.bySystem.map(s => {
            const pct = Math.round((s.reviewedCount / s.count) * 100);
            return (
              <div key={s.name}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4 }}>
                  <span style={{ fontSize:FONT.size.sm, color:t.text2, fontWeight:FONT.weight.medium }}>{s.name}</span>
                  <span style={{ fontSize:FONT.size.xs, color:t.text4 }}>
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
  );
}
