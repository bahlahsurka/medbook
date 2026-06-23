import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { loadSystems, saveSystems, DEFAULT_SYSTEMS } from './lib/systems';
import { SYS_COLOR } from './lib/constants';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import EntryCard from './components/EntryCard';
import AddEntry from './components/AddEntry';
import DetailView from './components/DetailView';
import Dashboard from './components/Dashboard';
import ManageSystems from './components/ManageSystems';
import ReviewQueue from './components/ReviewQueue';
import FlashCards from './components/FlashCards';
import Onboarding from './components/Onboarding';
import QuickAdd from './components/QuickAdd';

const ONBOARD_KEY = 'medbook_onboarded';

export default function App() {
  const [session, setSession]       = useState(null);
  const [authLoading, setAL]        = useState(true);
  const [entries, setEntries]       = useState({});
  const [fetching, setFetching]     = useState(false);
  const [fetchErr, setFetchErr]     = useState('');
  const [activeSystem, setAS]       = useState('Internal Medicine');
  const [view, setView]             = useState('list');
  const [selected, setSelected]     = useState(null);
  const [sidebarOpen, setSB]        = useState(window.innerWidth > 768);
  const [isMobile, setMobile]       = useState(window.innerWidth <= 768);
  const [search, setSearch]         = useState('');
  const [globalSearch, setGS]       = useState('');
  const [toast, setToast]           = useState(null);
  const [userSystems, setUS]        = useState(DEFAULT_SYSTEMS);
  const [systemsLoaded, setSysLoaded] = useState(false);
  const [showManage, setManage]     = useState(false);
  const [showOnboard, setOnboard]   = useState(false);
  const [showQuickAdd, setQuickAdd] = useState(false);
  const [selected2, setSelected2]   = useState(new Set());
  const [bulkMode, setBulkMode]     = useState(false);

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

  // Load systems from Supabase when session available
  useEffect(() => {
    if (!session) return;
    loadSystems(session.user.id).then(sys => {
      setUS(sys);
      setSysLoaded(true);
      if (!localStorage.getItem(ONBOARD_KEY)) setOnboard(true);
    });
  }, [session]);

  // Load entries
  const loadEntries = useCallback(async (sess, systems) => {
    if (!sess) { setEntries({}); return; }
    setFetching(true); setFetchErr('');
    try {
      const { data, error } = await supabase
        .from('entries').select('*')
        .eq('user_id', sess.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const g = {};
      (systems || DEFAULT_SYSTEMS).forEach(s => { g[s.name] = []; });
      (data || []).forEach(e => {
        if (!g[e.system]) g[e.system] = [];
        g[e.system].push(e);
      });
      setEntries(g);
    } catch(e) { setFetchErr(e.message || 'Could not load entries'); }
    setFetching(false);
  }, []);

  useEffect(() => {
    if (session && systemsLoaded) loadEntries(session, userSystems);
  }, [session, systemsLoaded]);

  const showToast = useCallback((msg, type='ok') => {
    setToast({ msg, type });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const navigate = useCallback((sys, v='list') => {
    setAS(sys); setView(v); setSearch('');
    setBulkMode(false); setSelected2(new Set());
    if (window.innerWidth <= 768) setSB(false);
  }, []);

  const switchView = useCallback((v) => {
    setView(v);
    setBulkMode(false); setSelected2(new Set());
    if (window.innerWidth <= 768) setSB(false);
  }, []);

  // Entry handlers
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
    setEntries(prev => ({ ...prev, [system]: (prev[system]||[]).filter(e=>e.id!==id) }));
    setView('list'); setSelected(null);
    showToast('Entry deleted', 'warn');
  }, [showToast]);

  const onUpdated = useCallback((updated) => {
    setEntries(prev => ({
      ...prev,
      [updated.system]: (prev[updated.system]||[]).map(e=>e.id===updated.id?updated:e)
    }));
    setSelected(updated);
  }, []);

  const onReviewed = useCallback((updated) => {
    setEntries(prev => ({
      ...prev,
      [updated.system]: (prev[updated.system]||[]).map(e=>e.id===updated.id?updated:e)
    }));
  }, []);

  // Bulk handlers
  const toggleSelect = useCallback((id) => {
    setSelected2(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const bulkDelete = useCallback(async () => {
    if (!window.confirm(`Delete ${selected2.size} entr${selected2.size===1?'y':'ies'}?`)) return;
    const ids = [...selected2];
    await supabase.from('entries').delete().in('id', ids);
    setEntries(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(sys => { next[sys] = next[sys].filter(e=>!ids.includes(e.id)); });
      return next;
    });
    setBulkMode(false); setSelected2(new Set());
    showToast(`Deleted ${ids.length} entr${ids.length===1?'y':'ies'}`, 'warn');
  }, [selected2, showToast]);

  const bulkPin = useCallback(async (pin) => {
    const ids = [...selected2];
    await supabase.from('entries').update({ pinned: pin }).in('id', ids);
    setEntries(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(sys => {
        next[sys] = next[sys].map(e=>ids.includes(e.id)?{...e,pinned:pin}:e);
      });
      return next;
    });
    setBulkMode(false); setSelected2(new Set());
    showToast(`${pin?'Pinned':'Unpinned'} ${ids.length} entr${ids.length===1?'y':'ies'} ✓`);
  }, [selected2, showToast]);

  const bulkMove = useCallback(async (targetSystem) => {
    const ids = [...selected2];
    await supabase.from('entries').update({ system: targetSystem }).in('id', ids);
    setEntries(prev => {
      const next = { ...prev };
      const moved = [];
      Object.keys(next).forEach(sys => {
        const keep=[], mv=[];
        next[sys].forEach(e => ids.includes(e.id) ? mv.push({...e,system:targetSystem}) : keep.push(e));
        next[sys] = keep; moved.push(...mv);
      });
      if (!next[targetSystem]) next[targetSystem] = [];
      next[targetSystem] = [...moved, ...next[targetSystem]];
      return next;
    });
    setBulkMode(false); setSelected2(new Set());
    showToast(`Moved to ${targetSystem} ✓`);
  }, [selected2, showToast]);

  // Systems save — now writes to Supabase
  const handleSaveSystems = useCallback(async (list) => {
    try {
      await saveSystems(session.user.id, list);
      setUS(list);
      if (!list.find(s => s.name === activeSystem)) setAS(list[0]?.name || '');
      setManage(false);
      showToast('Systems saved & synced ✓');
    } catch(e) { showToast('Failed to save systems: ' + e.message, 'err'); }
  }, [session, activeSystem, showToast]);

  // Export / Import
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(Object.values(entries).flat(),null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medbook_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click(); showToast('Exported ✓');
  };

  const importJSON = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('Invalid format');
        const rows = data.map(({id,...rest})=>({...rest,user_id:session.user.id}));
        const { error } = await supabase.from('entries').insert(rows);
        if (error) throw error;
        showToast(`Imported ${rows.length} entries ✓`);
        loadEntries(session, userSystems);
      } catch(err) { showToast('Import failed: '+err.message,'err'); }
    };
    reader.readAsText(f); e.target.value='';
  };

  // Computed
  const sysEntries = useMemo(() => {
    const all = entries[activeSystem] || [];
    const filtered = search.trim()
      ? all.filter(e => {
          const q = search.toLowerCase();
          return e.title?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q);
        })
      : all;
    return [...filtered].sort((a,b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
  }, [entries, activeSystem, search]);

  const globalResults = useMemo(() => {
    if (!globalSearch.trim()) return [];
    const q = globalSearch.toLowerCase();
    return Object.values(entries).flat().filter(e =>
      e.title?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q)
    ).slice(0,50);
  }, [globalSearch, entries]);

  const dueCount = useMemo(() => {
    const now = new Date();
    return Object.values(entries).flat()
      .filter(e => e.next_review && new Date(e.next_review) <= now).length;
  }, [entries]);

  const color = userSystems.find(s=>s.name===activeSystem)?.color
    || SYS_COLOR[activeSystem] || '#2563eb';

  if (authLoading) return (
    <div style={{minHeight:'100vh',background:'#f9fafb',display:'flex',
      alignItems:'center',justifyContent:'center',fontFamily:'Inter,sans-serif'}}>
      <div style={{textAlign:'center'}}>
        <Spinner /> <div style={{fontSize:13,color:'#9ca3af',marginTop:12}}>Loading…</div>
      </div>
    </div>
  );

  if (!session) return <Auth />;

  return (
    <div style={{display:'flex',height:'100vh',background:'#f3f4f6',
      overflow:'hidden',fontFamily:'Inter,sans-serif'}}>

      {toast && (
        <div style={{position:'fixed',bottom:20,right:20,zIndex:999,
          background:toast.type==='err'?'#dc2626':toast.type==='warn'?'#d97706':'#16a34a',
          color:'#fff',borderRadius:8,padding:'11px 18px',fontSize:13,fontWeight:600,
          boxShadow:'0 4px 16px rgba(0,0,0,.2)',pointerEvents:'none',
          maxWidth:'calc(100vw - 40px)'}}>
          {toast.msg}
        </div>
      )}

      {showOnboard && <Onboarding onDone={()=>{localStorage.setItem(ONBOARD_KEY,'1');setOnboard(false);}} />}

      {showManage && (
        <ManageSystems systems={userSystems} onSave={handleSaveSystems}
          onClose={()=>setManage(false)} userId={session.user.id} />
      )}

      {showQuickAdd && (
        <QuickAdd userId={session.user.id} activeSystem={activeSystem}
          userSystems={userSystems} color={color}
          onSaved={onSaved} onClose={()=>setQuickAdd(false)} />
      )}

      {isMobile && sidebarOpen && (
        <div onClick={()=>setSB(false)} style={{position:'fixed',inset:0,
          background:'rgba(0,0,0,0.4)',zIndex:40}} />
      )}

      <input ref={importRef} type="file" accept=".json"
        style={{display:'none'}} onChange={importJSON} />

      {/* Sidebar */}
      <div style={{
        position:isMobile?'fixed':'relative',
        left:isMobile?(sidebarOpen?0:-260):'auto',
        top:0,bottom:0,zIndex:50,width:240,flexShrink:0,
        transition:isMobile?'left .2s ease':'none',
        display:(!isMobile&&!sidebarOpen)?'none':'block'
      }}>
        <Sidebar open={true} entries={entries} activeSystem={activeSystem}
          setActiveSystem={sys=>navigate(sys,'list')}
          view={view} setView={switchView}
          onExport={exportJSON} onImportClick={()=>importRef.current?.click()}
          onLogout={()=>supabase.auth.signOut()}
          onManageSystems={()=>setManage(true)}
          userSystems={userSystems} user={session.user} dueCount={dueCount} />
      </div>

      {/* Main */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',
          borderBottom:'1px solid #e5e7eb',background:'#fff',flexShrink:0,
          boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>
          <button onClick={()=>setSB(p=>!p)} style={{background:'none',border:'none',
            color:'#6b7280',cursor:'pointer',fontSize:18,padding:'2px 4px',flexShrink:0}}>☰</button>

          {view==='stats'  && <span style={{fontWeight:700,color:'#111827',fontSize:14}}>Dashboard</span>}
          {view==='search' && <span style={{fontWeight:700,color:'#111827',fontSize:14}}>Global Search</span>}
          {view==='review' && <span style={{fontWeight:700,color:'#111827',fontSize:14}}>Review Queue</span>}
          {view==='cards'  && <span style={{fontWeight:700,color:'#111827',fontSize:14}}>Flashcards</span>}
          {['list','add','detail'].includes(view) && (
            <>
              <div style={{width:7,height:7,borderRadius:'50%',background:color,flexShrink:0}} />
              <span style={{fontSize:14,fontWeight:700,color:'#111827',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{activeSystem}</span>
              {view==='list' && <span style={{fontSize:11,color:'#9ca3af',flexShrink:0}}>{sysEntries.length}</span>}
            </>
          )}

          <div style={{flex:1}} />

          {view==='list' && !isMobile && (
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search notes…"
              style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:7,
                color:'#111827',padding:'7px 12px',fontSize:13,width:180,outline:'none'}} />
          )}
          {view==='search' && (
            <input value={globalSearch} onChange={e=>setGS(e.target.value)}
              placeholder="Search all systems…" autoFocus
              style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:7,
                color:'#111827',padding:'7px 12px',fontSize:13,outline:'none',
                width:isMobile?'100%':260,flex:isMobile?1:'none'}} />
          )}
          {view==='list' && (
            <button onClick={()=>setView('add')} style={{background:color,color:'#fff',
              border:'none',borderRadius:7,padding:isMobile?'8px 14px':'8px 16px',
              fontSize:13,fontWeight:600,cursor:'pointer',flexShrink:0}}>
              {isMobile?'+':'+ Add Entry'}
            </button>
          )}
          {(view==='add'||view==='detail') && (
            <button onClick={()=>setView('list')} style={{background:'#f3f4f6',color:'#6b7280',
              border:'1px solid #e5e7eb',borderRadius:7,padding:'7px 14px',
              fontSize:13,cursor:'pointer'}}>← Back</button>
          )}
        </div>

        {/* Mobile search */}
        {isMobile && view==='list' && (
          <div style={{padding:'8px 12px',background:'#fff',borderBottom:'1px solid #e5e7eb'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder={`Search ${activeSystem}…`}
              style={{width:'100%',background:'#f9fafb',border:'1px solid #e5e7eb',
                borderRadius:7,color:'#111827',padding:'8px 12px',
                fontSize:13,outline:'none',boxSizing:'border-box'}} />
          </div>
        )}

        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:isMobile?'14px 12px':'20px'}}>

          {fetching && (
            <div style={{textAlign:'center',paddingTop:80}}>
              <Spinner />
              <div style={{fontSize:13,color:'#6b7280',marginTop:16}}>Loading your notebook…</div>
            </div>
          )}

          {!fetching && fetchErr && (
            <div style={{textAlign:'center',paddingTop:60}}>
              <div style={{fontSize:14,color:'#dc2626',marginBottom:8}}>Could not load entries</div>
              <div style={{fontSize:12,color:'#9ca3af',marginBottom:20}}>{fetchErr}</div>
              <button onClick={()=>loadEntries(session,userSystems)}
                style={{background:'#2563eb',color:'#fff',border:'none',borderRadius:8,
                  padding:'10px 24px',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                Retry
              </button>
            </div>
          )}

          {!fetching && !fetchErr && (
            <>
              {view==='search' && (
                <div style={{maxWidth:680,margin:'0 auto'}}>
                  {!globalSearch && <div style={{color:'#9ca3af',textAlign:'center',paddingTop:40,fontSize:14}}>Type to search all systems</div>}
                  {globalSearch && globalResults.length===0 && <div style={{color:'#9ca3af',textAlign:'center',paddingTop:40,fontSize:14}}>No results found</div>}
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {globalResults.map(e => (
                      <EntryCard key={e.id} entry={e}
                        color={userSystems.find(s=>s.name===e.system)?.color||SYS_COLOR[e.system]||'#2563eb'}
                        showSystem
                        onClick={()=>{ setAS(e.system); setSelected(e); setView('detail'); if(isMobile)setSB(false); }} />
                    ))}
                  </div>
                </div>
              )}

              {view==='review' && <ReviewQueue allEntries={entries} onReviewed={onReviewed} />}
              {view==='cards'  && <FlashCards userId={session.user.id} />}
              {view==='stats'  && <Dashboard entries={entries} userSystems={userSystems} />}

              {view==='add' && (
                <AddEntry activeSystem={activeSystem} color={color}
                  userId={session.user.id} onSaved={onSaved}
                  onCancel={()=>setView('list')} userSystems={userSystems} />
              )}

              {view==='detail' && selected && (
                <DetailView entry={selected} onBack={()=>setView('list')}
                  onDeleted={onDeleted} onUpdated={onUpdated} userId={session.user.id} />
              )}

              {view==='list' && (
                <div style={{maxWidth:680,margin:'0 auto',position:'relative'}}>

                  {/* Bulk toolbar */}
                  {sysEntries.length > 0 && (
                    <div style={{display:'flex',alignItems:'center',gap:8,
                      marginBottom:12,flexWrap:'wrap'}}>
                      <button
                        onClick={()=>{ setBulkMode(p=>!p); setSelected2(new Set()); }}
                        style={{fontSize:12,
                          background:bulkMode?'#eff6ff':'#f3f4f6',
                          border:`1px solid ${bulkMode?'#bfdbfe':'#e5e7eb'}`,
                          borderRadius:6,padding:'5px 12px',cursor:'pointer',
                          color:bulkMode?'#2563eb':'#6b7280',fontWeight:600,
                          fontFamily:'Inter,sans-serif'}}>
                        {bulkMode?`☑ ${selected2.size} selected`:'☑ Select'}
                      </button>

                      {bulkMode && selected2.size > 0 && (<>
                        <button onClick={()=>bulkPin(true)} style={bb('#d97706')}>📌 Pin</button>
                        <button onClick={()=>bulkPin(false)} style={bb('#6b7280')}>Unpin</button>
                        <select onChange={e=>{if(e.target.value){bulkMove(e.target.value);e.target.value='';}}}
                          defaultValue=""
                          style={{fontSize:12,border:'1px solid #e5e7eb',borderRadius:6,
                            padding:'5px 10px',cursor:'pointer',color:'#374151',
                            fontFamily:'Inter,sans-serif',background:'#fff'}}>
                          <option value="" disabled>Move to…</option>
                          {userSystems.filter(s=>s.name!==activeSystem).map(s=>(
                            <option key={s.name} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                        <button onClick={bulkDelete} style={bb('#dc2626')}>🗑 Delete</button>
                      </>)}
                      {bulkMode && selected2.size===0 && (
                        <span style={{fontSize:12,color:'#9ca3af'}}>
                          {isMobile ? 'Tap cards to select' : 'Click cards or right-click to select'}
                        </span>
                      )}
                    </div>
                  )}

                  {sysEntries.length===0 ? (
                    <div style={{textAlign:'center',padding:'60px 20px'}}>
                      <div style={{fontSize:40,marginBottom:12}}>📋</div>
                      <div style={{fontSize:14,color:'#6b7280'}}>
                        {search?'No entries match your search':`No entries yet for ${activeSystem}`}
                      </div>
                      {!search && (
                        <button onClick={()=>setView('add')} style={{marginTop:16,
                          background:color,color:'#fff',border:'none',borderRadius:8,
                          padding:'10px 22px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                          + Add First Entry
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {sysEntries.map(entry => (
                        <SelectableCard
                          key={entry.id}
                          entry={entry}
                          color={color}
                          bulkMode={bulkMode}
                          isSelected={selected2.has(entry.id)}
                          onTap={()=>{
                            if (bulkMode) toggleSelect(entry.id);
                            else { setSelected(entry); setView('detail'); }
                          }}
                          onLongPress={()=>{
                            setBulkMode(true);
                            toggleSelect(entry.id);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Mobile FAB */}
                  {isMobile && !bulkMode && (
                    <button onClick={()=>setQuickAdd(true)} style={{
                      position:'fixed',bottom:24,right:20,width:56,height:56,
                      borderRadius:'50%',background:color,color:'#fff',border:'none',
                      fontSize:26,cursor:'pointer',
                      boxShadow:'0 4px 16px rgba(0,0,0,.2)',zIndex:100,
                      display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
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

// Long-press selectable card
function SelectableCard({ entry, color, bulkMode, isSelected, onTap, onLongPress }) {
  const timer  = React.useRef(null);
  const moved  = React.useRef(false);
  const fired  = React.useRef(false);

  const startPress = (e) => {
    moved.current = false;
    fired.current = false;
    timer.current = setTimeout(() => {
      if (!moved.current) {
        fired.current = true;
        onLongPress();
      }
    }, 500);
  };

  const endPress = (e) => {
    clearTimeout(timer.current);
    if (!fired.current && !moved.current) {
      // short tap — but only fire onTap once (prevent double-fire on desktop)
    }
  };

  const cancelPress = () => {
    moved.current = true;
    clearTimeout(timer.current);
  };

  return (
    <div
      style={{
        position:'relative',
        outline: isSelected ? `2px solid ${color}` : 'none',
        borderRadius:8,
        transition:'outline .1s',
        WebkitUserSelect:'none',
        userSelect:'none',
      }}
      onClick={onTap}
      onContextMenu={e=>{ e.preventDefault(); onLongPress(); }}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchMove={cancelPress}
    >
      {bulkMode && (
        <div style={{
          position:'absolute',top:10,left:10,zIndex:10,
          width:22,height:22,borderRadius:5,
          background:isSelected?color:'#fff',
          border:`2px solid ${isSelected?color:'#d1d5db'}`,
          display:'flex',alignItems:'center',justifyContent:'center',
          boxShadow:'0 1px 3px rgba(0,0,0,.15)',pointerEvents:'none'
        }}>
          {isSelected && <span style={{color:'#fff',fontSize:13,fontWeight:700}}>✓</span>}
        </div>
      )}
      <EntryCard entry={entry} color={color} />
    </div>
  );
}

function Spinner() {
  return (
    <div style={{width:32,height:32,border:'3px solid #e5e7eb',
      borderTop:'3px solid #2563eb',borderRadius:'50%',
      animation:'spin .8s linear infinite',margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function bb(color) {
  return {
    fontSize:12,background:`${color}10`,border:`1px solid ${color}30`,
    color,borderRadius:6,padding:'5px 10px',cursor:'pointer',
    fontWeight:600,fontFamily:'Inter,sans-serif'
  };
}
