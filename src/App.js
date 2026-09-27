import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { loadSystems, saveSystems, DEFAULT_SYSTEMS } from './lib/systems';
import { SYS_COLOR } from './lib/constants';
import { useScrollRestore } from './lib/useScrollRestore';
import { useDebouncedValue } from './lib/useDebouncedValue';
import { useStudySession } from './lib/useStudySession';
import { useTheme, SPACE, RADIUS, FONT, MOTION, Z, elevation, BREAKPOINT } from './lib/theme';
import { IconMenu, IconX, IconChevronLeft, IconPlus, IconInbox, IconSearch } from './lib/icons';
import Auth from './components/Auth';
import LandingPage from './components/LandingPage';
import Sidebar from './components/Sidebar';
import EntryCard from './components/EntryCard';
import AddEntry from './components/AddEntry';
import DetailView from './components/DetailView';
import Dashboard from './components/Dashboard';
import Insights from './components/Insights';
import ManageSystems from './components/ManageSystems';
import ReviewQueue from './components/ReviewQueue';
import FlashCards from './components/FlashCards';
import Onboarding from './components/Onboarding';
import QuickAdd from './components/QuickAdd';
import SystemReview from './components/SystemReview';
import SystemHome from './components/SystemHome';
import FilterChips from './components/FilterChips';

const ONBOARD_KEY = 'medbook_onboarded';

// Convert a Supabase public image URL back to its storage object path.
function storagePathFromUrl(url) {
  try {
    const marker = '/entry-images/';
    const i = String(url).indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
  } catch { return null; }
}

