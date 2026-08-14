import { useTheme, SPACE, RADIUS, FONT, MOTION } from '../lib/theme';

export default function Sidebar({ open, entries, activeSystem, setActiveSystem,
  view, setView, onExport, onImportClick, onLogout, onManageSystems,
  userSystems, user }) {

  const { t, isDark, toggle } = useTheme();
  const total = Object.values(entries).flat().length;

  return (
    <div style={{ width:open?240:0, minWidth:open?240:0, background:t.surface,
      borderRight:`1px solid ${t.border}`, display:'flex', flexDirection:'column',
      overflow:'hidden', transition:`width ${MOTION.normal} ${MOTION.ease}`, flexShrink:0,
      height:'100%', maxHeight:'100vh' }}>

      {/* Logo */}
      <div style={{ padding:`${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px`, borderBottom:`1px solid ${t.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm+2 }}>
          <div style={{ width:30, height:30, borderRadius:RADIUS.md, background:t.accent,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:FONT.size.lg-1, color:'#fff', flexShrink:0 }}>⚕</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:FONT.size.md, fontWeight:FONT.weight.bold, color:t.text }}>MedBook</div>
            <div style={{ fontSize:FONT.size.xs, color:t.text4, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{total} entries · {user?.email?.split('@')[0]}</div>
          </div>
          <button onClick={toggle} title={isDark?'Switch to light mode':'Switch to dark mode'}
            style={{ background:t.surface3, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm+1,
              width:30, height:30, cursor:'pointer', fontSize:FONT.size.md, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center', color:t.text2,
              transition:`background ${MOTION.fast} ${MOTION.ease}` }}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding:`${SPACE.sm}px ${SPACE.sm}px 2px`, flexShrink:0 }}>
        {[
          { id:'search', icon:'🔍', label:'Global Search' },
          { id:'review', icon:'🔁', label:'Review Queue' },
          { id:'cards',  icon:'🃏', label:'Flashcards' },
          { id:'stats',  icon:'📊', label:'Dashboard' },
        ].map(n => (
          <div key={n.id} onClick={() => setView(n.id)} style={{
            display:'flex', alignItems:'center', gap:SPACE.sm, padding:'7px 10px',
            borderRadius:RADIUS.sm+1, cursor:'pointer', marginBottom:1,
            background:view===n.id?t.navActiveBg:'transparent',
            color:view===n.id?t.navActiveText:t.text3,
            fontSize:FONT.size.base, fontWeight:view===n.id?FONT.weight.semibold:FONT.weight.medium,
            transition:`background ${MOTION.fast} ${MOTION.ease}, color ${MOTION.fast} ${MOTION.ease}`
          }}>
            <span style={{ fontSize:FONT.size.md }}>{n.icon}</span>
            <span style={{ flex:1 }}>{n.label}</span>
            {n.badge && (
              <span style={{ background:t.danger, color:'#fff', borderRadius:RADIUS.pill,
                fontSize:FONT.size.micro, fontWeight:FONT.weight.bold, padding:'1px 6px' }}>{n.badge}</span>
            )}
          </div>
        ))}
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
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background=t.surface2; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background='transparent'; }}
              style={{ display:'flex', alignItems:'center', padding:`7px ${SPACE.lg}px`,
                cursor:'pointer', borderLeft:`3px solid ${isActive?c:'transparent'}`,
                background:isActive?`${c}1f`:'transparent',
                transition:`background ${MOTION.fast} ${MOTION.ease}` }}>
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
          <Btn t={t} onClick={onExport}>⬇ Export</Btn>
          <Btn t={t} onClick={onImportClick}>⬆ Import</Btn>
        </div>
        <Btn t={t} onClick={onManageSystems} full style={{ marginBottom:6 }}>⚙ Manage Systems</Btn>
        <Btn t={t} onClick={onLogout} danger full>Sign Out</Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, children, danger, full, t }) {
  return (
    <button onClick={onClick} style={{ background:danger?t.dangerBg:t.surface3,
      color:danger?t.danger:t.text2, border:`1px solid ${danger?t.dangerBorder:t.border}`,
      borderRadius:RADIUS.sm+1, padding:'6px 12px', fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold,
      cursor:'pointer', width:full?'100%':'auto', marginBottom:full?6:0,
      transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>{children}</button>
  );
}
