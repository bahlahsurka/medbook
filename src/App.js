import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { SYSTEMS, SYS_COLOR, loadUserSystems, saveUserSystems } from './lib/constants';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import EntryCard from './components/EntryCard';
import AddEntry from './components/AddEntry';
import DetailView from './components/DetailView';
import Dashboard from './components/Dashboard';
import ManageSystems from './components/ManageSystems';
import ReviewQueue from './components/ReviewQueue';
import Onboarding from './components/Onboarding';

const ONBOARD_KEY = 'medbook_onboarded';

export default function App() {
  const [session, setSession]     = useState(null);
  const [authLoading, setAL]      = useState(true);
  const [entries, setEntries]     = useState({});
  const [fetching, setFetching]   = useState(false);
  const [fetchErr, setFetchErr]   = useState('');
  const [activeSystem, setAS]     = useState('Internal Medicine');
  const [view, setView]           = useState('list');
  const [selected, setSelected]   = useState(null);
  const [sidebarOpen, setSB]      = useState(window.innerWidth > 768);
  const [isMobile, setMobile]     = useState(window.innerWidth <= 768);
  const [search, setSearch]       = useState('');
  const [globalSearch, setGS]     = useState('');
  const [toast, setToast]         = useState(null);
  const [userSystems, setUS]      = useState(() => loadUserSystems());
  const [showManage, setManage]   = useState(false);
  const [showOnboard, setOnboard] = useState(() => !localStorage.getItem(ONBOARD_KEY));

  const toastRef  = useRef();
  const importRef = useRef();

  // Resize
  useEffect(() => {
    const fn = () => {
      setMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) setSB(true);
    };
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setAL(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Load entries — one simple fetch, no retries, no tricks
  const loadEntries = useCallback(async (sess, systems) => {
    if (!sess) { setEntries({}); return; }
    setFetching(true); setFetchErr('');
    try {
      const { data, error } = await supabase
        .from('entries')
        .select('*')
        .eq('user_id', sess.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const g = {};
      SYSTEMS.forEach(s => { g[s] = []; });
      systems.forEach(s => { if (!g[s.name]) g[s.name] = []; });
      (data || []).forEach(e => {
        if (!g[e.system]) g[e.system] = [];
        g[e.system].push(e);
      });
      setEntries(g);
      setFetchErr('');
    } catch (e) {
      setFetchErr(e.message || 'Could not load entries');
    }
    setFetching(false);
  }, []);

  useEffect(() => {
    loadEntries(session, userSystems);
  }, [session]);

  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const navigate = useCallback((sys, v = 'list') => {
    setAS(sys); setView(v); setSearch('');
    if (window.innerWidth <= 768) setSB(false);
  }, []);

  const switchView = useCallback((v) => {
    setView(v);
    if (window.innerWidth <= 768) setSB(false);
  }, []);

  // Entry mutations — all local + already saved to DB in child
  const onSaved = useCallback((saved) => {
    const arr = Array.isArray(saved) ? saved : [saved];
    setEntries(prev => {
      const next = { ...prev };
      arr.forEach(e => { next[e.system] = [e, ...(next[e.system] || [])]; });
      return next;
    });
    setView('list');
    showToast(arr.length > 1 ? `Saved to ${arr.length} systems ✓` : 'Entry saved ✓');
  }, [showToast]);

  const onDeleted = useCallback((id, system) => {
    setEntries(prev => ({
      ...prev, [system]: (prev[system] || []).filter(e => e.id !== id)
    }));
    setView('list'); setSelected(null);
    showToast('Entry deleted', 'warn');
  }, [showToast]);

  const onUpdated = useCallback((updated) => {
    setEntries(prev => ({
      ...prev,
      [updated.system]: (prev[updated.system] || []).map(e => e.id === updated.id ? updated : e)
    }));
    setSelected(updated);
  }, []);

  const onReviewed = useCallback((updated) => {
    setEntries(prev => ({
      ...prev,
      [updated.system]: (prev[updated.system] || []).map(e => e.id === updated.id ? updated : e)
    }));
  }, []);

  // Export
  const exportJSON = () => {
    const blob = new Blob(
      [JSON.stringify(Object.values(entries).flat(), null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medbook_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Exported ✓');
  };

  // Import
  const importJSON = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('Invalid file format');
        const rows = data.map(({ id, ...rest }) => ({ ...rest, user_id: session.user.id }));
        const { error } = await supabase.from('entries').insert(rows);
        if (error) throw error;
        showToast(`Imported ${rows.length} entries ✓`);
        loadEntries(session, userSystems);
      } catch (err) { showToast('Import failed: ' + err.message, 'err'); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  // Manage systems
  const handleSaveSystems = (list) => {
    saveUserSystems(list);
    setUS(list);
    if (!list.find(s => s.name === activeSystem)) setAS(list[0]?.name || '');
    setManage(false);
    showToast('Systems updated ✓');
  };

  // Computed
  const sysEntries = useMemo(() => {
    const all = entries[activeSystem] || [];
    const filtered = search.trim()
      ? all.filter(e => {
          const q = search.toLowerCase();
          return e.title?.toLowerCase().includes(q) ||
                 e.notes?.toLowerCase().includes(q);
        })
      : all;
    return [...filtered].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
  }, [entries, activeSystem, search]);

  const globalResults = useMemo(() => {
    if (!globalSearch.trim()) return [];
    const q = globalSearch.toLowerCase();
    return Object.values(entries).flat().filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.notes?.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [globalSearch, entries]);

  const dueCount = useMemo(() => {
    const now = new Date();
    return Object.values(entries).flat()
      .filter(e => e.next_review && new Date(e.next_review) <= now).length;
  }, [entries]);

  const color = userSystems.find(s => s.name === activeSystem)?.color
    || SYS_COLOR[activeSystem] || '#2563eb';

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb',
          borderTop: '3px solid #2563eb', borderRadius: '50%',
          animation: 'spin .8s linear infinite', margin: '0 auto 12px' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
      </div>
    </div>
  );

  if (!session) return <Auth />;

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f3f4f6',
      overflow: 'hidden', fontFamily: 'Inter,sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 999,
          background: toast.type === 'err' ? '#dc2626' : toast.type === 'warn' ? '#d97706' : '#16a34a',
          color: '#fff', borderRadius: 8, padding: '11px 18px',
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,.2)',
          pointerEvents: 'none', maxWidth: 'calc(100vw - 40px)'
        }}>{toast.msg}</div>
      )}

      {showOnboard && <Onboarding onDone={() => {
        localStorage.setItem(ONBOARD_KEY, '1'); setOnboard(false);
      }} />}

      {showManage && (
        <ManageSystems systems={userSystems}
          onSave={handleSaveSystems} onClose={() => setManage(false)} />
      )}

      {isMobile && sidebarOpen && (
        <div onClick={() => setSB(false)} style={{ position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)', zIndex: 40 }} />
      )}

      <input ref={importRef} type="file" accept=".json"
        style={{ display: 'none' }} onChange={importJSON} />

      {/* Sidebar */}
      <div style={{
        position: isMobile ? 'fixed' : 'relative',
        left: isMobile ? (sidebarOpen ? 0 : -260) : 'auto',
        top: 0, bottom: 0, zIndex: 50, width: 240, flexShrink: 0,
        transition: isMobile ? 'left .2s ease' : 'none',
        display: (!isMobile && !sidebarOpen) ? 'none' : 'block'
      }}>
        <Sidebar
          open={true}
          entries={entries}
          activeSystem={activeSystem}
          setActiveSystem={sys => navigate(sys, 'list')}
          view={view}
          setView={switchView}
          onExport={exportJSON}
          onImportClick={() => importRef.current?.click()}
          onLogout={() => supabase.auth.signOut()}
          onManageSystems={() => setManage(true)}
          userSystems={userSystems}
          user={session.user}
          dueCount={dueCount}
        />
      </div>

      {/* Main panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', minWidth: 0 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
          background: '#fff', flexShrink: 0,
          boxShadow: '0 1px 2px rgba(0,0,0,.05)' }}>

          <button onClick={() => setSB(p => !p)}
            style={{ background: 'none', border: 'none', color: '#6b7280',
              cursor: 'pointer', fontSize: 18, padding: '2px 4px', flexShrink: 0 }}>☰</button>

          {view === 'stats'  && <span style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>Dashboard</span>}
          {view === 'search' && <span style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>Global Search</span>}
          {view === 'review' && <span style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>Review Queue</span>}
          {['list','add','detail'].includes(view) && (
            <>
              <div style={{ width: 7, height: 7, borderRadius: '50%',
                background: color, flexShrink: 0 }} />
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
              placeholder="Search notes…"
              style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7,
                color: '#111827', padding: '7px 12px', fontSize: 13, width: 180, outline: 'none' }} />
          )}

          {view === 'search' && (
            <input value={globalSearch} onChange={e => setGS(e.target.value)}
              placeholder="Search all systems…" autoFocus
              style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7,
                color: '#111827', padding: '7px 12px', fontSize: 13, outline: 'none',
                width: isMobile ? '100%' : 260, flex: isMobile ? 1 : 'none' }} />
          )}

          {view === 'list' && (
            <button onClick={() => setView('add')}
              style={{ background: color, color: '#fff', border: 'none', borderRadius: 7,
                padding: isMobile ? '8px 14px' : '8px 16px',
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

        {/* Mobile search bar */}
        {isMobile && view === 'list' && (
          <div style={{ padding: '8px 12px', background: '#fff',
            borderBottom: '1px solid #e5e7eb' }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${activeSystem}…`}
              style={{ width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 7, color: '#111827', padding: '8px 12px',
                fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '20px' }}>

          {/* Loading spinner */}
          {fetching && (
            <div style={{ textAlign: 'center', paddingTop: 80 }}>
              <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb',
                borderTop: '3px solid #2563eb', borderRadius: '50%',
                animation: 'spin .8s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ fontSize: 13, color: '#6b7280' }}>Loading your notebook…</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                This may take a few seconds on first open
              </div>
            </div>
          )}

          {/* Error with retry */}
          {!fetching && fetchErr && (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <div style={{ fontSize: 14, color: '#dc2626', marginBottom: 8 }}>
                Could not load entries
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>
                {fetchErr}
              </div>
              <button onClick={() => loadEntries(session, userSystems)}
                style={{ background: '#2563eb', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '10px 24px', fontSize: 14,
                  fontWeight: 600, cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          )}

          {!fetching && !fetchErr && (
            <>
              {/* GLOBAL SEARCH */}
              {view === 'search' && (
                <div style={{ maxWidth: 680, margin: '0 auto' }}>
                  {!globalSearch && (
                    <div style={{ color: '#9ca3af', textAlign: 'center',
                      paddingTop: 40, fontSize: 14 }}>Type to search all systems</div>
                  )}
                  {globalSearch && globalResults.length === 0 && (
                    <div style={{ color: '#9ca3af', textAlign: 'center',
                      paddingTop: 40, fontSize: 14 }}>No results found</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {globalResults.map(e => (
                      <EntryCard key={e.id} entry={e}
                        color={userSystems.find(s=>s.name===e.system)?.color||SYS_COLOR[e.system]||'#2563eb'}
                        showSystem
                        onClick={() => { setAS(e.system); setSelected(e); setView('detail'); if(isMobile)setSB(false); }} />
                    ))}
                  </div>
                </div>
              )}

              {/* REVIEW QUEUE */}
              {view === 'review' && (
                <ReviewQueue allEntries={entries} onReviewed={onReviewed} />
              )}

              {/* DASHBOARD */}
              {view === 'stats' && (
                <Dashboard entries={entries} userSystems={userSystems} />
              )}

              {/* ADD ENTRY */}
              {view === 'add' && (
                <AddEntry
                  activeSystem={activeSystem} color={color}
                  userId={session.user.id}
                  onSaved={onSaved} onCancel={() => setView('list')}
                  userSystems={userSystems}
                />
              )}

              {/* DETAIL VIEW */}
              {view === 'detail' && selected && (
                <DetailView
                  entry={selected}
                  onBack={() => setView('list')}
                  onDeleted={onDeleted}
                  onUpdated={onUpdated}
                  userId={session.user.id}
                />
              )}

              {/* ENTRY LIST */}
              {view === 'list' && (
                <div style={{ maxWidth: 680, margin: '0 auto' }}>
                  {sysEntries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                      <div style={{ fontSize: 14, color: '#6b7280' }}>
                        {search
                          ? 'No entries match your search'
                          : `No entries yet for ${activeSystem}`}
                      </div>
                      {!search && (
                        <button onClick={() => setView('add')} style={{
                          marginTop: 16, background: color, color: '#fff',
                          border: 'none', borderRadius: 8, padding: '10px 22px',
                          fontSize: 13, fontWeight: 600, cursor: 'pointer'
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