export default function App() {
  const { t, isDark } = useTheme();
  const [session, setSession]         = useState(null);
  // Detect Supabase's password-recovery redirect (#...&type=recovery in the
  // URL). getSession()/onAuthStateChange below will make `session` truthy
  // for a recovery session same as any other sign-in — this flag is what
  // lets the render gate below tell the two apart and route to the
  // password-reset screen instead of straight into the app.
  const [isRecovery] = useState(() =>
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
  );
  // Public landing page (marketing) lives at "/" for a signed-out visitor;
  // everything else (including "/" once signed in) is the existing app/Auth
  // behaviour, completely unchanged — see the render gate near the bottom
  // of this file. No router library: this is the one fork the whole app
  // needs, and a real URL (not just app-internal state) is what makes "/"
  // actually shareable/bookmarkable/crawlable as the marketing page.
  const [pathname, setPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Landing page CTAs ("Get Started", nav "Sign In") go through this rather
  // than a plain full navigation — keeps the SPA's already-loaded JS/session
  // state intact instead of forcing a fresh page load just to reach Auth.
  // True for the brief moment between a landing-page CTA click and the
  // actual navigation — lets the landing page fade/lift out instead of
  // being yanked away the instant Auth mounts underneath it.
  const [leavingLanding, setLeavingLanding] = useState(false);
  const goToApp = useCallback(() => {
    const swap = () => {
      window.history.pushState(null, '', '/app');
      setPathname('/app');
      setLeavingLanding(false);
    };
    let reduced = false;
    try { reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch {}
    if (reduced) { swap(); return; }
    setLeavingLanding(true);
    setTimeout(swap, 220); // matches the exit transition duration below
  }, []);
  const [authLoading, setAL]          = useState(true);
  const [entries, setEntries]         = useState({});
  const [fetching, setFetching]       = useState(false);
  const [fetchErr, setFetchErr]       = useState('');
  const [activeSystem, setAS]         = useState('Internal Medicine');
  // Dashboard is the landing screen (batch 3) — was 'list' (the notebook).
  const [view, setView]               = useState('stats');
  const [selected, setSelected]       = useState(null);
  // Set right before switchView('review') when a click needs to land the
  // user in a specific system's due queue (Insights' "Needs attention" rows)
  // instead of the plain Review Queue overview. ReviewQueue only reads this
  // once, on mount (see its own initialFilterSystem effect) — no need to
  // clear it after use, since ReviewQueue unmounts whenever `view` moves
  // away from 'review' and the next navigation just overwrites it.
  const [reviewFilterSystem, setReviewFilterSystem] = useState('');
  // Pre-existing bug found while wiring up the animated collapse below:
  // this always defaulted to false with nothing ever setting it true on
  // mount, so on tablet/desktop the sidebar was invisible (display:none)
  // until the hamburger was clicked once. Default it open on anything
  // wider than the mobile breakpoint, where it's the normal in-flow layout
  // rather than an overlay drawer.
  const [sidebarOpen, setSB]          = useState(() => window.innerWidth > BREAKPOINT.mobile);
  const [isMobile, setMobile]         = useState(window.innerWidth <= BREAKPOINT.mobile);
  // Tablet: sidebar stays inline (not an overlay drawer) but narrower, so it
  // no longer gets treated identically to a wide desktop monitor.
  const [isTablet, setTablet]         = useState(window.innerWidth > BREAKPOINT.mobile && window.innerWidth <= BREAKPOINT.tablet);
  const [search, setSearch]           = useState('');
  const [globalSearch, setGS]         = useState('');
  // Batch 5: lightweight client-side filters layered on top of search —
  // shared between the per-system list and Global Search (one consistent
  // lens rather than two independent ones), same reset-on-system-switch
  // behavior `search` already has (see `navigate` below).
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [pinnedOnly, setPinnedOnly]   = useState(false);
  const [toast, setToast]             = useState(null);
  const [userSystems, setUS]          = useState(DEFAULT_SYSTEMS);
  const [systemsLoaded, setSysLoaded] = useState(false);
  const [showManage, setManage]       = useState(false);
  const [showOnboard, setOnboard]     = useState(false);
  const [showQuickAdd, setQuickAdd]   = useState(false);
  const [showSysReview, setSysReview] = useState(false);
  const [selected2, setSelected2]     = useState(new Set());
  const [bulkMode, setBulkMode]       = useState(false);

  const toastRef  = useRef();
  const importRef = useRef();

  // Scroll restoration
  const { scrollRef, saveScroll, restoreScroll } = useScrollRestore();

  // Study Time (Insights) — tracks TOTAL app usage time, not just time on
  // specific "study" screens. Previously this was wired up per-screen
  // (DetailView while viewing an entry, ReviewQueue during an active
  // review, FlashCards while flipping through cards), which undercounted:
  // adding entries, browsing the dashboard/lists, searching, and managing
  // systems all counted as zero. Hoisting the single source of truth here
  // means "active" is just "signed in and the tab is in front of you" —
  // the hook's own visibilitychange/pagehide/heartbeat handling already
  // takes care of pausing while backgrounded and persisting periodically.
  useStudySession(!!session && !isRecovery, session?.user?.id, 'app');

  // Resize
  useEffect(() => {
    // NOTE: this used to also force the sidebar back open on any resize past
    // 768px (`if (window.innerWidth > 768) setSB(true)`). On a tablet, the
    // on-screen keyboard opening/closing, orientation nuances, and browser
    // chrome show/hide can all fire a resize event — so that line was
    // reopening the sidebar after essentially any input, overriding an
    // explicit close. The sidebar is now ONLY opened by the hamburger button.
    const fn = () => {
      setMobile(window.innerWidth <= BREAKPOINT.mobile);
      setTablet(window.innerWidth > BREAKPOINT.mobile && window.innerWidth <= BREAKPOINT.tablet);
    };
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Auth
  useEffect(() => {
    (async () => {
      // OAuth return handling. Modern Supabase uses the PKCE flow, where
      // Google sends the user back with "?code=..." that must be EXCHANGED
      // for a session — an async step. Calling getSession() immediately can
      // win that race and return null, leaving the user apparently signed
      // out despite having just authenticated successfully. So we complete
      // the exchange explicitly first.
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const hasImplicitToken = window.location.hash.includes('access_token');

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) console.error('[auth] code exchange failed:', error.message);
          // Clean the code out of the URL so a refresh can't retry a
          // single-use code (which would error).
          window.history.replaceState(null, '', window.location.pathname);
        } else if (hasImplicitToken) {
          // Older implicit flow: the client picks this up itself, but give
          // it a moment to finish before we read the session.
          await new Promise(r => setTimeout(r, 100));
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch (e) {
        console.error('[auth] OAuth return handling error:', e);
      }

      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setAL(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // A signed-in visitor should never be sitting on "/" — the render check
  // below already guarantees an active session skips the public landing
  // page regardless of pathname, but the PWA's start_url is "/" (see
  // public/manifest.json), so every relaunch of an installed/bookmarked
  // MedBook briefly arrives there. Swap the URL itself over to "/app" once
  // we know who's signed in, so the address bar (and browser back-button
  // history) match what's actually on screen instead of quietly diverging
  // from it — a repeated visitor is never one accidental Back tap away
  // from landing back on the marketing page.
  useEffect(() => {
    if (!authLoading && session && pathname === '/') {
      window.history.replaceState(null, '', '/app');
      setPathname('/app');
    }
  }, [authLoading, session, pathname]);

  // Stable identity for "who's signed in", used instead of the raw `session`
  // object below. Supabase's client automatically re-validates the session
  // and re-emits a SIGNED_IN auth event every time the tab/PWA regains
  // visibility — even after being backgrounded for just a second or two
  // (GoTrueClient's _onVisibilityChanged -> _recoverAndRefresh; this is
  // intentional upstream behavior, not a bug in it). Each re-emission hands
  // App.js a brand-new `session` object with identical data, so an effect
  // keyed on `[session]` used to re-fire on every app-switch/minimize/
  // notification-glance — re-fetching every system and every entry from
  // scratch and swapping the whole in-memory dataset out from under
  // whatever the user was looking at. The signed-in user practically never
  // changes on a mere re-emission, so keying these effects on their stable
  // id instead of the object reference fixes the unwanted refetch at the
  // root, without touching Supabase's own revalidation behavior at all.
  const userId = session?.user?.id;

  // Load systems from Supabase
  useEffect(() => {
    if (!userId) return;
    loadSystems(userId).then(sys => {
      setUS(sys); setSysLoaded(true);
      if (!localStorage.getItem(ONBOARD_KEY)) setOnboard(true);
    });
  }, [userId]);

  // Load entries
  const loadEntries = useCallback(async (uid, systems) => {
    if (!uid) { setEntries({}); return; }
    setFetching(true); setFetchErr('');
    try {
      const { data, error } = await supabase
        .from('entries').select('*')
        .eq('user_id', uid)
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
    if (userId && systemsLoaded) loadEntries(userId, userSystems);
  }, [userId, systemsLoaded]);

  const showToast = useCallback((msg, type = 'ok') => {
    // `id` gives each toast a distinct key so the enter animation replays
    // even if one fires again before the previous one's timeout clears —
    // without it, React would just update the same DOM node in place and
    // the mount-triggered animation wouldn't re-fire.
    setToast({ msg, type, id: Date.now() });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Navigation — save scroll before leaving list, restore when returning
  const openEntry = useCallback((entry) => {
    saveScroll(activeSystem);
    setSelected(entry);
    setView('detail');
    setSB(false); // sidebar only ever opens via the hamburger button
  }, [activeSystem, saveScroll]);

  const backToList = useCallback(() => {
    setView('list');
    setSelected(null);
    // restoreScroll already waits for layout via requestAnimationFrame — no timer needed.
    restoreScroll(activeSystem);
  }, [activeSystem, restoreScroll]);

  const navigate = useCallback((sys, v = 'list') => {
    setAS(sys); setView(v); setSearch('');
    setDifficultyFilter('All'); setPinnedOnly(false);
    setBulkMode(false); setSelected2(new Set());
    setSB(false); // sidebar only ever opens via the hamburger button
  }, []);

  const switchView = useCallback((v) => {
    setView(v);
    setBulkMode(false); setSelected2(new Set());
    setSB(false); // sidebar only ever opens via the hamburger button
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
    backToList();
    showToast('Entry deleted', 'warn');
  }, [showToast, backToList]);

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

  // Stable callback so memoised cards don't re-render: enter bulk mode + select.
  const startBulk = useCallback((id) => {
    setBulkMode(true);
    setSelected2(prev => new Set(prev).add(id));
  }, []);

  const bulkDelete = useCallback(async () => {
    if (!window.confirm(`Delete ${selected2.size} entr${selected2.size===1?'y':'ies'}?`)) return;
    const ids = [...selected2];
    // Collect image paths before the rows disappear, so Storage can be cleaned up.
    const imgs = Object.values(entries).flat()
      .filter(e => ids.includes(e.id))
      .flatMap(e => e.images || []);
    const { error } = await supabase.from('entries').delete().in('id', ids);
    if (error) { showToast('Delete failed: '+error.message, 'err'); return; }
    const paths = imgs.map(storagePathFromUrl).filter(Boolean);
    if (paths.length) await supabase.storage.from('entry-images').remove(paths);
    setEntries(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(sys => { next[sys] = next[sys].filter(e=>!ids.includes(e.id)); });
      return next;
    });
    setBulkMode(false); setSelected2(new Set());
    showToast(`Deleted ${ids.length} entr${ids.length===1?'y':'ies'}`, 'warn');
  }, [selected2, entries, showToast]);

  const bulkPin = useCallback(async (pin) => {
    const ids = [...selected2];
    const { error } = await supabase.from('entries').update({ pinned: pin }).in('id', ids);
    if (error) { showToast('Failed: '+error.message, 'err'); return; }
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
    const { error } = await supabase.from('entries').update({ system: targetSystem }).in('id', ids);
    if (error) { showToast('Move failed: '+error.message, 'err'); return; }
    setEntries(prev => {
      const next = { ...prev };
      const moved = [];
      Object.keys(next).forEach(sys => {
        const keep=[], mv=[];
        next[sys].forEach(e => ids.includes(e.id) ? mv.push({...e,system:targetSystem}) : keep.push(e));
        next[sys]=keep; moved.push(...mv);
      });
      if (!next[targetSystem]) next[targetSystem]=[];
      next[targetSystem]=[...moved,...next[targetSystem]];
      return next;
    });
    setBulkMode(false); setSelected2(new Set());
    showToast(`Moved to ${targetSystem} ✓`);
  }, [selected2, showToast]);

  // Systems
  const handleSaveSystems = useCallback(async (list) => {
    try {
      await saveSystems(session.user.id, list);
      setUS(list);
      if (!list.find(s=>s.name===activeSystem)) setAS(list[0]?.name||'');
      setManage(false);
      showToast('Systems saved ✓');
    } catch(e) { showToast('Failed: '+e.message, 'err'); }
  }, [session, activeSystem, showToast]);

  // Export / Import
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(Object.values(entries).flat(),null,2)],{type:'application/json'});
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `medbook_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported ✓');
  };

  const importJSON = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('Invalid format');
        const rows = data.map(({id,...rest})=>({...rest,user_id:session.user.id}));
        const {error} = await supabase.from('entries').insert(rows);
        if (error) throw error;
        showToast(`Imported ${rows.length} entries ✓`);
        loadEntries(userId, userSystems);
      } catch(err) { showToast('Import failed: '+err.message,'err'); }
    };
    reader.readAsText(f); e.target.value='';
  };

  // Computed
  // Debounce so filtering 250+ entries runs at most once per typing pause,
  // while the input stays instantly responsive.
  const debSearch = useDebouncedValue(search, 150);
  const debGlobal = useDebouncedValue(globalSearch, 150);

  const sysEntries = useMemo(() => {
    const all = entries[activeSystem] || [];
    let filtered = debSearch.trim()
      ? all.filter(e => {
          const q = debSearch.toLowerCase();
          return e.title?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q);
        })
      : all;
    // Difficulty/pinned filters (batch 5) — pure client-side narrowing on
    // top of the existing search match, same fields EntryCard already
    // displays. Applied before the existing sort so pinned-first ordering
    // and prev/next arrow navigation both keep working unchanged.
    if (difficultyFilter !== 'All') filtered = filtered.filter(e => e.difficulty === difficultyFilter);
    if (pinnedOnly) filtered = filtered.filter(e => e.pinned);
    return [...filtered].sort((a,b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
  }, [entries, activeSystem, debSearch, difficultyFilter, pinnedOnly]);

  // Left/right arrow navigation inside DetailView — walks the SAME ordered
  // list currently shown behind it (same filter, same pinned-first sort),
  // so arrows always match what you'd see if you went back and tapped the
  // next card yourself.
  const detailIndex = useMemo(() => {
    if (!selected) return -1;
    return sysEntries.findIndex(e => e.id === selected.id);
  }, [sysEntries, selected]);

  const navigateEntry = useCallback((dir) => {
    if (detailIndex === -1) return;
    const next = sysEntries[detailIndex + dir];
    if (!next) return;
    setSelected(next); // already in 'detail' view — no scroll/view change needed
  }, [detailIndex, sysEntries]);

  const globalResults = useMemo(() => {
    if (!debGlobal.trim()) return [];
    const q = debGlobal.toLowerCase();
    let filtered = Object.values(entries).flat().filter(e =>
      e.title?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q)
    );
    if (difficultyFilter !== 'All') filtered = filtered.filter(e => e.difficulty === difficultyFilter);
    if (pinnedOnly) filtered = filtered.filter(e => e.pinned);
    return filtered.slice(0,50);
  }, [debGlobal, entries, difficultyFilter, pinnedOnly]);

  const color = userSystems.find(s=>s.name===activeSystem)?.color
    || SYS_COLOR[activeSystem] || '#2563eb';

  // Distinguishes "this system truly has nothing yet" (show the Add First
  // Entry CTA) from "search/filters narrowed it to nothing" (don't — the
  // fix there is to loosen the filter, not add a duplicate entry).
  const hasActiveFilter = !!search || difficultyFilter !== 'All' || pinnedOnly;

  // Small header progress readout for the active system's entry list
  // (batch 4) — same "due"/"reviewed" definitions ReviewQueue and Dashboard
  // already use, just sliced to the one system currently open.
  const activeSystemProgress = useMemo(() => {
    const list = entries[activeSystem] || [];
    const now = new Date();
    return {
      due: list.filter(e => e.next_review && new Date(e.next_review) <= now).length,
      reviewed: list.filter(e => e.review_count > 0).length,
    };
  }, [entries, activeSystem]);

  // Recovery takes priority over everything else, including an active
  // session — a recovery-flow sign-in still makes `session` truthy below,
  // which is exactly what was routing people straight into the app instead
  // of the "set new password" screen. This check has to run before the
  // authLoading/session checks, not after, or it's too late to matter.
  if (isRecovery) return <Auth />;

  if (authLoading) return (
    <div style={{minHeight:'100vh',background:t.appBg,display:'flex',
      alignItems:'center',justifyContent:'center'}}>
      <Spinner track={t.spinnerTrack} accent={t.accent} />
    </div>
  );

  if (!session) {
    // Fades/lifts out on the way to Auth (see goToApp) instead of the
    // instant cut a plain conditional swap would give — Auth's own shell
    // then fades/lifts in on mount (see its own <style> block), so a Get
    // Started/Log in click reads as one continuous motion rather than two
    // unrelated screens snapping past each other. Reduced-motion visitors
    // skip the delay entirely (see goToApp) and never see this opacity dip.
    if (pathname === '/') return (
      <div style={{ opacity: leavingLanding ? 0 : 1,
        transform: leavingLanding ? 'translateY(-10px)' : 'translateY(0)',
        transition: `opacity 220ms ${MOTION.ease}, transform 220ms ${MOTION.ease}` }}>
        <LandingPage onGetStarted={goToApp} />
      </div>
    );
    return <Auth />;
  }

  return (
    <div onClick={e => {
        // "Click anywhere on screen except the entries" to exit bulk mode
        // — one delegated handler for the whole app (sidebar included, not
        // just the main pane) rather than several e.target===e.currentTarget
        // checks scattered across nested wrapper divs, which required a
        // click to land on exact background pixels of one specific element
        // and kept missing in practice. This instead asks a simpler
        // question of whatever was actually clicked: is it a card, or a
        // form control that needs the click for its own purpose (the
        // Move-to <select>, Pin/Delete/Select toggle buttons, search
        // inputs, sidebar buttons)? Anything else exits bulk mode.
        if (bulkMode && !e.target.closest('[data-bulk-card], button, select, input, a, textarea')) {
          setBulkMode(false); setSelected2(new Set());
        }
      }}
      style={{display:'flex',height:'100vh',background:t.bg,overflow:'hidden'}}>

      {/* Toast */}
      {toast && (
        <div key={toast.id} onClick={()=>setToast(null)} style={{position:'fixed',bottom:SPACE.xl,right:SPACE.xl,zIndex:Z.toast,
          background:toast.type==='err'?t.danger:toast.type==='warn'?t.warn:t.ok,
          color:'#fff',borderRadius:RADIUS.md,padding:'11px 18px',fontSize:FONT.size.base,fontWeight:FONT.weight.semibold,
          boxShadow:elevation(t,'lg'),cursor:'pointer',
          animation:`medbook-fade-in ${MOTION.normal} ${MOTION.ease}`,
          maxWidth:'calc(100vw - 40px)'}}>
          {toast.msg}
        </div>
      )}

      {showOnboard && <Onboarding onDone={()=>{localStorage.setItem(ONBOARD_KEY,'1');setOnboard(false);}} />}
      {showManage  && <ManageSystems systems={userSystems} onSave={handleSaveSystems} onClose={()=>setManage(false)} userId={session.user.id} />}
      {showQuickAdd && <QuickAdd userId={session.user.id} activeSystem={activeSystem} userSystems={userSystems} color={color} onSaved={onSaved} onClose={()=>setQuickAdd(false)} />}
      {showSysReview && <SystemReview system={activeSystem} entries={entries[activeSystem]||[]} color={color} onReviewed={onReviewed} onClose={()=>setSysReview(false)} />}

      {isMobile && sidebarOpen && (
        <div onClick={()=>setSB(false)} style={{position:'fixed',inset:0,background:t.overlay,zIndex:Z.mobileScrim,
          animation:`medbook-scrim-in ${MOTION.normal} ${MOTION.ease}`}} />
      )}

      <input ref={importRef} type="file" accept=".json" style={{display:'none'}} onChange={importJSON} />

      {/* Sidebar — mobile is an off-canvas drawer that slides via `left`
          (Sidebar itself always full-width, only its position moves); on
          tablet/desktop the wrapper stays in normal flow and Sidebar's own
          `open` prop drives a smooth width collapse instead of the old
          instant display:none swap, so opening/closing animates everywhere. */}
      <div style={{
        position:isMobile?'fixed':'relative',
        left:isMobile?(sidebarOpen?0:-260):'auto',
        top:0,bottom:0,zIndex:Z.sidebar,flexShrink:0,
        width:isMobile?240:'auto',
        // 260ms rather than the usual 180ms MOTION.normal — a 240px panel
        // sweep reads as noticeably quicker/more abrupt than the same
        // duration on a small icon/button, matching the width-collapse
        // timing used for tablet/desktop in Sidebar.js.
        transition:isMobile?`left 260ms ${MOTION.ease}`:'none',
      }}>
        <Sidebar open={isMobile?true:sidebarOpen} width={isTablet?220:240}
          entries={entries} activeSystem={activeSystem}
          setActiveSystem={sys=>navigate(sys,'list')}
          view={view} setView={switchView}
          onExport={exportJSON} onImportClick={()=>importRef.current?.click()}
          onLogout={()=>supabase.auth.signOut()}
          onManageSystems={()=>setManage(true)}
          userSystems={userSystems} user={session.user} />
      </div>

      {/* Main */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>

        {/* Header */}
        <div className="mb-app-header" style={{display:'flex',alignItems:'center',gap:SPACE.sm+2,padding:`${SPACE.md}px ${SPACE.lg}px`,
          borderBottom:`1px solid ${t.border}`,background:t.surface,flexShrink:0,
          boxShadow:elevation(t,'sm')}}>
          <style>{`
            .mb-headerbtn { transition: background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
            .mb-headerbtn:hover { background: ${t.surface2}; }
            .mb-headerbtn:active { transform: scale(0.92); }
            .mb-actionbtn-ghost:active { transform: scale(0.96); }
            .mb-headerbtn2 { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
            .mb-headerbtn2:hover { filter: brightness(0.97); }
            .mb-headerbtn2:active { transform: scale(0.96); }
            .mb-bulkbtn { transition: background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
            .mb-bulkbtn:active { transform: scale(0.96); }
            .mb-hero-cta:active { transform: scale(0.97); }
            /* A study session portals its own toolbar into #mb-study-toolbar-slot
               (see that div's own comment below) and on a narrow phone needs
               every pixel of this row to fit Previous/Pause/Flag/Favorite/the
               "N / N" counter/Fullscreen/Exit without the counter wrapping
               (StudySession.js's own .mb-ss-counter fix handles that once
               there's room to work with). The "Flashcards" label here is
               genuinely redundant the moment that's happening — the study
               toolbar itself already makes it obvious what screen this is —
               so it steps aside on narrow viewports specifically while a
               session has actually populated the slot (:has, not a bare
               width check: DeckBrowser/Browse/Stats/Favorites never portal
               anything into it, so the label stays for those, unchanged). */
            @media (max-width: 480px) {
              .mb-app-header:has(#mb-study-toolbar-slot > *) .mb-flashcards-label { display: none; }
            }
          `}</style>
          <button className="mb-headerbtn" onClick={()=>setSB(p=>!p)} title={sidebarOpen?'Close sidebar':'Open sidebar'}
            style={{background:'none',border:'none',
            color:t.text3,cursor:'pointer',padding:6,flexShrink:0,position:'relative',width:28,height:28,
            borderRadius:RADIUS.sm}}>
            {/* On mobile the button sits under the open drawer itself (it's
                covered, same as the scrim being the only way to close it —
                pre-existing), but on tablet/desktop the toggle now genuinely
                collapses the sidebar too, so the icon reflects state there. */}
            <IconMenu size={17} style={{position:'absolute',top:6,left:6,
              transition:`opacity ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}`,
              opacity:sidebarOpen?0:1, transform:sidebarOpen?'rotate(90deg)':'rotate(0deg)'}} />
            <IconX size={17} style={{position:'absolute',top:6,left:6,
              transition:`opacity ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}`,
              opacity:sidebarOpen?1:0, transform:sidebarOpen?'rotate(0deg)':'rotate(-90deg)'}} />
          </button>

          {view==='stats'  && <span style={{fontWeight:FONT.weight.bold,color:t.text,fontSize:FONT.size.md}}>Dashboard</span>}
          {view==='search' && <span style={{fontWeight:FONT.weight.bold,color:t.text,fontSize:FONT.size.md}}>Global Search</span>}
          {view==='review' && <span style={{fontWeight:FONT.weight.bold,color:t.text,fontSize:FONT.size.md}}>Review Queue</span>}
          {view==='cards'  && <span className="mb-flashcards-label" style={{fontWeight:FONT.weight.bold,color:t.text,fontSize:FONT.size.md}}>Flashcards</span>}
          {view==='insights' && <span style={{fontWeight:FONT.weight.bold,color:t.text,fontSize:FONT.size.md}}>Insights</span>}
          {['list','add','detail'].includes(view) && (
            <>
              <div style={{width:7,height:7,borderRadius:RADIUS.circle,background:color,flexShrink:0}} />
              <span style={{fontSize:FONT.size.md,fontWeight:FONT.weight.bold,color:t.text,
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{activeSystem}</span>
            </>
          )}

          {/* Plain spacer for every view except 'cards' — there, it doubles
              as a portal target StudySession renders its own toolbar into
              (see its own comment), so a study session gets the entire rest
              of this ALREADY-PERSISTENT header row instead of needing a
              second row of its own in the content area below. Renders as
              an ordinary empty spacer for every other 'cards'-area screen
              (DeckBrowser, BrowseDeck, etc.) that never portals into it —
              zero behavior change for them. */}
          <div id="mb-study-toolbar-slot" style={{flex:1, display:'flex', alignItems:'center', minWidth:0}} />

          {view==='search' && (
            <input value={globalSearch} onChange={e=>setGS(e.target.value)}
              placeholder="Search all systems…" autoFocus
              style={{background:t.surface2,border:`1px solid ${t.border}`,borderRadius:RADIUS.sm+1,
                color:t.text,padding:'7px 12px',fontSize:FONT.size.base,outline:'none',
                width:isMobile?'100%':260,flex:isMobile?1:'none'}} />
          )}

          {(view==='add'||view==='detail') && (
            <button className="mb-actionbtn-ghost" onClick={()=>{ if(view==='detail') backToList(); else setView('list'); }}
              style={{background:t.surface3,color:t.text3,border:`1px solid ${t.border}`,
                borderRadius:RADIUS.sm+1,padding:'7px 14px',fontSize:FONT.size.base,cursor:'pointer',
                display:'flex',alignItems:'center',gap:5,
                transition:`background ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}`}}>
              <IconChevronLeft size={14} /> Back
            </button>
          )}
        </div>

        {/* Content — scrollRef attached here for scroll restoration.
            The System page (view==='list') manages its own padding —
            SystemHome's hero is deliberately full-bleed edge-to-edge, so
            this pane can't also be padding it in from the sides. */}
        <div ref={scrollRef}
          style={{flex:1,overflowY:'auto',padding: view==='list' ? 0 : (isMobile?'14px 12px':'20px')}}>

          {fetching && (
            ['list','search'].includes(view) ? (
              <EntryListSkeleton t={t} />
            ) : (
              <div style={{textAlign:'center',paddingTop:80}}>
                <Spinner track={t.spinnerTrack} accent={t.accent} />
                <div style={{fontSize:13,color:t.text3,marginTop:16}}>Loading your notebook…</div>
              </div>
            )
          )}

          {!fetching && fetchErr && (
            <div style={{textAlign:'center',paddingTop:60}}>
              <div style={{fontSize:14,color:'#dc2626',marginBottom:8}}>Could not load entries</div>
              <div style={{fontSize:12,color:t.text4,marginBottom:20}}>{fetchErr}</div>
              <button onClick={()=>loadEntries(userId,userSystems)}
                style={{background:t.accent,color:'#fff',border:'none',borderRadius:8,
                  padding:'10px 24px',fontSize:14,fontWeight:600,cursor:'pointer'}}>Retry</button>
            </div>
          )}

          {!fetching && !fetchErr && (
            // Keyed on `view` only (not the selected entry) so switching
            // between nav destinations gets a soft transition, while
            // browsing entries inside DetailView via prev/next — same view,
            // different `selected` — does not retrigger it. Purely a
            // presentational wrapper around each destination's own render
            // output; nothing inside any of them changes.
            <div key={view} style={{animation:`medbook-fade-in ${MOTION.normal} ${MOTION.ease}`}}>
              {view==='search' && (
                <div style={{maxWidth:680,margin:'0 auto'}}>
                  {!globalSearch && (
                    <EmptyHint t={t} Icon={IconSearch} text="Type to search all systems" />
                  )}
                  {globalSearch && (
                    <div style={{marginBottom:10}}>
                      <FilterChips t={t} difficultyFilter={difficultyFilter} setDifficultyFilter={setDifficultyFilter}
                        pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} />
                    </div>
                  )}
                  {globalSearch && globalResults.length===0 && (
                    <EmptyHint t={t} Icon={IconInbox} text="No results match your search and filters" />
                  )}
                  <div key={`${debGlobal}-${difficultyFilter}-${pinnedOnly}`}
                    style={{display:'flex',flexDirection:'column',gap:8,
                      animation:globalResults.length>0?`medbook-fade-in ${MOTION.fast} ${MOTION.ease}`:'none'}}>
                    {globalResults.map(e=>(
                      <EntryCard key={e.id} entry={e}
                        color={userSystems.find(s=>s.name===e.system)?.color||SYS_COLOR[e.system]||'#2563eb'}
                        showSystem onClick={()=>{ setAS(e.system); openEntry(e); setSB(false); }} />
                    ))}
                  </div>
                </div>
              )}

              {view==='review' && <ReviewQueue allEntries={entries} onReviewed={onReviewed} userSystems={userSystems}
                initialFilterSystem={reviewFilterSystem} userId={session.user.id} />}
              {view==='cards'  && <FlashCards userId={session.user.id} userSystems={userSystems} />}
              {view==='stats'  && (
                <Dashboard entries={entries} userSystems={userSystems}
                  onOpenEntry={e=>{ setAS(e.system); openEntry(e); }}
                  onNavigateSystem={sys=>navigate(sys,'list')}
                  onStartReview={()=>switchView('review')}
                  onAddEntry={()=>switchView('add')}
                  onStudyFlashcards={()=>switchView('cards')}
                  onGlobalSearch={()=>switchView('search')} />
              )}
              {view==='insights' && (
                <Insights entries={entries} userSystems={userSystems} userId={session.user.id}
                  onNavigateSystem={sys=>navigate(sys,'list')}
                  onReviewSystem={sys=>{ setReviewFilterSystem(sys); switchView('review'); }} />
              )}

              {view==='add' && (
                <AddEntry activeSystem={activeSystem} color={color}
                  userId={session.user.id} onSaved={onSaved}
                  onCancel={()=>setView('list')} userSystems={userSystems} />
              )}

              {view==='detail' && selected && (
                <DetailView key={selected.id} entry={selected} onBack={backToList}
                  onDeleted={onDeleted} onUpdated={onUpdated} userId={session.user.id}
                  color={userSystems.find(s=>s.name===selected.system)?.color
                    || SYS_COLOR[selected.system] || '#2563eb'}
                  onPrev={()=>navigateEntry(-1)} onNext={()=>navigateEntry(1)}
                  hasPrev={detailIndex > 0}
                  hasNext={detailIndex !== -1 && detailIndex < sysEntries.length - 1} />
              )}

              {view==='list' && (
                <div style={{position:'relative'}}>
                  <SystemHome
                    t={t} isDark={isDark} system={activeSystem} color={color}
                    allEntries={entries[activeSystem]||[]} sysEntries={sysEntries}
                    progress={activeSystemProgress}
                    search={search} setSearch={setSearch}
                    difficultyFilter={difficultyFilter} setDifficultyFilter={setDifficultyFilter}
                    pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly}
                    bulkMode={bulkMode} setBulkMode={setBulkMode}
                    selected2={selected2} toggleSelect={toggleSelect}
                    onOpen={openEntry} onStartBulk={startBulk}
                    onAdd={()=>{ setView('add'); setSB(false); }}
                    onReview={()=>setSysReview(true)}
                    userSystems={userSystems} bulkPin={bulkPin} bulkMove={bulkMove} bulkDelete={bulkDelete}
                    isMobile={isMobile}
                  />

                  {/* Mobile FAB */}
                  {isMobile && !bulkMode && (
                    <button className="mb-hero-cta" onClick={()=>setQuickAdd(true)} style={{
                      position:'fixed',bottom:24,right:20,width:56,height:56,
                      borderRadius:RADIUS.circle,background:color,color:'#fff',border:'none',
                      cursor:'pointer',boxShadow:elevation(t,'lg'),zIndex:100,
                      display:'flex',alignItems:'center',justifyContent:'center',
                      transition:`transform ${MOTION.fast} ${MOTION.ease}`}}>
                      <IconPlus size={22} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Entry-list-shaped loading placeholder (batch 5) — shown instead of the
// generic spinner specifically while the destination is the list or search
// view, so the loading state already hints at what's about to appear.
function EntryListSkeleton({ t }) {
  return (
    <div style={{maxWidth:880,margin:'20px auto 0',padding:'0 20px',boxSizing:'border-box',display:'flex',flexDirection:'column',gap:8}}>
      {[0,1,2,3,4].map(i => (
        <div key={i} className="mb-skeleton" style={{background:t.surface,border:`1px solid ${t.border}`,
          borderLeft:`4px solid ${t.surface3}`, borderRadius:RADIUS.md, padding:`${SPACE.md+1}px ${SPACE.lg}px`,
          animationDelay:`${i*80}ms`}}>
          <div style={{width:`${60-i*4}%`,height:14,background:t.surface3,borderRadius:RADIUS.sm}} />
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <div style={{width:60,height:16,background:t.surface3,borderRadius:RADIUS.pill}} />
            <div style={{width:44,height:16,background:t.surface3,borderRadius:RADIUS.pill}} />
          </div>
          <div style={{width:'85%',height:11,background:t.surface3,borderRadius:RADIUS.sm,marginTop:9}} />
        </div>
      ))}
    </div>
  );
}

function Spinner({ track='#e5e7eb', accent='#2563eb' }) {
  // The reduced-motion media query in index.html collapses this animation's
  // duration to effectively 0 for anyone with that OS preference set — no
  // per-component branching needed.
  return (
    <div style={{width:32,height:32,border:`3px solid ${track}`,borderTop:`3px solid ${accent}`,
      borderRadius:'50%',animation:'spin .8s linear infinite',margin:'0 auto'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// Small icon + text empty/prompt state, shared by Global Search's two
// blank moments (nothing typed yet / no matches) — matches the icon-based
// empty-state treatment the per-system list already uses (batch 4).
function EmptyHint({ t, Icon, text }) {
  return (
    <div style={{textAlign:'center',paddingTop:40,paddingBottom:8}}>
      <div style={{width:44,height:44,borderRadius:RADIUS.xl2,background:t.surface3,
        display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}>
        <Icon size={19} style={{color:t.text4}} />
      </div>
      <div style={{color:t.text4,fontSize:FONT.size.base}}>{text}</div>
    </div>
  );
}

