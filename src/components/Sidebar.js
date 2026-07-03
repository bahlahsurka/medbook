import { useTheme } from '../lib/theme';

export default function Sidebar({ open, entries, activeSystem, setActiveSystem,
  view, setView, onExport, onImportClick, onLogout, onManageSystems,
  userSystems, user, dueCount }) {

  const { t, isDark, toggle } = useTheme();
  const total = Object.values(entries).flat().length;

  return (
    <div style={{ width:open?240:0, minWidth:open?240:0, background:t.surface,
      borderRight:`1px solid ${t.border}`, display:'flex', flexDirection:'column',
      overflow:'hidden', transition:'all .2s ease', flexShrink:0,
      height:'100%', maxHeight:'100vh', fontFamily:'Inter,sans-serif' }}>

      {/* Logo */}
      <div style={{ padding:'16px 16px 12px', borderBottom:`1px solid ${t.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:t.accent,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:15, color:'#fff', flexShrink:0 }}>⚕</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, color:t.text }}>MedBook</div>
            <div style={{ fontSize:11, color:t.text4, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{total} entries · {user?.email?.split('@')[0]}</div>
          </div>
          <button onClick={toggle} title={isDark?'Switch to light mode':'Switch to dark mode'}
            style={{ background:t.surface3, border:`1px solid ${t.border}`, borderRadius:7,
              width:30, height:30, cursor:'pointer', fontSize:14, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center', color:t.text2 }}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding:'8px 8px 2px', flexShrink:0 }}>
        {[
          { id:'search', icon:'🔍', label:'Global Search' },
          { id:'review', icon:'🔁', label:'Review Queue', badge: dueCount > 0 ? dueCount : null },
          { id:'cards',  icon:'🃏', label:'Flashcards' },
          { id:'stats',  icon:'📊', label:'Dashboard' },
        ].map(n => (
          <div key={n.id} onClick={() => setView(n.id)} style={{
            display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
            borderRadius:7, cursor:'pointer', marginBottom:1,
            background:view===n.id?t.navActiveBg:'transparent',
            color:view===n.id?t.navActiveText:t.text3,
            fontSize:13, fontWeight:view===n.id?600:500, transition:'all .1s'
          }}>
            <span style={{ fontSize:14 }}>{n.icon}</span>
            <span style={{ flex:1 }}>{n.label}</span>
            {n.badge && (
              <span style={{ background:t.danger, color:'#fff', borderRadius:10,
                fontSize:10, fontWeight:700, padding:'1px 6px' }}>{n.badge}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding:'8px 16px 4px', fontSize:10, letterSpacing:.8,
        color:t.text4, fontWeight:600, textTransform:'uppercase', flexShrink:0 }}>
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
              style={{ display:'flex', alignItems:'center', padding:'7px 16px',
                cursor:'pointer', borderLeft:`3px solid ${isActive?c:'transparent'}`,
                background:isActive?`${c}1f`:'transparent', transition:'all .1s' }}>
              <span style={{ fontSize:12.5, flex:1, color:isActive?c:t.text2,
                fontWeight:isActive?600:400 }}>{sys.name}</span>
              {cnt > 0 && (
                <span style={{ fontSize:10, background:isActive?`${c}2e`:t.surface3,
                  color:isActive?c:t.text4, borderRadius:10,
                  padding:'1px 7px', fontWeight:600 }}>{cnt}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ padding:'10px 12px 14px', borderTop:`1px solid ${t.border}`, flexShrink:0 }}>
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
      borderRadius:7, padding:'6px 12px', fontSize:11, fontWeight:600,
      cursor:'pointer', width:full?'100%':'auto', marginBottom:full?6:0,
      fontFamily:'Inter,sans-serif' }}>{children}</button>
  );
}
