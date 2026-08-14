import { useMemo, useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, MOTION } from '../lib/theme';
import { computeSystemStats } from '../lib/systemStats';
import { timeAgo } from '../lib/timeAgo';
import { IconPulse, IconSearch, IconRepeat, IconCards, IconChart, IconSun, IconMoon,
  IconDownload, IconUpload, IconSettings, IconLogout, IconChevronDown } from '../lib/icons';

const NAV_ICONS = { search: IconSearch, review: IconRepeat, cards: IconCards, stats: IconChart };

export default function Sidebar({ open, width=240, entries, activeSystem, setActiveSystem,
  view, setView, onExport, onImportClick, onLogout, onManageSystems,
  userSystems, user }) {

  const { t, isDark, toggle } = useTheme();
  const total = Object.values(entries).flat().length;

  // Same rollup Dashboard uses for "recently studied" / due counts — read
  // straight off entries already in props, nothing new fetched. Systems
  // with entries keep the user's own Manage Systems order (their reordering
  // is a deliberate preference, not something to silently override);
  // "Recently Studied" is a separate callout above it, not a re-sort of it.
  const systemStats = useMemo(() => computeSystemStats(entries, userSystems, t.accent),
    [entries, userSystems, t.accent]);
  const withEntries = systemStats.filter(s => s.count > 0);
  const emptySystems = systemStats.filter(s => s.count === 0);
  const recentlyStudied = withEntries
    .filter(s => s.lastStudied)
    .sort((a, b) => b.lastStudied - a.lastStudied)
    .slice(0, 3);

  // Only worth collapsing when there's a meaningful pile of untouched
  // systems to hide AND the list isn't the user's entire (empty) starting
  // point — a brand-new account with nothing added anywhere shouldn't open
  // to a sidebar that's mostly a "+27 more" button.
  const [showEmpty, setShowEmpty] = useState(false);
  const collapseEmpty = withEntries.length > 0 && emptySystems.length > 2;

  // The outer box is the thing that actually collapses (width, a real layout
  // property — necessary so the flex row it sits in reclaims the space, not
  // just a cosmetic slide). Everything visible lives in an INNER box that
  // stays a fixed `width` the whole time and only fades in/out — without
  // that split, the content itself was being squeezed narrower as the box
  // shrank (rather than cleanly clipped), and on reopen there was nothing to
  // see until the box was already most of the way open, so the reveal read
  // as an abrupt pop instead of a slide. Closing looked fine by contrast
  // because shrinking *away* from full-width content is naturally legible;
  // growing *from* a clipped sliver isn't, without the fade.
  const collapseMs = 260;
  return (
    // No min-width here — THAT was the actual root cause of "no animation
    // while opening" (found via a vanilla-CSS repro, not just tuning): with
    // min-width set to the same target as width, min-width jumps instantly
    // (it has no transition of its own) and clamps width from below the
    // moment it's set, so on open it pins the box at full width from frame
    // one and the width transition never has room to visibly interpolate.
    // Closing was unaffected because a shrinking min-width never fights a
    // shrinking width. overflow:hidden already makes flexbox's own implicit
    // min-width:auto resolve to 0 per spec, so nothing here needs it anyway.
    <div style={{ width:open?width:0, background:t.surface,
      borderRight:`1px solid ${open?t.border:'transparent'}`, overflow:'hidden', flexShrink:0,
      transition:`width ${collapseMs}ms ${MOTION.ease}, border-color ${collapseMs}ms ${MOTION.ease}`,
      height:'100%', maxHeight:'100vh' }}>

      {/* Interactive states that inline styles can't express (:hover, :active)
          for elements in this file — kept scoped to this component's own
          class names, same idiom Auth.js already uses for its media query. */}
      <style>{`
        .mb-navitem { transition: background ${MOTION.fast} ${MOTION.ease}, color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-navitem:not(.mb-navitem--active):hover { background: ${t.surface2}; }
        .mb-navitem:active { transform: scale(0.98); }
        .mb-iconbtn { transition: background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-iconbtn:hover { background: ${t.surface2}; }
        .mb-iconbtn:active { transform: scale(0.94); }
        .mb-actionbtn { transition: background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-actionbtn:active { transform: scale(0.97); }
        .mb-theme-icon { transition: transform ${MOTION.normal} ${MOTION.ease}, opacity ${MOTION.normal} ${MOTION.ease}; }
      `}</style>

      <div style={{ width, height:'100%', display:'flex', flexDirection:'column',
        opacity:open?1:0,
        // Fading out starts immediately (matches the close feel that already
        // worked); fading in waits ~90ms so it doesn't start revealing
        // squeezed-looking content before the box has grown enough to matter.
        transition:`opacity ${open?collapseMs-40:120}ms ${MOTION.ease} ${open?'90ms':'0ms'}` }}>

      {/* Logo */}
      <div style={{ padding:`${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px`, borderBottom:`1px solid ${t.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm+2 }}>
          <div style={{ width:30, height:30, borderRadius:RADIUS.md, background:t.accent,
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'#fff', flexShrink:0 }}><IconPulse size={16} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:FONT.size.md, fontWeight:FONT.weight.bold, color:t.text }}>MedBook</div>
            <div style={{ fontSize:FONT.size.xs, color:t.text4, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{total} entries · {user?.email?.split('@')[0]}</div>
          </div>
          <button className="mb-iconbtn" onClick={toggle} title={isDark?'Switch to light mode':'Switch to dark mode'}
            style={{ background:t.surface3, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm+1,
              width:30, height:30, cursor:'pointer', flexShrink:0, position:'relative',
              display:'flex', alignItems:'center', justifyContent:'center', color:t.text2 }}>
            {/* Both icons stay mounted and cross-fade/rotate — avoids a
                content swap that would otherwise skip the transition. */}
            <IconSun size={15} className="mb-theme-icon" style={{ position:'absolute',
              opacity:isDark?0:1, transform:isDark?'rotate(-90deg) scale(.6)':'rotate(0deg) scale(1)' }} />
            <IconMoon size={15} className="mb-theme-icon" style={{ position:'absolute',
              opacity:isDark?1:0, transform:isDark?'rotate(0deg) scale(1)':'rotate(90deg) scale(.6)' }} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding:`${SPACE.sm}px ${SPACE.sm}px 2px`, flexShrink:0 }}>
        {[
          { id:'search', label:'Global Search' },
          { id:'review', label:'Review Queue' },
          { id:'cards',  label:'Flashcards' },
          { id:'stats',  label:'Dashboard' },
        ].map(n => {
          const Icon = NAV_ICONS[n.id];
          const active = view===n.id;
          return (
            <div key={n.id} onClick={() => setView(n.id)}
              className={`mb-navitem${active?' mb-navitem--active':''}`}
              style={{
                display:'flex', alignItems:'center', gap:SPACE.sm, padding:'7px 10px',
                borderRadius:RADIUS.sm+1, cursor:'pointer', marginBottom:1,
                background:active?t.navActiveBg:'transparent',
                color:active?t.navActiveText:t.text3,
                fontSize:FONT.size.base, fontWeight:active?FONT.weight.semibold:FONT.weight.medium,
              }}>
              <Icon size={15} style={{ flexShrink:0 }} />
              <span style={{ flex:1 }}>{n.label}</span>
              {n.badge && (
                <span style={{ background:t.danger, color:'#fff', borderRadius:RADIUS.pill,
                  fontSize:FONT.size.micro, fontWeight:FONT.weight.bold, padding:'1px 6px' }}>{n.badge}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Systems */}
      <div style={{ flex:1, overflowY:'scroll', WebkitOverflowScrolling:'touch', minHeight:0 }}>

        {/* Recently Studied — a callout, not a re-sort of the list below.
            Only appears once something has actually been rated at least
            once (SystemReview/ReviewQueue populate last_reviewed); a fresh
            account sees nothing here rather than an empty placeholder. */}
        {recentlyStudied.length > 0 && (
          <>
            <SectionLabel t={t}>Recently Studied</SectionLabel>
            {recentlyStudied.map(sys => (
              <SystemRow key={`recent-${sys.name}`} sys={sys} t={t}
                isActive={activeSystem===sys.name && ['list','add','detail'].includes(view)}
                onClick={() => setActiveSystem(sys.name)}
                caption={`studied ${timeAgo(sys.lastStudied)}`} />
            ))}
          </>
        )}

        <SectionLabel t={t}>Systems</SectionLabel>
        {withEntries.map(sys => (
          <SystemRow key={sys.name} sys={sys} t={t}
            isActive={activeSystem===sys.name && ['list','add','detail'].includes(view)}
            onClick={() => setActiveSystem(sys.name)}
            showProgress />
        ))}

        {emptySystems.length > 0 && (
          collapseEmpty && !showEmpty ? (
            <div className="mb-navitem" onClick={() => setShowEmpty(true)}
              style={{ display:'flex', alignItems:'center', gap:6, padding:`7px ${SPACE.lg}px`,
                cursor:'pointer', color:t.text4, fontSize:FONT.size.xs, fontWeight:FONT.weight.medium }}>
              <IconChevronDown size={12} />
              {emptySystems.length} more system{emptySystems.length===1?'':'s'} with no entries yet
            </div>
          ) : (
            <div style={{ animation: collapseEmpty ? `medbook-fade-in ${MOTION.normal} ${MOTION.ease}` : 'none' }}>
              {emptySystems.map(sys => (
                <SystemRow key={sys.name} sys={sys} t={t}
                  isActive={activeSystem===sys.name && ['list','add','detail'].includes(view)}
                  onClick={() => setActiveSystem(sys.name)} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Bottom actions */}
      <div style={{ padding:`${SPACE.md-2}px ${SPACE.md}px ${SPACE.lg-2}px`, borderTop:`1px solid ${t.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', gap:6, marginBottom:6 }}>
          <Btn t={t} onClick={onExport} icon={<IconDownload size={13} />}>Export</Btn>
          <Btn t={t} onClick={onImportClick} icon={<IconUpload size={13} />}>Import</Btn>
        </div>
        <Btn t={t} onClick={onManageSystems} icon={<IconSettings size={13} />} full style={{ marginBottom:6 }}>Manage Systems</Btn>
        <Btn t={t} onClick={onLogout} icon={<IconLogout size={13} />} danger full>Sign Out</Btn>
      </div>
      </div>
    </div>
  );
}

function Btn({ onClick, children, icon, danger, full, t }) {
  return (
    <button className="mb-actionbtn" onClick={onClick} style={{ background:danger?t.dangerBg:t.surface3,
      color:danger?t.danger:t.text2, border:`1px solid ${danger?t.dangerBorder:t.border}`,
      borderRadius:RADIUS.sm+1, padding:'6px 12px', fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold,
      cursor:'pointer', width:full?'100%':'auto', marginBottom:full?6:0,
      display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
      {icon}{children}
    </button>
  );
}

function SectionLabel({ t, children }) {
  return (
    <div style={{ padding:`${SPACE.sm}px ${SPACE.lg}px 4px`, fontSize:FONT.size.micro, letterSpacing:.8,
      color:t.text4, fontWeight:FONT.weight.semibold, textTransform:'uppercase', flexShrink:0 }}>
      {children}
    </div>
  );
}

// One system row, used for the full list, the "Recently Studied" callout,
// and the collapsed-empty group — same shape everywhere so a system looks
// like the same thing wherever it's showing up.
function SystemRow({ sys, t, isActive, onClick, caption, showProgress }) {
  const c = sys.color || t.accent;
  const pct = sys.count > 0 ? Math.round((sys.reviewedCount / sys.count) * 100) : 0;
  return (
    <div onClick={onClick} className="mb-navitem"
      style={{ padding:`6px ${SPACE.lg}px`, cursor:'pointer',
        borderLeft:`3px solid ${isActive?c:'transparent'}`,
        background:isActive?`${c}1f`:'transparent',
        transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:FONT.size.sm+0.5, flex:1, color:isActive?c:t.text2,
          fontWeight:isActive?FONT.weight.semibold:FONT.weight.regular,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sys.name}</span>
        {sys.dueCount > 0 && (
          <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold, color:t.accent,
            background:t.navActiveBg, borderRadius:RADIUS.pill, padding:'1px 6px', flexShrink:0 }}>
            {sys.dueCount} due
          </span>
        )}
        {sys.count > 0 && (
          <span style={{ fontSize:FONT.size.micro, background:isActive?`${c}2e`:t.surface3,
            color:isActive?c:t.text4, borderRadius:RADIUS.pill,
            padding:'1px 7px', fontWeight:FONT.weight.semibold, flexShrink:0 }}>{sys.count}</span>
        )}
      </div>
      {caption && (
        <div style={{ fontSize:FONT.size.micro, color:t.text4, marginTop:1 }}>{caption}</div>
      )}
      {showProgress && sys.count > 0 && (
        <div style={{ height:3, background:t.surface3, borderRadius:RADIUS.sm, marginTop:5, overflow:'hidden' }}>
          <div style={{ height:'100%', borderRadius:RADIUS.sm, background:c,
            width:`${Math.max(pct>0?4:0, pct)}%`, transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
        </div>
      )}
    </div>
  );
}
