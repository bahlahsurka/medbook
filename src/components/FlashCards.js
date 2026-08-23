import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { SYS_COLOR } from '../lib/constants';
import { IconLayers, IconPlay, IconPlus, IconEdit, IconTrash, IconCheck, IconChevronLeft } from '../lib/icons';
import DeckBrowser from './ImportedDecks/DeckBrowser';
import ImportWizard from './ImportedDecks/ImportWizard';
import StudySession from './ImportedDecks/StudySession';
import BrowseDeck from './ImportedDecks/BrowseDeck';
import ImportedStats from './ImportedDecks/ImportedStats';
import FavoritesScreen from './ImportedDecks/FavoritesScreen';

// Sentinel key for cards with no system assigned (legacy cards, or anything
// created before folders existed). Never stored in the DB as this string —
// the DB value is always NULL; this is purely a UI-side grouping key.
const UNCAT = '__uncategorized__';

// Top-level area within Flashcards. 'own' = the existing self-authored
// flashcards feature (My Cards), untouched below. 'imported' = the
// Imported Decks area (Phase H). 'favorites' = batch 4 — same tab-inside-
// Flashcards language, not a new Sidebar entry or separate app section.
const AREA_TABS = [
  { id: 'own', label: 'My Cards' },
  { id: 'imported', label: 'Imported Decks' },
  { id: 'favorites', label: 'Favorite Cards' },
];

// A virtual "deck" — StudySession's queue-loading effect branches on
// `isFavorites` to pull from favorites.getFavoriteCards() instead of
// api.getSessionCards([deck.id]); everything else in that component (flag/
// rate/Focus Mode/keyboard shortcuts/the image lightbox) treats it exactly
// like a real deck. Module-level constant, not created per-render, so its
// object identity stays stable across renders (StudySession's queue effect
// keys off deck.id/deck.isFavorites, not `deck` itself, but a stable
// reference is one less thing to reason about).
const FAVORITES_DECK = { id: '__favorites__', display_name: 'Favorite Cards', isFavorites: true };

// Shared field styling (add/edit forms) — tokenised, otherwise unchanged
// from before this batch.
function fieldStyles(t) {
  return {
    lbl: { fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
      textTransform:'uppercase', display:'block', marginBottom:6 },
    ta: { width:'100%', background:t.surface, border:`1px solid ${t.borderStrong}`, borderRadius:RADIUS.md,
      color:t.text, padding:'10px 12px', fontSize:FONT.size.md, outline:'none',
      boxSizing:'border-box', resize:'vertical', lineHeight:1.6, fontFamily:'Inter,sans-serif' },
    select: { width:'100%', background:t.surface, border:`1px solid ${t.borderStrong}`,
      borderRadius:RADIUS.md, color:t.text, padding:'10px 12px', fontSize:FONT.size.md, outline:'none',
      boxSizing:'border-box', fontFamily:'Inter,sans-serif' },
  };
}

function ErrBox({ t, msg }) {
  return (
    <div style={{ background:t.dangerBg, border:`1px solid ${t.dangerBorder}`,
      borderRadius:RADIUS.md, padding:'10px 14px', fontSize:FONT.size.base, color:t.danger }}>{msg}</div>
  );
}

// Primary/secondary/ghost/danger button — one small factory instead of the
// same five inline style objects repeated at every call site, so every
// button on this screen shares the same size/radius/weight scale.
function Btn({ t, tone='primary', icon, children, ...props }) {
  const map = {
    primary: { background:t.accent, color:'#fff', border:'none' },
    ok:      { background:t.ok,     color:'#fff', border:'none' },
    ghost:   { background:t.surface3, color:t.text2, border:`1px solid ${t.border}` },
    danger:  { background:t.dangerBg, color:t.danger, border:`1px solid ${t.dangerBorder}` },
  };
  const c = map[tone] || map.primary;
  return (
    <button className="mb-fc-btn" {...props} style={{
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap:7,
      ...c, borderRadius:RADIUS.sm+1, padding:'10px 18px', fontSize:FONT.size.sm,
      fontWeight:FONT.weight.semibold, cursor:'pointer', fontFamily:'Inter,sans-serif',
      ...props.style }}>
      {icon}{children}
    </button>
  );
}

