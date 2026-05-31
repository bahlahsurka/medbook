import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { SYSTEMS, SYS_COLOR } from './lib/constants';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import EntryCard from './components/EntryCard';
import AddEntry from './components/AddEntry';
import DetailView from './components/DetailView';
import Dashboard from './components/Dashboard';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState({});
  const [fetching, setFetching] = useState(false);

  const [activeSystem, setActiveSystem] = useState('Internal Medicine');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const toastTimer = useRef();
  const importRef = useRef();

  // Responsive handler
  useEffect(() => {
    const handle = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  // Close sidebar on mobile when navigating
  const navigate = useCallback((sys, v) => {
    setActiveSystem(sys);
    setView(v);
    setSearch('');
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Load entries
  useEffect(() => {
    if (!session) { setEntries({}); return; }
    setFetching(true);
    supabase.from('entries')
      .select('*').eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { showToast('Failed to load entries', 'err'); setFetching(false); return; }
        const grouped = {};
        SYSTEMS.forEach(s => { grouped[s] = []; });
        (data || []).forEach(e => {
          if (grouped[e.system]) grouped[e.system].push(e);
          else grouped[e.system] = [e];
        });
        setEntries(grouped);
        setFetching(false);
      });
  }, [session]);

  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const logout = () => supabase.auth.signOut();

  const onSaved = useCallback((entry) => {
    setEntries(prev => ({ ...prev, [entry.system]: [entry, ...(prev[entry.system] || [])] }));
    setView('list');
    showToast('Entry saved ✓');
  }, [showToast]);

  const onDeleted = useCallback((id, system) => {
    setEntries(prev => ({ ...prev, [system]: (prev[system] || []).filter(e => e.id !== id) }));
    setView('list'); setSelected(null);
    showToast('Entry deleted', 'warn');
  }, [showToast]);

  const onUpdated = useCallback((updated) => {
    setEntries(prev => ({
      ...prev,
      [updated.system]: (prev[updated.system] || []).map(e => e.id === updated.id ? updated : e)
    }));
    setSelected(updated);
    showToast('Reviewed ✓');
  }, [showToast]);

  const exportJSON = () => {
    const all = Object.values(entries).flat();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medbook_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Exported ✓');
  };

  const importJSON = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('Invalid format');
        const toInsert = data.map(({ id, ...rest }) => ({ ...rest, user_id: session.user.id }));
        const { error } = await supabase.from('entries').insert(toInsert);
        if (error) throw error;
        showToast(`Imported ${toInsert.length} entries ✓`);
        const { data: fresh } = await supabase.from('entries')
          .select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        const grouped = {};
        SYSTEMS.forEach(s => { grouped[s] = []; });
        (fresh || []).forEach(e => { if (grouped[e.system]) grouped[e.system].push(e); });
        setEntries(grouped);
      } catch (err) { showToast('Import failed: ' + err.message, 'err'); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const sysEntries = (entries[activeSystem] || []).filter(e => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return e.title?.toLowerCase().includes(q) ||
      e.topic?.toLowerCase().includes(q) ||
      e.notes?.toLowerCase().includes(q);
  });

  const globalResults = globalSearch.trim()
    ? Object.values(entries).flat().filter(e => {
        const q = globalSearch.toLowerCase();
        return e.title?.toLowerCase().includes(q) ||
          e.topic?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q);
      }).slice(0, 50)
    : [];

  const color = SYS_COLOR[activeSystem] || '#2563eb';

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
      Loading…
    </div>
  );

  if (!session) return <Auth />;

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f3f4f6', overflow: 'hidden' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 999,
          background: toast.type === 'err' ? '#dc2626' : toast.type === 'warn' ? '#d97706' : '#16a34a',
          color: '#fff', borderRadius: 8, padding: '10px 18px',
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,.15)',
          pointerEvents: 'none', maxWidth: 'calc(100vw - 40px)'
        }}>{toast.msg}</div>
      )}

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40
        }} />
      )}

      {/* Import input */}
      <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importJSON} />

      {/* Sidebar — fixed on mobile */}
      <div style={{
        position: isMobile ? 'fixed' : 'relative',
        left: isMobile ? (sidebarOpen ? 0 : -260) : 'auto',
        top: 0, bottom: 0, zIndex: 50,
        transition: isMobile ? 'left .22s ease' : 'none',
        width: 240, flexShrink: 0,
        display: (!isMobile && !sidebarOpen) ? 'none' : 'block'
      }}>
        <Sidebar
          open={true}
          entries={entries}
          activeSystem={activeSystem}
          setActiveSystem={(sys) => navigate(sys, 'list')}
          view={view}
          setView={(v) => { setView(v); if (isMobile) setSidebarOpen(false); }}
          onExport={exportJSON}
          onImportClick={() => importRef.current?.click()}
          onLogout={logout}
          user={session.user}
        />
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
          background: '#fff', flexShrink: 0,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}>
          <button onClick={() => setSidebarOpen(p => !p)}
            style={{ background: 'none', border: 'none', color: '#6b7280',
              cursor: 'pointer', fontSize: 18, padding: '2px 4px', flexShrink: 0 }}>☰</button>

          {view === 'stats'  && <span style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>Dashboard</span>}
          {view === 'search' && <span style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>Global Search</span>}
          {['list','add','detail'].includes(view) && (
            <>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#111827',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeSystem}
              </span>
              {view === 'list' && (
                <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>
                  {sysEntries.length}
                </span>
              )}
            </>
          )}

          <div style={{ flex: 1 }} />

          {view === 'list' && !isMobile && (
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7,
                color: '#111827', padding: '7px 12px', fontSize: 13, width: 180, outline: 'none' }} />
          )}

          {view === 'search' && (
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search all systems…" autoFocus
              style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7,
                color: '#111827', padding: '7px 12px', fontSize: 13,
                width: isMobile ? '100%' : 260, outline: 'none', flex: isMobile ? 1 : 'none' }} />
          )}

          {view === 'list' && (
            <button onClick={() => setView('add')}
              style={{ background: color, color: '#fff', border: 'none', borderRadius: 7,
                padding: isMobile ? '8px 12px' : '8px 16px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
              {isMobile ? '+' : '+ Add Entry'}
            </button>
          )}

          {(view === 'add' || view === 'detail') && (
            <button onClick={() => setView('list')}
              style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
                borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
              ← Back
            </button>
          )}
        </div>

        {/* Mobile search bar (list view only) */}
        {isMobile && view === 'list' && (
          <div style={{ padding: '8px 12px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${activeSystem}…`}
              style={{ width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 7, color: '#111827', padding: '8px 12px',
                fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '20px' }}>

          {fetching && (
            <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: 60, fontSize: 14 }}>
              Loading your notebook…
            </div>
          )}

          {/* GLOBAL SEARCH */}
          {!fetching && view === 'search' && (
            <div style={{ maxWidth: 680, margin: '0 auto' }}>
              {globalSearch && globalResults.length === 0 && (
                <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40, fontSize: 14 }}>
                  No results found
                </div>
              )}
              {!globalSearch && (
                <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40, fontSize: 14 }}>
                  Type to search across all systems
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {globalResults.map(e => (
                  <EntryCard key={e.id} entry={e} color={SYS_COLOR[e.system]} showSystem
                    onClick={() => {
                      setActiveSystem(e.system); setSelected(e); setView('detail');
                      if (isMobile) setSidebarOpen(false);
                    }} />
                ))}
              </div>
            </div>
          )}

          {/* DASHBOARD */}
          {!fetching && view === 'stats' && <Dashboard entries={entries} />}

          {/* ADD */}
          {!fetching && view === 'add' && (
            <AddEntry activeSystem={activeSystem} color={color}
              userId={session.user.id} onSaved={onSaved} onCancel={() => setView('list')} />
          )}

          {/* DETAIL */}
          {!fetching && view === 'detail' && selected && (
            <DetailView entry={selected} onBack={() => setView('list')}
              onDeleted={onDeleted} onUpdated={onUpdated} />
          )}

          {/* LIST */}
          {!fetching && view === 'list' && (
            <div style={{ maxWidth: 680, margin: '0 auto' }}>
              {sysEntries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                  <div style={{ fontSize: 14, color: '#6b7280' }}>
                    {search ? 'No entries match your search' : `No entries yet for ${activeSystem}`}
                  </div>
                  {!search && (
                    <button onClick={() => setView('add')} style={{
                      marginTop: 16, background: color, color: '#fff', border: 'none',
                      borderRadius: 8, padding: '10px 22px', fontSize: 13,
                      fontWeight: 600, cursor: 'pointer'
                    }}>+ Add First Entry</button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sysEntries.map(entry => (
                    <EntryCard key={entry.id} entry={entry} color={color}
                      onClick={() => { setSelected(entry); setView('detail'); }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
