import { useTheme, SPACE, RADIUS, FONT, MOTION } from '../lib/theme';
import { IconPulse, IconSearch, IconRepeat, IconCards, IconChart, IconSun, IconMoon,
  IconDownload, IconUpload, IconSettings, IconLogout } from '../lib/icons';

const NAV_ICONS = { search: IconSearch, review: IconRepeat, cards: IconCards, stats: IconChart };

export default function Sidebar({ open, width=240, entries, activeSystem, setActiveSystem,
  view, setView, onExport, onImportClick, onLogout, onManageSystems,
  userSystems, user }) {

  const { t, isDark, toggle } = useTheme();
  const total = Object.values(entries).flat().length;

  return (
    <div style={{ width:open?width:0, minWidth:open?width:0, background:t.surface,
      borderRight:`1px solid ${t.border}`, display:'flex', flexDirection:'column',
      overflow:'hidden', transition:`width ${MOTION.normal} ${MOTION.ease}`, flexShrink:0,
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

      <div style={{ padding:`${SPACE.sm}px ${SPACE.lg}px 4px`, fontSize:FONT.size.micro, letterSpacing:.8,
        color:t.text4, fontWeight:FONT.weight.semibold, textTransform:'uppercase', flexShrink:0 }}>
        Systems
      </div>

      {/* Systems */}
      <div style={{ flex:1, overflowY:'scroll', WebkitOverflowScrolling:'touch', minHeight:0 }}>
        {(userSystems || []).map(sys => {
          const cnt = (entries[sys.name] || []).length;
          const isActive = activeSystem===sys.name && ['list','add','detail'].includes(view);
          const c = sys.color || t.accent;
          return (
            <div key={sys.name} onClick={() => setActiveSystem(sys.name)}
              className="mb-navitem"
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background=t.surface2; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background='transparent'; }}
              style={{ display:'flex', alignItems:'center', padding:`7px ${SPACE.lg}px`,
                cursor:'pointer', borderLeft:`3px solid ${isActive?c:'transparent'}`,
                background:isActive?`${c}1f`:'transparent',
                transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
              <span style={{ fontSize:FONT.size.sm+0.5, flex:1, color:isActive?c:t.text2,
                fontWeight:isActive?FONT.weight.semibold:FONT.weight.regular }}>{sys.name}</span>
              {cnt > 0 && (
                <span style={{ fontSize:FONT.size.micro, background:isActive?`${c}2e`:t.surface3,
                  color:isActive?c:t.text4, borderRadius:RADIUS.pill,
                  padding:'1px 7px', fontWeight:FONT.weight.semibold }}>{cnt}</span>
              )}
            </div>
          );
        })}
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