export default function FlashCards({ userId, userSystems }) {
  const { t } = useTheme();
  const [area, setArea] = useState('own');
  const [importedSub, setImportedSub] = useState(null); // { mode: 'study'|'browse', deck } | null
  const [favoritesStudyDeck, setFavoritesStudyDeck] = useState(null); // FAVORITES_DECK-shaped object, or null
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [deckBrowserKey, setDeckBrowserKey] = useState(0); // bump to force DeckBrowser to reload after an import completes
  const [cards, setCards]     = useState([]);
  const [loading, setLoading] = useState(true);

  // 'folders' = top-level system browser (the landing view)
  // 'list'    = cards inside one folder/system
  // 'add' | 'edit' | 'study' | 'studyOne'
  const [view, setView]           = useState('folders');
  const [activeFolder, setAF]     = useState(null); // system name, or UNCAT, or null (top level)

  // Bulk select — deliberately an explicit toggle button, NOT long-press.
  // The entry-list's long-press bulk mode has its own touch-sensitivity
  // history; reusing that pattern here would just import the same class of
  // issue into a second screen. A "Select" button avoids it entirely.
  const [bulkMode, setBulkMode]   = useState(false);
  const [selectedIds, setSelIds]  = useState(new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkBusy, setBulkBusy]   = useState(false);

  const [studyIdx, setStudyIdx]   = useState(0);
  const [studyCards, setStudyCards] = useState([]);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]       = useState(false);

  // Form
  const [q, setQ]         = useState('');
  const [a, setA]         = useState('');
  const [formSystem, setFormSystem] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  // Edit
  const [editId, setEditId]   = useState(null);
  const [editQ, setEditQ]     = useState('');
  const [editA, setEditA]     = useState('');
  const [editSystem, setEditSystem] = useState('');
  const [editSaving, setES]   = useState(false);

  const F = fieldStyles(t);

  useEffect(() => {
    if (!userId) return;
    supabase.from('flashcards').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setCards(data || []);
        setLoading(false);
      });
  }, [userId]);

  // ── Folder grouping ──────────────────────────────────────────────────
  // Systems that have cards, in the same order as the sidebar (userSystems),
  // then any system referenced by a card but no longer in userSystems (e.g.
  // renamed/removed — the cards aren't lost, they still get their own
  // folder), then Uncategorized last.
  const folders = useMemo(() => {
    const counts = {};
    cards.forEach(c => {
      const key = c.system || UNCAT;
      counts[key] = (counts[key] || 0) + 1;
    });
    const out = [];
    const seen = new Set();
    (userSystems || []).forEach(s => {
      if (counts[s.name]) {
        out.push({ key: s.name, label: s.name, color: s.color || SYS_COLOR[s.name] || '#2563eb', count: counts[s.name] });
        seen.add(s.name);
      }
    });
    Object.keys(counts).forEach(key => {
      if (key === UNCAT || seen.has(key)) return;
      out.push({ key, label: key, color: SYS_COLOR[key] || '#6b7280', count: counts[key] });
      seen.add(key);
    });
    if (counts[UNCAT]) {
      out.push({ key: UNCAT, label: 'Uncategorized', color: t.text4, count: counts[UNCAT] });
    }
    return out;
  }, [cards, userSystems, t.text4]);

  const folderCards = useMemo(() => {
    if (activeFolder === null) return [];
    return cards.filter(c => (c.system || UNCAT) === activeFolder);
  }, [cards, activeFolder]);

  const openFolder = (key) => { setAF(key); setView('list'); exitBulk(); };
  const backToFolders = () => { setAF(null); setView('folders'); exitBulk(); };

  const exitBulk = () => { setBulkMode(false); setSelIds(new Set()); setBulkTarget(''); };
  const toggleSelect = (id) => setSelIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // One request for the whole batch, matching the same pattern used for
  // bulk operations on entries elsewhere in the app — not a loop of
  // individual updates.
  const bulkMove = async () => {
    if (selectedIds.size === 0 || !bulkTarget) return;
    setBulkBusy(true); setErr('');
    const ids = [...selectedIds];
    const targetSystem = bulkTarget === UNCAT ? null : bulkTarget;
    const { error } = await supabase.from('flashcards')
      .update({ system: targetSystem })
      .in('id', ids);
    setBulkBusy(false);
    if (error) { setErr(`Couldn't move cards: ${error.message}`); return; }
    setCards(p => p.map(c => ids.includes(c.id) ? { ...c, system: targetSystem } : c));
    exitBulk();
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} card${selectedIds.size!==1?'s':''}? This can't be undone.`)) return;
    setBulkBusy(true); setErr('');
    const ids = [...selectedIds];
    const { error } = await supabase.from('flashcards').delete().in('id', ids);
    setBulkBusy(false);
    if (error) { setErr(`Couldn't delete cards: ${error.message}`); return; }
    setCards(p => p.filter(c => !ids.includes(c.id)));
    exitBulk();
  };

  // ── CRUD ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    // Pre-select the system if we're already inside a real folder (not
    // Uncategorized) — saves a click for the common case. Adding from the
    // top level, or from inside Uncategorized, starts blank so you make a
    // deliberate choice instead of drifting back into an unsorted pile.
    setFormSystem(activeFolder && activeFolder !== UNCAT ? activeFolder : '');
    setQ(''); setA(''); setErr(''); setView('add');
  };

  const addCard = async () => {
    if (!q.trim() || !a.trim()) { setErr('Both fields required'); return; }
    if (!formSystem) { setErr('Choose a system for this card'); return; }
    setSaving(true); setErr('');
    const { data, error } = await supabase.from('flashcards').insert({
      user_id: userId, question: q.trim(), answer: a.trim(), system: formSystem
    }).select().single();
    if (error) { setErr(error.message); setSaving(false); return; }
    setCards(p => [data, ...p]);
    setQ(''); setA(''); setSaving(false);
    setAF(formSystem); setView('list'); // land in the folder the card was just filed under
  };

  const deleteCard = async (id) => {
    if (!window.confirm('Delete this flashcard?')) return;
    await supabase.from('flashcards').delete().eq('id', id);
    setCards(p => p.filter(c => c.id !== id));
  };

  const startEdit = (card) => {
    setEditId(card.id); setEditQ(card.question); setEditA(card.answer);
    setEditSystem(card.system || '');
    setErr(''); setView('edit');
  };

  const saveEdit = async () => {
    if (!editQ.trim() || !editA.trim()) { setErr('Both fields required'); return; }
    setES(true); setErr('');
    const { data, error } = await supabase.from('flashcards')
      .update({ question: editQ.trim(), answer: editA.trim(), system: editSystem || null })
      .eq('id', editId).select().single();
    if (error) { setErr(error.message); setES(false); return; }
    setCards(p => p.map(c => c.id === editId ? data : c));
    setES(false); setView('list');
  };

  // Fast path for re-filing legacy/Uncategorized cards without opening the
  // full edit form — a one-click dropdown right on the card row.
  const quickMove = async (card, newSystem) => {
    const { data, error } = await supabase.from('flashcards')
      .update({ system: newSystem || null })
      .eq('id', card.id).select().single();
    if (!error) setCards(p => p.map(c => c.id === card.id ? data : c));
  };

  // ── Study ────────────────────────────────────────────────────────────
  const studyThisFolder = () => {
    const shuffled = [...folderCards].sort(() => Math.random() - 0.5);
    setStudyCards(shuffled);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('study');
  };

  const studyEverything = () => {
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    setStudyCards(shuffled);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('study');
  };

  const studyOne = (card) => {
    setStudyCards([card]);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('studyOne');
  };

  const nextCard = () => {
    if (studyIdx + 1 >= studyCards.length) setDone(true);
    else { setStudyIdx(p => p + 1); setFlipped(false); }
  };

  // studyOne is always a single card, so there's never a previous card to
  // go back to there — only wired up for the multi-card 'study' view.
  const prevCard = () => {
    if (studyIdx === 0) return;
    setStudyIdx(p => p - 1);
    setFlipped(false);
  };

  const card = studyCards[studyIdx];

  // Keyboard: Space=reveal, Enter=Next, ←=Previous (no difficulty rating
  // here — this is a plain flip-through deck, not the spaced-repetition
  // Review Queue).
  const inStudy = (view === 'study' || view === 'studyOne') && !done && !!card;
  useReviewKeyboard(inStudy, {
    flipped, onFlip: () => setFlipped(true),
    onNext: () => nextCard(),
    onPrev: view === 'study' ? () => prevCard() : undefined,
  });

  // Shared local styling — kept inline (as Dashboard.js does) since this
  // screen mounts once at a time, not hundreds of times like EntryCard.
  const localCss = `
    .mb-fc-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-fc-btn:hover:not(:disabled) { filter: brightness(0.97); }
    body.medbook-dark .mb-fc-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .mb-fc-btn:active:not(:disabled) { transform: scale(0.96); }
    .mb-fc-row { transition: border-color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}, box-shadow ${MOTION.fast} ${MOTION.ease}; }
    .mb-fc-row:hover { border-color: ${t.borderStrong}; transform: translateY(-1px); }
    .mb-fc-row:active { transform: scale(0.99); }
    .mb-fc-fade { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }
  `;

  if (loading) return (
    <div style={{ textAlign:'center', paddingTop:60, color:t.text4, fontFamily:'Inter,sans-serif', fontSize:FONT.size.sm }}>
      Loading flashcards…
    </div>
  );

  // ── Imported Decks area ─────────────────────────────────────────────
  // A tab inside Flashcards, not a new Sidebar section. Everything below
  // this branch is the pre-existing "My Cards" feature, untouched.
  if (area === 'imported') {
    // Batch 5 fix: DeckBrowser stays mounted the whole time the user is in
    // the Imported Decks area — Study/Browse/Stats render as SIBLINGS on
    // top of it (hidden via display:none, not unmounted) instead of the
    // old pattern of returning a differently-shaped root that unmounted
    // DeckBrowser entirely whenever importedSub became non-null.
    //
    // That unmount was the actual root cause of "subdeck stays forced
    // open": DeckBrowser's expanded Set persists across mounts via
    // sessionStorage, but its fetched children map does not (nor should
    // it — it's just an in-memory cache, not meaningful to persist). Every
    // remount rehydrated `expanded` (so a node still LOOKED expanded, its
    // chevron still rotated open) while `children` came back empty with
    // nothing to re-fetch it, so the row was stuck showing "Loading
    // subdecks…" — a broken-looking permanently-open state, not an
    // intentionally-restored one. Keeping DeckBrowser mounted removes the
    // remount entirely, so both pieces of state simply stay exactly as the
    // user left them — no persistence trick or extra fetch-on-mount patch
    // needed, and no risk of the two ever drifting apart again.
    //
    // Bonus: this is also strictly cheaper — entering/exiting Study no
    // longer re-fetches root decks or any already-expanded subdeck list at
    // all, and any scroll position inside the tree survives a study trip
    // for free.
    const subOpen = !!importedSub;
    return (
      <>
        {importedSub?.mode === 'study' && (
          <StudySession deck={importedSub.deck} userId={userId} onExit={() => setImportedSub(null)} />
        )}
        {importedSub?.mode === 'browse' && (
          <BrowseDeck deck={importedSub.deck} userId={userId} onExit={() => setImportedSub(null)} />
        )}
        {importedSub?.mode === 'stats' && (
          <ImportedStats userId={userId} onExit={() => setImportedSub(null)} />
        )}
        <div style={{ display: subOpen ? 'none' : 'block', maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
          <AreaTabs t={t} area={area} setArea={setArea} />
          <DeckBrowser key={deckBrowserKey} userId={userId}
            onStudy={(deck) => setImportedSub({ mode: 'study', deck })}
            onBrowse={(deck) => setImportedSub({ mode: 'browse', deck })}
            onImportClick={() => setShowImportWizard(true)}
            onStatsClick={() => setImportedSub({ mode: 'stats' })} />
          {showImportWizard && (
            <ImportWizard userId={userId}
              onClose={() => setShowImportWizard(false)}
              onImported={() => setDeckBrowserKey(k => k + 1)} />
          )}
        </div>
      </>
    );
  }

  // ── Favorites area ───────────────────────────────────────────────────
  // batch 4. Reuses StudySession as-is (see FAVORITES_DECK's own comment)
  // for both "Study Favorites" (the whole set) and a single row's "Study"
  // action (the same virtual deck, with onlyCardId narrowing the queue to
  // just that one card) — one study-session code path either way, not two.
  if (area === 'favorites') {
    if (favoritesStudyDeck) return (
      <StudySession deck={favoritesStudyDeck} userId={userId} onExit={() => setFavoritesStudyDeck(null)} />
    );
    return (
      <div style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
        <AreaTabs t={t} area={area} setArea={setArea} />
        <FavoritesScreen userId={userId}
          onStudy={() => setFavoritesStudyDeck(FAVORITES_DECK)}
          onStudyOne={(card) => setFavoritesStudyDeck({ ...FAVORITES_DECK, onlyCardId: card.id })} />
      </div>
    );
  }

  // ── Study mode ────────────────────────────────────────────────────────
  if (view === 'study' || view === 'studyOne') {
    const isOne = view === 'studyOne';
    const backTarget = () => { setView('list'); setDone(false); };

    if (done || (!card && studyCards.length > 0)) return (
      <div className="mb-fc-fade" style={{ maxWidth:480, margin:'0 auto', textAlign:'center',
        paddingTop:'14vh', fontFamily:'Inter,sans-serif' }}>
        <style>{localCss}</style>
        <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background:t.okBg,
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          <IconCheck size={22} style={{ color:t.ok }} />
        </div>
        <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text, marginBottom:8 }}>
          {isOne ? 'Card reviewed' : 'All done!'}
        </div>
        {!isOne && <div style={{ fontSize:FONT.size.base, color:t.text3, marginBottom:26 }}>
          You went through all {studyCards.length} card{studyCards.length!==1?'s':''}.
        </div>}
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap', marginTop:isOne?18:0 }}>
          {!isOne && activeFolder !== null && (
            <Btn t={t} tone="primary" icon={<IconPlay size={12} />} onClick={studyThisFolder}>
              Shuffle &amp; Restart
            </Btn>
          )}
          <Btn t={t} tone="ghost" icon={<IconChevronLeft size={13} />}
            onClick={activeFolder===null ? backToFolders : backTarget}>
            {activeFolder===null ? 'All Folders' : 'Back to List'}
          </Btn>
        </div>
      </div>
    );

    return (
      <div className="mb-fc-fade" style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
        <style>{localCss}</style>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:SPACE.lg }}>
          <button onClick={activeFolder===null ? backToFolders : backTarget} className="mb-fc-btn" style={{
            background:'none', border:'none', color:t.text3, cursor:'pointer', fontSize:FONT.size.sm,
            fontWeight:FONT.weight.medium, fontFamily:'Inter,sans-serif', padding:'4px 2px',
            display:'flex', alignItems:'center', gap:4 }}>
            <IconChevronLeft size={14} /> Back
          </button>
          {!isOne && (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <button className="mb-fc-btn" onClick={prevCard} disabled={studyIdx===0}
                title="Previous card" aria-label="Previous card" style={{
                background:t.surface2, border:`1px solid ${t.border}`,
                color: studyIdx===0 ? t.text4 : t.text3, opacity: studyIdx===0 ? .45 : 1,
                borderRadius:RADIUS.sm, width:28, height:28, cursor: studyIdx===0 ? 'default' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center' }}>
                <IconChevronLeft size={12} />
              </button>
              <span style={{ fontSize:FONT.size.sm, color:t.text3, fontWeight:FONT.weight.medium, padding:'0 2px' }}>
                {studyIdx + 1} / {studyCards.length}
              </span>
            </div>
          )}
        </div>

        {!isOne && (
          <div style={{ height:4, background:t.surface3, borderRadius:RADIUS.sm, marginBottom:SPACE.xl2 }}>
            <div style={{ height:'100%', background:t.accent, borderRadius:RADIUS.sm,
              width:`${((studyIdx+1)/studyCards.length)*100}%`, transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
          </div>
        )}

        {/* The card IS the screen — minimal chrome around it, per the "card
            as visual focus" direction. */}
        <div key={studyIdx} className="mb-fc-fade" style={{ background:t.surface, border:`1px solid ${t.border}`,
          borderRadius:RADIUS.lg, padding:SPACE.xl2, minHeight:220, boxShadow:elevation(t,'sm'),
          marginBottom:SPACE.lg, display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontSize:FONT.size.micro, color:t.text4, fontWeight:FONT.weight.semibold,
            textTransform:'uppercase', letterSpacing:.8, marginBottom:SPACE.md }}>Question</div>
          <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.semibold, color:t.text, lineHeight:1.5 }}>
            {card.question}
          </div>
          {flipped && (
            <div className="mb-fc-fade" style={{ marginTop:SPACE.xl2, paddingTop:SPACE.xl2, borderTop:`1px solid ${t.border}` }}>
              <div style={{ fontSize:FONT.size.micro, color:t.ok, fontWeight:FONT.weight.semibold,
                textTransform:'uppercase', letterSpacing:.8, marginBottom:SPACE.md }}>Answer</div>
              <div style={{ fontSize:FONT.size.lg, color:t.text2, lineHeight:1.7, whiteSpace:'pre-wrap' }}>
                {card.answer}
              </div>
            </div>
          )}
        </div>

        {!flipped ? (
          <Btn t={t} tone="primary" onClick={()=>setFlipped(true)} style={{ width:'100%', padding:'13px 18px' }}>
            Show Answer <span style={{ opacity:.7, fontWeight:FONT.weight.regular }}>· Space</span>
          </Btn>
        ) : (
          <div style={{ display:'flex', gap:10 }}>
            {!isOne && (
              <Btn t={t} tone="ok" onClick={nextCard} style={{ flex:1, padding:'13px 18px' }}>
                Next →
              </Btn>
            )}
            <Btn t={t} tone="ghost" onClick={activeFolder===null ? backToFolders : backTarget}
              style={{ flex:isOne?1:'0 0 auto', padding:'13px 18px' }}>
              {isOne ? 'Back to List' : 'End Session'}
            </Btn>
          </div>
        )}
      </div>
    );
  }

  // ── Add mode ──────────────────────────────────────────────────────────
  if (view === 'add') return (
    <div className="mb-fc-fade" style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <style>{localCss}</style>
      <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text, marginBottom:SPACE.xl }}>
        New Flashcard
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:SPACE.lg-2 }}>
        <div>
          <label style={F.lbl}>System</label>
          <select value={formSystem} onChange={e=>setFormSystem(e.target.value)} style={F.select}>
            <option value="">Choose a system…</option>
            {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={F.lbl}>Question</label>
          <textarea value={q} onChange={e=>setQ(e.target.value)}
            placeholder="What is the mechanism of action of metformin?"
            rows={3} style={F.ta} />
        </div>
        <div>
          <label style={F.lbl}>Answer</label>
          <textarea value={a} onChange={e=>setA(e.target.value)}
            placeholder="Activates AMPK → decreases hepatic gluconeogenesis"
            rows={4} style={F.ta} />
        </div>
        {err && <ErrBox t={t} msg={err} />}
        <div style={{ display:'flex', gap:10 }}>
          <Btn t={t} tone="primary" onClick={addCard} disabled={saving} icon={<IconPlus size={13} />}>
            {saving?'Saving…':'Add Card'}
          </Btn>
          <Btn t={t} tone="ghost"
            onClick={()=>{ activeFolder ? setView('list') : backToFolders(); setQ(''); setA(''); setErr(''); }}>
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  );

  // ── Edit mode ─────────────────────────────────────────────────────────
  if (view === 'edit') return (
    <div className="mb-fc-fade" style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <style>{localCss}</style>
      <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text, marginBottom:SPACE.xl }}>
        Edit Flashcard
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:SPACE.lg-2 }}>
        <div>
          <label style={F.lbl}>System</label>
          <select value={editSystem} onChange={e=>setEditSystem(e.target.value)} style={F.select}>
            <option value="">Uncategorized</option>
            {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={F.lbl}>Question</label>
          <textarea value={editQ} onChange={e=>setEditQ(e.target.value)} rows={3} style={F.ta} />
        </div>
        <div>
          <label style={F.lbl}>Answer</label>
          <textarea value={editA} onChange={e=>setEditA(e.target.value)} rows={4} style={F.ta} />
        </div>
        {err && <ErrBox t={t} msg={err} />}
        <div style={{ display:'flex', gap:10 }}>
          <Btn t={t} tone="primary" onClick={saveEdit} disabled={editSaving} icon={<IconCheck size={13} />}>
            {editSaving?'Saving…':'Save Changes'}
          </Btn>
          <Btn t={t} tone="ghost" onClick={()=>{ setView('list'); setErr(''); }}>
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  );

  // ── Folder list (top level) ─────────────────────────────────────────
  if (view === 'folders') return (
    <div className="mb-fc-fade" style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <style>{localCss}</style>
      <AreaTabs t={t} area={area} setArea={setArea} />
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:SPACE.xl, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text }}>Flashcards</div>
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:2 }}>
            {cards.length} card{cards.length!==1?'s':''} across {folders.length} folder{folders.length!==1?'s':''}
          </div>
        </div>
        {cards.length > 0 && (
          <Btn t={t} tone="primary" icon={<IconPlay size={11} />} onClick={studyEverything}>
            Study Everything
          </Btn>
        )}
      </div>

      {cards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background:t.navActiveBg,
            display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <IconLayers size={22} style={{ color:t.accent }} />
          </div>
          <div style={{ fontSize:FONT.size.base, color:t.text3, marginBottom:18, lineHeight:1.6 }}>
            No flashcards yet. Add cards from AI Analysis, or create one manually below.
          </div>
          <Btn t={t} tone="primary" icon={<IconPlus size={13} />} onClick={openAdd}>Add First Card</Btn>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:SPACE.sm }}>
          {folders.map(f => (
            <button key={f.key} className="mb-fc-row" onClick={()=>openFolder(f.key)} style={{
              display:'flex', alignItems:'center', gap:SPACE.md, textAlign:'left',
              background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
              padding:'14px 18px', cursor:'pointer', boxShadow:elevation(t,'sm'),
              fontFamily:'Inter,sans-serif' }}>
              <div style={{ width:9, height:9, borderRadius:RADIUS.circle, background:f.color, flexShrink:0 }} />
              <div style={{ flex:1, fontSize:FONT.size.md, fontWeight:FONT.weight.semibold,
                color: f.key===UNCAT ? t.text3 : t.text,
                fontStyle: f.key===UNCAT ? 'italic' : 'normal' }}>
                {f.label}
              </div>
              <span style={{ fontSize:FONT.size.xs, color:t.text4, background:t.surface3,
                borderRadius:RADIUS.pill, padding:'2px 9px', fontWeight:FONT.weight.semibold }}>{f.count}</span>
              <IconChevronLeft size={13} style={{ color:t.text4, transform:'rotate(180deg)' }} />
            </button>
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <Btn t={t} tone="ok" icon={<IconPlus size={13} />} onClick={openAdd} style={{ marginTop:SPACE.lg, width:'100%' }}>
          New Card
        </Btn>
      )}
    </div>
  );

  // ── Per-folder card list ─────────────────────────────────────────────
  const folderMeta = folders.find(f => f.key === activeFolder);
  const folderLabel = folderMeta?.label || (activeFolder===UNCAT ? 'Uncategorized' : activeFolder);
  const folderColor = folderMeta?.color || t.text4;

  return (
    <div className="mb-fc-fade" style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <style>{localCss}</style>
      <button onClick={backToFolders} className="mb-fc-btn" style={{ background:'none', border:'none',
        color:t.text3, cursor:'pointer', fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, marginBottom:SPACE.md,
        fontFamily:'Inter,sans-serif', padding:'4px 2px', display:'flex', alignItems:'center', gap:4 }}>
        <IconChevronLeft size={14} /> All Folders
      </button>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:SPACE.lg, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:9, height:9, borderRadius:RADIUS.circle, background:folderColor, flexShrink:0 }} />
          <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text }}>
            {folderLabel} <span style={{ fontSize:FONT.size.sm, color:t.text4, fontWeight:FONT.weight.regular }}>({folderCards.length})</span>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {folderCards.length > 0 && !bulkMode && (
            <Btn t={t} tone="primary" icon={<IconPlay size={11} />} onClick={studyThisFolder}>Study</Btn>
          )}
          {folderCards.length > 0 && (
            <Btn t={t} tone={bulkMode ? 'ghost' : 'ghost'} onClick={()=> bulkMode ? exitBulk() : setBulkMode(true)}>
              {bulkMode ? 'Cancel' : 'Select'}
            </Btn>
          )}
          {!bulkMode && <Btn t={t} tone="ok" icon={<IconPlus size={12} />} onClick={openAdd}>New Card</Btn>}
        </div>
      </div>

      {/* Bulk action bar — appears once at least one card is checked. One
          request moves/deletes the whole batch, not a loop per card. */}
      {bulkMode && (
        <div className="mb-fc-fade" style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
          background:t.surface2, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
          padding:'10px 12px', marginBottom:SPACE.lg }}>
          <span style={{ fontSize:FONT.size.sm, color:t.text3, fontWeight:FONT.weight.semibold }}>
            {selectedIds.size===0 ? 'Tap cards to select' : `${selectedIds.size} selected`}
          </span>
          {selectedIds.size > 0 && (
            <>
              <select value={bulkTarget} onChange={e=>setBulkTarget(e.target.value)}
                style={{ fontSize:FONT.size.xs, background:t.surface, border:`1px solid ${t.borderStrong}`,
                  borderRadius:RADIUS.sm, padding:'5px 8px', color:t.text, fontFamily:'Inter,sans-serif' }}>
                <option value="">Move to…</option>
                <option value={UNCAT}>Uncategorized</option>
                {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              <button className="mb-fc-btn" onClick={bulkMove} disabled={!bulkTarget || bulkBusy} style={{
                fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif',
                background: bulkTarget ? t.ok : t.surface3, color: bulkTarget ? '#fff' : t.text4,
                border:'none', borderRadius:RADIUS.sm, padding:'6px 12px',
                cursor: (bulkTarget && !bulkBusy) ? 'pointer' : 'default' }}>
                {bulkBusy ? 'Moving…' : 'Move'}
              </button>
              <button className="mb-fc-btn" onClick={bulkDelete} disabled={bulkBusy} style={{
                fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif',
                background:t.dangerBg, color:t.danger, border:`1px solid ${t.dangerBorder}`,
                borderRadius:RADIUS.sm, padding:'6px 12px', cursor:bulkBusy?'default':'pointer' }}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {err && <div style={{marginBottom:SPACE.lg}}><ErrBox t={t} msg={err} /></div>}

      {activeFolder === UNCAT && folderCards.length > 0 && !bulkMode && (
        <div style={{ background:t.warnBg, border:`1px solid ${t.warnBorder}`, borderRadius:RADIUS.md,
          padding:'10px 14px', fontSize:FONT.size.xs, color:t.warn, marginBottom:SPACE.lg, lineHeight:1.6 }}>
          These cards have no system assigned. Tap <strong>Select</strong> to move several at
          once, or use the dropdown on a single card to file it individually.
        </div>
      )}

      {folderCards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background:t.navActiveBg,
            display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <IconLayers size={22} style={{ color:t.accent }} />
          </div>
          <div style={{ fontSize:FONT.size.base, color:t.text3, marginBottom:18 }}>
            No cards in {folderLabel} yet.
          </div>
          <Btn t={t} tone="primary" icon={<IconPlus size={13} />} onClick={openAdd}>Add a Card</Btn>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:SPACE.sm+2 }}>
          {folderCards.map(c => {
            const isSel = selectedIds.has(c.id);
            return (
            <div key={c.id} className="mb-fc-row"
              onClick={bulkMode ? ()=>toggleSelect(c.id) : undefined}
              style={{ background:t.surface,
                border:`1px solid ${isSel ? folderColor : t.border}`,
                outline: isSel ? `2px solid ${folderColor}` : 'none',
                borderRadius:RADIUS.md, padding:'16px 18px', boxShadow:elevation(t,'sm'),
                cursor: bulkMode ? 'pointer' : 'default' }}>
              <div style={{ display:'flex', justifyContent:'space-between',
                alignItems:'flex-start', gap:SPACE.md }}>
                {bulkMode && (
                  <div style={{ width:20, height:20, borderRadius:RADIUS.sm-1, flexShrink:0, marginTop:1,
                    background: isSel ? folderColor : t.surface,
                    border:`2px solid ${isSel ? folderColor : t.borderStrong}`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
                    {isSel && <IconCheck size={11} style={{ color:'#fff' }} />}
                  </div>
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:FONT.size.base, fontWeight:FONT.weight.semibold, color:t.text, marginBottom:6, lineHeight:1.5 }}>
                    {c.question}
                  </div>
                  <div style={{ fontSize:FONT.size.sm, color:t.text3, lineHeight:1.6,
                    overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                    {c.answer}
                  </div>
                </div>
                {!bulkMode && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0, alignItems:'flex-end' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="mb-fc-btn" onClick={()=>studyOne(c)} title="Review this card" style={{
                        background:t.navActiveBg, border:`1px solid ${t.navActiveBorder}`, color:t.navActiveText,
                        borderRadius:RADIUS.sm, padding:'5px 9px', fontSize:FONT.size.xs,
                        cursor:'pointer', display:'flex', alignItems:'center' }}>
                        <IconPlay size={10} />
                      </button>
                      <button className="mb-fc-btn" onClick={()=>startEdit(c)} title="Edit" style={{
                        background:t.surface2, border:`1px solid ${t.border}`, color:t.text2,
                        borderRadius:RADIUS.sm, padding:'5px 9px', fontSize:FONT.size.xs,
                        cursor:'pointer', display:'flex', alignItems:'center' }}>
                        <IconEdit size={10} />
                      </button>
                      <button className="mb-fc-btn" onClick={()=>deleteCard(c.id)} title="Delete" style={{
                        background:t.dangerBg, border:`1px solid ${t.dangerBorder}`, color:t.danger,
                        borderRadius:RADIUS.sm, padding:'5px 9px', fontSize:FONT.size.xs,
                        cursor:'pointer', display:'flex', alignItems:'center' }}>
                        <IconTrash size={10} />
                      </button>
                    </div>
                    {/* Fast re-file path — no need to open Edit just to fix a
                        miscategorized or legacy Uncategorized card. */}
                    <select value={c.system || ''} onChange={e=>quickMove(c, e.target.value)}
                      title="Move to a different system"
                      style={{ fontSize:FONT.size.micro, background:t.surface2, border:`1px solid ${t.border}`,
                        borderRadius:RADIUS.sm, padding:'4px 6px', color:t.text3, fontFamily:'Inter,sans-serif',
                        cursor:'pointer' }}>
                      <option value="">Uncategorized</option>
                      {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

// Shared tab switcher between the two Flashcards areas. Only shown at each
// area's top level (My Cards folders / Imported Decks root) — sub-flows
// (add/edit/study, deck browse/study) use their own "← Back" convention,
// same as the rest of the app.
function AreaTabs({ t, area, setArea }) {
  return (
    <div style={{ display:'flex', gap:4, marginBottom:18, background:t.surface2,
      border:`1px solid ${t.border}`, borderRadius:9, padding:3, width:'fit-content' }}>
      {AREA_TABS.map(tab => (
        <button key={tab.id} onClick={()=>setArea(tab.id)} style={{
          background: area===tab.id ? t.surface : 'transparent',
          color: area===tab.id ? t.text : t.text3,
          border:'none', borderRadius:7, padding:'7px 16px', fontSize:13,
          fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif',
          boxShadow: area===tab.id ? `0 1px 2px ${t.shadow}` : 'none' }}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
