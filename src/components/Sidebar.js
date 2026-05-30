import { SYSTEMS, SYS_COLOR } from '../lib/constants';

export default function Sidebar({ open, entries, activeSystem, setActiveSystem, view, setView, onExport, onImportClick, onLogout, user }) {
  const total = Object.values(entries).flat().length;

  return (
    <div style={{
      width: open ? 234 : 0, minWidth: open ? 234 : 0,
      background: '#10121a', borderRight: '1px solid #1c1f2e',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      transition: 'all .22s ease', flexShrink: 0, fontFamily: "'Syne', sans-serif"
    }}>
      {/* Header */}
      <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid #1c1f2e', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: 'linear-gradient(135deg, #e74c3c, #9b59b6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>⚕</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>MedBook</div>
            <div style={{ fontSize: 10, color: '#3a4060' }}>{total} entries · {user?.email?.split('@')[0]}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: '10px 10px 4px', flexShrink: 0 }}>
        {[
          { id: 'search', icon: '⌕', label: 'Global Search' },
          { id: 'stats',  icon: '◈', label: 'Dashboard' },
        ].map(n => (
          <div key={n.id} onClick={() => setView(n.id)} style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
            borderRadius: 8, cursor: 'pointer', marginBottom: 2,
            background: view === n.id ? '#1c1f2e' : 'transparent',
            color: view === n.id ? '#fff' : '#4a5070',
            fontSize: 13, fontWeight: 600, transition: 'all .12s'
          }}>
            <span style={{ fontSize: 16 }}>{n.icon}</span>{n.label}
          </div>
        ))}
      </div>

      <div style={{ padding: '4px 16px 6px', fontSize: 9, letterSpacing: 2, color: '#2a2f42', fontWeight: 800, flexShrink: 0 }}>
        ORGAN SYSTEMS
      </div>

      {/* Systems list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {SYSTEMS.map(sys => {
          const cnt = (entries[sys] || []).length;
          const isActive = activeSystem === sys && ['list','add','detail'].includes(view);
          const c = SYS_COLOR[sys];
          return (
            <div key={sys}
              onClick={() => { setActiveSystem(sys); setView('list'); }}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '8px 16px', cursor: 'pointer',
                background: isActive ? `${c}18` : 'transparent',
                borderLeft: `3px solid ${isActive ? c : 'transparent'}`,
                transition: 'all .12s'
              }}>
              <span style={{
                fontSize: 12, flex: 1,
                color: isActive ? '#fff' : '#5a6580',
                fontWeight: isActive ? 700 : 400
              }}>{sys}</span>
              {cnt > 0 && (
                <span style={{
                  fontSize: 9, background: isActive ? c : '#1c1f2e',
                  color: isActive ? '#fff' : '#4a5070',
                  borderRadius: 10, padding: '2px 7px', fontWeight: 700
                }}>{cnt}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div style={{ padding: '10px 12px 14px', borderTop: '1px solid #1c1f2e', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Btn onClick={onExport} color="#4a5070">⬇ Export</Btn>
          <Btn onClick={onImportClick} color="#4a5070">⬆ Import</Btn>
        </div>
        <Btn onClick={onLogout} color="#e74c3c" full>Sign Out</Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, color, children, full }) {
  return (
    <button onClick={onClick} style={{
      background: '#1c1f2e', color, border: `1px solid ${color}30`,
      borderRadius: 7, padding: '6px 12px', fontSize: 11,
      fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
      width: full ? '100%' : 'auto'
    }}>{children}</button>
  );
}
