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

  // Data
  const [entries, setEntries] = useState({}); // { system: [entry, ...] }
  const [fetching, setFetching] = useState(false);

  // UI
  const [activeSystem, setActiveSystem] = useState('Cardiology');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const importRef = useRef();

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load all entries on login ────────────────────────────────────────────────
  useEffect(() => {
    if (!session) { setEntries({}); return; }
    setFetching(true);
    supabase.from('entries')
      .select('*')
      .eq('user_id', session.user.id)
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

  // ── Toast ───────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Logout ──────────────────────────────────────────────────────────────────
  const logout = () => supabase.auth.signOut();

  // ── Entry saved callback ────────────────────────────────────────────────────
  const onSaved = useCallback((entry) => {
    setEntries(prev => ({
      ...prev,
      [entry.system]: [entry, ...(prev[entry.system] || [])]
    }));
    setView('list');
    showToast('Entry saved ✓');
  }, [showToast]);

  // ── Entry deleted callback ──────────────────────────────────────────────────
  const onDeleted = useCallback((id, system) => {
    setEntries(prev => ({
      ...prev,
      [system]: (prev[system] || []).filter(e => e.id !== id)
    }));
    setView('list');
    setSelected(null);
    showToast('Entry deleted', 'warn');
  }, [showToast]);

  // ── Entry updated callback ──────────────────────────────────────────────────
  const onUpdated = useCallback((updated) => {
    setEntries(prev => ({
      ...prev,
      [updated.system]: (prev[updated.system] || []).map(e => e.id === updated.id ? updated : e)
    }));
    setSelected(updated);
    showToast('Reviewed ✓');
  }, [showToast]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportJSON = () => {
    const all = Object.values(entries).flat();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medbook_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Exported ✓');
  };

  // ── Import ──────────────────────────────────────────────────────────────────
  const importJSON = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('Invalid format');
        // Upsert entries (strip old ids, reassign user_id)
        const toInsert = data.map(({ id, ...rest }) => ({
          ...rest, user_id: session.user.id
        }));
        const { error } = await supabase.from('entries').insert(toInsert);
        if (error) throw error;
        showToast(`Imported ${toInsert.length} entries ✓`);
        // Reload
        const { data: fresh } = await supabase.from('entries')
          .select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
        const grouped = {};
        SYSTEMS.forEach(s => { grouped[s] = []; });
        (fresh || []).forEach(e => { if (grouped[e.system]) grouped[e.system].push(e); });
        setEntries(grouped);
      } catch (err) {
        showToast('Import failed: ' + err.message, 'err');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  // ── Filtered entries ────────────────────────────────────────────────────────
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

  const color = SYS_COLOR[activeSystem] || '#3498db';

  // ── Loading / Auth guard ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0c0e14', display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: '#4a5070',
      fontFamily: "'Syne', sans-serif", fontSize: 14 }}>
      Loading…
    </div>
  );

  if (!session) return <Auth />;

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0c0e14',
      color: '#dde0ec', overflow: 'hidden' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 999,
          background: toast.type === 'err' ? '#c0392b' : toast.type === 'warn' ? '#e67e22' : '#27ae60',
          color: '#fff', borderRadius: 10, padding: '11px 20px',
          fontSize: 13, fontWeight: 700, boxShadow: '0 4px 20px rgba(0,0,0,.4)',
          pointerEvents: 'none', fontFamily: "'Syne', sans-serif"
        }}>{toast.msg}</div>
      )}

      {/* Import input */}
      <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importJSON} />

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        entries={entries}
        activeSystem={activeSystem}
        setActiveSystem={setActiveSystem}
        view={view}
        setView={setView}
        onExport={exportJSON}
        onImportClick={() => importRef.current?.click()}
        onLogout={logout}
        user={session.user}
      />

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 20px', borderBottom: '1px solid #1c1f2e',
          background: '#10121a', flexShrink: 0, fontFamily: "'Syne', sans-serif"
        }}>
          <button onClick={() => setSidebarOpen(p => !p)}
            style={{ background: 'none', border: 'none', color: '#4a5070', cursor: 'pointer', fontSize: 18 }}>☰</button>

          {view === 'stats' && <span style={{ fontWeight: 800, color: '#fff' }}>Dashboard</span>}
          {view === 'search' && <span style={{ fontWeight: 800, color: '#fff' }}>Global Search</span>}
          {['list','add','detail'].includes(view) && (
            <>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{activeSystem}</span>
              {view === 'list' && (
                <span style={{ fontSize: 11, color: '#3a4060' }}>{sysEntries.length} entries</span>
              )}
            </>
          )}

          <div style={{ flex: 1 }} />

          {view === 'list' && (
            <>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${activeSystem}…`}
                style={{
                  background: '#0c0e14', border: '1px solid #1c1f2e', borderRadius: 8,
                  color: '#c0c8e0', padding: '7px 14px', fontSize: 13, width: 200,
                  outline: 'none', fontFamily: "'Syne', sans-serif"
                }} />
              <button onClick={() => { setView('add'); setSearch(''); }}
                style={{
                  background: color, color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: "'Syne', sans-serif"
                }}>+ Add Entry</button>
            </>
          )}

          {view === 'search' && (
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search all systems…" autoFocus
              style={{
                background: '#0c0e14', border: '1px solid #1c1f2e', borderRadius: 8,
                color: '#c0c8e0', padding: '7px 14px', fontSize: 13, width: 280,
                outline: 'none', fontFamily: "'Syne', sans-serif"
              }} />
          )}

          {(view === 'add' || view === 'detail') && (
            <button onClick={() => setView('list')}
              style={{
                background: '#1c1f2e', color: '#8890b0', border: 'none',
                borderRadius: 8, padding: '8px 14px', fontSize: 13,
                cursor: 'pointer', fontFamily: "'Syne', sans-serif"
              }}>← Back</button>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>

          {/* LOADING */}
          {fetching && (
            <div style={{ textAlign: 'center', color: '#3a4060', paddingTop: 60,
              fontFamily: "'Syne', sans-serif" }}>Loading your notebook…</div>
          )}

          {/* GLOBAL SEARCH */}
          {!fetching && view === 'search' && (
            <div style={{ maxWidth: 700, margin: '0 auto' }}>
              {globalSearch && globalResults.length === 0 && (
                <div style={{ color: '#3a4060', textAlign: 'center', paddingTop: 40,
                  fontFamily: "'Syne', sans-serif" }}>No results found</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {globalResults.map(e => (
                  <EntryCard key={e.id} entry={e} color={SYS_COLOR[e.system]} showSystem
                    onClick={() => {
                      setActiveSystem(e.system);
                      setSelected(e);
                      setView('detail');
                    }} />
                ))}
              </div>
            </div>
          )}

          {/* DASHBOARD */}
          {!fetching && view === 'stats' && <Dashboard entries={entries} />}

          {/* ADD */}
          {!fetching && view === 'add' && (
            <AddEntry
              activeSystem={activeSystem}
              color={color}
              userId={session.user.id}
              onSaved={onSaved}
              onCancel={() => setView('list')}
            />
          )}

          {/* DETAIL */}
          {!fetching && view === 'detail' && selected && (
            <DetailView
              entry={selected}
              onBack={() => setView('list')}
              onDeleted={onDeleted}
              onUpdated={onUpdated}
            />
          )}

          {/* LIST */}
          {!fetching && view === 'list' && (
            <div style={{ maxWidth: 700, margin: '0 auto' }}>
              {sysEntries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px',
                  fontFamily: "'Syne', sans-serif" }}>
                  <div style={{ fontSize: 42, marginBottom: 14 }}>📋</div>
                  <div style={{ fontSize: 14, color: '#4a5070' }}>
                    {search ? 'No entries match your search' : `No entries yet for ${activeSystem}`}
                  </div>
                  {!search && (
                    <button onClick={() => setView('add')} style={{
                      marginTop: 18, background: color, color: '#fff', border: 'none',
                      borderRadius: 8, padding: '10px 22px', fontSize: 13,
                      fontWeight: 700, cursor: 'pointer', fontFamily: "'Syne', sans-serif"
                    }}>+ Add First Entry</button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
