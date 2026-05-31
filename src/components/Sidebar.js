import { SYSTEMS, SYS_COLOR } from '../lib/constants';

export default function Sidebar({ open, entries, activeSystem, setActiveSystem, view, setView, onExport, onImportClick, onLogout, user }) {
  const total = Object.values(entries).flat().length;

  return (
    <div style={{
      width: open ? 240 : 0, minWidth: open ? 240 : 0,
      background: '#fff', borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      transition: 'all .2s ease', flexShrink: 0,
      height: '100%', maxHeight: '100vh',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: '#2563eb', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 15, color: '#fff'
          }}>⚕</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>MedBook</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{total} entries · {user?.email?.split('@')[0]}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        {[
          { id: 'search', icon: '🔍', label: 'Global Search' },
          { id: 'stats',  icon: '📊', label: 'Dashboard' },
        ].map(n => (
          <div key={n.id} onClick={() => setView(n.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
            borderRadius: 7, cursor: 'pointer', marginBottom: 1,
            background: view === n.id ? '#eff6ff' : 'transparent',
            color: view === n.id ? '#2563eb' : '#6b7280',
            fontSize: 13, fontWeight: view === n.id ? 600 : 500,
            transition: 'all .1s'
          }}>
            <span style={{ fontSize: 14 }}>{n.icon}</span>{n.label}
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 16px 4px', fontSize: 10, letterSpacing: 0.8,
        color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}>
        Systems
      </div>

      {/* Systems list */}
      <div style={{ flex: 1, overflowY: 'scroll', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
        {SYSTEMS.map(sys => {
          const cnt = (entries[sys] || []).length;
          const isActive = activeSystem === sys && ['list','add','detail'].includes(view);
          const c = SYS_COLOR[sys];
          return (
            <div key={sys} onClick={() => { setActiveSystem(sys); setView('list'); }}
              style={{
                display: 'flex', alignItems: 'center', padding: '7px 16px',
                cursor: 'pointer', borderLeft: `3px solid ${isActive ? c : 'transparent'}`,
                background: isActive ? `${c}0d` : 'transparent',
                transition: 'all .1s'
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
              <span style={{
                fontSize: 12.5, flex: 1,
                color: isActive ? c : '#374151',
                fontWeight: isActive ? 600 : 400
              }}>{sys}</span>
              {cnt > 0 && (
                <span style={{
                  fontSize: 10, background: isActive ? `${c}18` : '#f3f4f6',
                  color: isActive ? c : '#9ca3af',
                  borderRadius: 10, padding: '1px 7px', fontWeight: 600
                }}>{cnt}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div style={{ padding: '10px 12px 14px', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <Btn onClick={onExport}>⬇ Export</Btn>
          <Btn onClick={onImportClick}>⬆ Import</Btn>
        </div>
        <Btn onClick={onLogout} danger full>Sign Out</Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, children, danger, full }) {
  return (
    <button onClick={onClick} style={{
      background: danger ? '#fef2f2' : '#f3f4f6',
      color: danger ? '#dc2626' : '#374151',
      border: `1px solid ${danger ? '#fecaca' : '#e5e7eb'}`,
      borderRadius: 7, padding: '6px 12px', fontSize: 11,
      fontWeight: 600, cursor: 'pointer',
      width: full ? '100%' : 'auto'
    }}>{children}</button>
  );
}
