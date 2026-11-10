import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { SYS_COLOR } from '../lib/constants';
import { IconLayers, IconPlay, IconPlus, IconEdit, IconTrash, IconCheck, IconChevronLeft } from '../lib/icons';
import DeckBrowser from './ImportedDecks/DeckBrowser';
import ImportWizard from './ImportedDecks/ImportWizard';
import StudySession from './ImportedDecks/StudySession';
import BrowseDeck from './ImportedDecks/BrowseDeck';
import { STUDY_SCOPE_CLASS, suppressContextMenu } from '../lib/studyInteraction';
import ImportedStats from './ImportedDecks/ImportedStats';
import FavoritesScreen from './ImportedDecks/FavoritesScreen';
import { loadActiveStudy, saveActiveStudy, clearActiveStudy } from '../lib/importedDecks/studySessionStore';
import * as ownCardsApi from '../lib/ownCards/api';
import OwnCardsStats from './OwnCardsStats';
import StudyByTimePicker from './StudyByTimePicker';
import WeakSpotsPanel from './WeakSpotsPanel';
import { renderOwnCardText, stripOwnCardSyntax, findSimilarCard } from '../lib/ownCards/cardText';
import { OWN_CARDS_DEFAULTS, studyMinutesToCardBudget } from '../lib/ownCards/settings';
import { mergeOutboxIntoRows } from '../lib/ratingOutbox';

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

// A virtual "deck" for My Cards — same pattern as FAVORITES_DECK above, this
// time keyed on `isOwnCards` (see StudySession.js / lib/ownCards/api.js).
// `scope` is one of:
//   { kind: 'all' }                 -> every folder, due+new across all of them
//   { kind: 'uncat' }                -> only cards with no system (system IS NULL)
//   { kind: 'system', system: name } -> one specific folder
// The resulting deck's `ownCardsSystem` is exactly the shape
// lib/ownCards/api.js's getSessionCards expects for its own `system` param.
// `limit` is omitted for the plain "Study due" entry points (StudySession
// falls back to its own default of 50) and supplied by Stage 3's "Study
// by time" picker — the exact card budget studyMinutesToCardBudget()
// computed for whichever duration was chosen, so the picker's own "~N
// cards" preview and the session StudySession actually runs can never
// show two different numbers for the same duration.
// The one place a `{ kind, system? }` scope converts to lib/ownCards/
// api.js's own `system` param shape — used by both ownCardsDeck (actually
// studying) and the Study-by-time picker (just previewing counts), so
// they can never disagree about what a given scope means.
function scopeToOwnCardsSystem(scope) {
  if (scope.kind === 'all') return null;
  if (scope.kind === 'uncat') return { uncategorized: true };
  return scope.system;
}

function ownCardsDeck(scope, { limit } = {}) {
  const idSuffix = scope.kind === 'all' ? 'all' : scope.kind === 'uncat' ? 'uncat' : `sys:${scope.system}`;
  const displayName = scope.kind === 'all' ? 'My Cards' : scope.kind === 'uncat' ? 'Uncategorized' : scope.system;
  return {
    id: `__owncards__:${idSuffix}`,
    display_name: displayName,
    isOwnCards: true,
    ownCardsSystem: scopeToOwnCardsSystem(scope),
    newCardsPerDay: OWN_CARDS_DEFAULTS.newCardsPerDay,
    limit,
  };
}

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

// Stage 2 item 5 — a proper in-app confirm, My Cards only (window.confirm
// stays exactly as-is everywhere else in the app; this never touches
// DetailView.js/ManageSystems.js's own usages). Same overlay/centered-card
// convention FavoritesScreen's own preview modal already uses, not a new
// pattern. `state` is `{ message, onConfirm }` or null; the caller owns
// that state and clears it in both the confirm and cancel handlers.
function ConfirmDialog({ t, state, onCancel }) {
  if (!state) return null;
  return (
    <div onClick={onCancel} style={{ position:'fixed', inset:0, background:t.overlay, zIndex:300,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:t.surface, borderRadius:RADIUS.lg,
        padding:20, maxWidth:360, width:'100%', boxShadow:`0 8px 32px ${t.shadowStrong}`,
        fontFamily:'Inter,sans-serif' }}>
        <div style={{ fontSize:FONT.size.base, color:t.text, lineHeight:1.6, marginBottom:18 }}>
          {state.message}
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <Btn t={t} tone="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn t={t} tone="danger" onClick={state.onConfirm}>Delete</Btn>
        </div>
      </div>
    </div>
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

  // Critical Bug Fix Batch 1 — "no automatic navigation to Flashcards
  // home". A page reload (whether the user triggered it or a mobile
  // browser did, discarding a backgrounded tab) used to always boot this
  // component to the 'own' folders view, no matter what the user was
  // actually doing — there was zero persistence above StudySession itself
  // of WHICH deck/area was even active. That's the other half of "the app
  // loses my study session": even a perfectly resumable StudySession (see
  // that component's own header comment) is useless if nothing ever routes
  // back to it automatically.
  //
  // Read once, synchronously, before the first paint (a lazy useState
  // initializer, not an effect) so a restored session renders immediately
  // — no flash of the folders homepage first. Only ever points at an
  // in-progress STUDY session (imported deck or Favorites): Browse/Stats
  // have no meaningful position to lose, and restoring into those too
  // would be a bigger behavior change than this bug fix calls for.
  const [restoredStudy] = useState(() => loadActiveStudy(userId));
  const [area, setArea] = useState(() => restoredStudy?.area || 'own');
  // { mode: 'study'|'browse', deck } | null — a restored pointer only ever
  // carries enough to reconstruct the minimal deck shape StudySession
  // itself actually reads (id + display_name; see that component). It
  // deliberately does NOT refetch the real deck row here: that would be
  // an extra request on every single reload just to repaint a name that's
  // about to be replaced by StudySession's own fresh data anyway.
  const [importedSub, setImportedSub] = useState(() => (
    restoredStudy?.area === 'imported' && restoredStudy.mode === 'study'
      ? { mode: 'study', deck: { id: restoredStudy.deckId, display_name: restoredStudy.displayName || '' } }
      : null
  ));
  const [favoritesStudyDeck, setFavoritesStudyDeck] = useState(() => (
    restoredStudy?.area === 'favorites'
      ? { ...FAVORITES_DECK, ...(restoredStudy.onlyCardId ? { onlyCardId: restoredStudy.onlyCardId } : {}) }
      : null
  )); // FAVORITES_DECK-shaped object, or null
  // My Cards' own study pointer — Stage 1 item 1, the same saveActiveStudy
  // pattern above extended to `area: 'own'`. The restored pointer only
  // carries the scope (all / uncategorized / one system), which is enough
  // to rebuild the exact same virtual deck via ownCardsDeck() — StudySession
  // re-fetches everything else itself.
  const [ownStudyDeck, setOwnStudyDeck] = useState(() => (
    restoredStudy?.area === 'own'
      ? ownCardsDeck({ kind: restoredStudy.scopeKind || 'all', system: restoredStudy.system })
      : null
  ));
  const [favoritesKey, setFavoritesKey] = useState(0); // bump to refresh FavoritesScreen after a Study Favorites round trip
  const [showOwnStats, setShowOwnStats] = useState(false); // Stage 2 item 4 — My Cards' own Stats screen
  // Stage 3 item 7 — Study by time picker. { scope: {kind, system}, label } or null.
  const [studyByTimeTarget, setStudyByTimeTarget] = useState(null);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [deckBrowserKey, setDeckBrowserKey] = useState(0); // bump to force DeckBrowser to reload after an import completes
  const [deckRefreshSignal, setDeckRefreshSignal] = useState(0); // bump to refresh DeckBrowser's counts (no remount) after Study changes deck data
  const [cards, setCards]     = useState([]);
  const [loading, setLoading] = useState(true);

  // 'folders' = top-level system browser (the landing view)
  // 'list'    = cards inside one folder/system
  // 'add' | 'edit' | 'study' | 'studyOne'
  const [view, setView]           = useState('folders');
  const [activeFolder, setAF]     = useState(null); // system name, or UNCAT, or null (top level)
  // Stage 2 item 5 — search box inside a folder, question+answer text.
  const [folderSearch, setFolderSearch] = useState('');

  // Bulk select — deliberately an explicit toggle button, NOT long-press.
  // The entry-list's long-press bulk mode has its own touch-sensitivity
  // history; reusing that pattern here would just import the same class of
  // issue into a second screen. A "Select" button avoids it entirely.
  const [bulkMode, setBulkMode]   = useState(false);
  const [selectedIds, setSelIds]  = useState(new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkBusy, setBulkBusy]   = useState(false);

  // Stage 2 item 5 — in-app confirm dialog state. `{ message, onConfirm }`
  // or null; see ConfirmDialog's own comment above.
  const [confirmState, setConfirmState] = useState(null);

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

  // Extracted so a My Cards study session's exit can re-pull fresh
  // scheduling data (state/due_at/etc. just changed by StudySession/
  // lib/ownCards/api.js directly in the DB, bypassing this component's own
  // `cards` state) — "counts refresh after a session" per the brief,
  // same reason DeckBrowser bumps its own refreshSignal after Study.
  const refetchCards = useCallback(() => {
    if (!userId) return;
    return supabase.from('flashcards').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        // Instant ratings (lib/ratingOutbox.js) — a rating made just
        // before a reload/kill, or whose background flush just hasn't
        // landed yet, must still count toward srsCountsByFolder/Overall
        // below (section 5's "reads must include unsynced ratings"),
        // the same overlay App.js's loadEntries uses for entries.
        if (!error) setCards(mergeOutboxIntoRows(userId, 'own_card', data || [], 'id'));
        setLoading(false);
      });
  }, [userId]);

  useEffect(() => { refetchCards(); }, [refetchCards]);

  // ── Folder grouping ──────────────────────────────────────────────────
  // Systems that have cards, in the same order as the sidebar (userSystems),
  // then any system referenced by a card but no longer in userSystems (e.g.
  // renamed/removed — the cards aren't lost, they still get their own
  // folder), then Uncategorized last.
  // Study-engine counts, per folder — New/Learning/Due, computed live from
  // the already-loaded `cards` array (Stage 1 item 2). No denormalized
  // count table to go stale: this is always exactly as fresh as `cards`
  // itself, which refetchCards() refreshes after a study session.
  const srsCountsByFolder = useMemo(() => ownCardsApi.computeFolderCounts(cards, UNCAT), [cards]);
  const srsCountsOverall = useMemo(() => ownCardsApi.computeOverallCounts(cards), [cards]);

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
    return out.map(f => ({ ...f, srs: srsCountsByFolder[f.key] || { new: 0, learning: 0, due: 0 } }));
  }, [cards, userSystems, t.text4, srsCountsByFolder]);

  const folderCards = useMemo(() => {
    if (activeFolder === null) return [];
    return cards.filter(c => (c.system || UNCAT) === activeFolder);
  }, [cards, activeFolder]);

  // Stage 2 item 5 — search box inside a folder. Plain case-insensitive
  // substring match over question+answer, client-side (a folder's cards
  // are already fully in memory — no reason for a second query). Separate
  // from folderCards itself so "no cards in this folder at all" and "no
  // cards match this search" can show distinct, correct empty states.
  const visibleFolderCards = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    if (!q) return folderCards;
    return folderCards.filter(c =>
      (c.question || '').toLowerCase().includes(q) || (c.answer || '').toLowerCase().includes(q));
  }, [folderCards, folderSearch]);

  const openFolder = (key) => { setAF(key); setView('list'); exitBulk(); setFolderSearch(''); };
  const backToFolders = () => { setAF(null); setView('folders'); exitBulk(); setFolderSearch(''); };

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

  const bulkDelete = () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setConfirmState({
      message: `Delete ${ids.length} card${ids.length!==1?'s':''}? This can't be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true); setErr('');
        const { error } = await supabase.from('flashcards').delete().in('id', ids);
        setBulkBusy(false);
        if (error) { setErr(`Couldn't delete cards: ${error.message}`); return; }
        setCards(p => p.filter(c => !ids.includes(c.id)));
        exitBulk();
      },
    });
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

  const deleteCard = (id) => {
    setConfirmState({
      message: 'Delete this flashcard?',
      onConfirm: async () => {
        setConfirmState(null);
        await supabase.from('flashcards').delete().eq('id', id);
        setCards(p => p.filter(c => c.id !== id));
      },
    });
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
  // Engram Stage 1 — multi-card study now runs on the same spaced-
  // repetition engine as Imported Decks/Favorites (StudySession +
  // lib/ownCards/api.js), replacing the old plain shuffle-and-flip deck
  // (and its biased `sort(() => Math.random() - 0.5)` shuffle) entirely.
  // "Study due (all folders)" / per-folder "Study due" both go through
  // startOwnStudy; `ownStudyDeck` being non-null takes over the whole
  // screen below, same as importedSub/favoritesStudyDeck do for their
  // own areas.
  const startOwnStudy = (scope, { limit } = {}) => {
    const deck = ownCardsDeck(scope, { limit });
    saveActiveStudy(userId, { area: 'own', scopeKind: scope.kind, system: scope.system || null });
    setOwnStudyDeck(deck);
  };
  const exitOwnStudy = () => { clearActiveStudy(userId); setOwnStudyDeck(null); refetchCards(); };

  // Stage 3 item 7 — "Study by time". `scope`/`label` identify what the
  // picker is scoped to; the picker itself (StudyByTimePicker) computes
  // the "~N cards" preview, and onStart here is only ever called with the
  // Scheduler-math budget for whichever duration was tapped.
  const openStudyByTime = (scope, label) => setStudyByTimeTarget({ scope, label });
  const startStudyByTimeBudget = (budget) => {
    const scope = studyByTimeTarget.scope;
    setStudyByTimeTarget(null);
    startOwnStudy(scope, { limit: budget });
  };

  // Stage 3 item 9 — "One tap = Study by time scoped to that system."
  // Literally one tap: starts immediately at the default duration rather
  // than opening the picker again, since the whole point of surfacing a
  // weak spot is to make studying it as frictionless as possible.
  const studyWeakSystem = (system) => {
    startOwnStudy({ kind: 'system', system }, { limit: studyMinutesToCardBudget(OWN_CARDS_DEFAULTS.defaultStudyMinutes) });
  };

  // Single-card "Review" (studyOne) stays an ungraded preview, per the
  // brief's explicit "may stay ungraded" option — chosen deliberately:
  // it's a quick look-up from a folder list, not a scheduled study
  // session, and keeping it as the pre-existing plain flip-through is the
  // smallest-diff choice that doesn't interfere with the new engine's own
  // due-card bookkeeping (a studyOne peek was never meant to count as a
  // "review" toward scheduling).
  const studyOne = (card) => {
    setStudyCards([card]);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('studyOne');
  };

  // Always exactly one card for studyOne, so "next" only ever means "done".
  const nextCard = () => setDone(true);

  const card = studyCards[studyIdx];

  // Keyboard: Space=reveal, Enter=done (no Previous — a single-card preview
  // has nothing to go back to).
  const inStudy = view === 'studyOne' && !done && !!card;
  useReviewKeyboard(inStudy, {
    flipped, onFlip: () => setFlipped(true),
    onNext: () => nextCard(),
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

  // ── Imported Decks area ─────────────────────────────────────────────
  // A tab inside Flashcards, not a new Sidebar section. Everything below
  // this branch is the pre-existing "My Cards" feature, untouched.
  //
  // Batch 6: `loading` only ever tracks the My Cards (`cards` table) fetch
  // below — Imported Decks and Favorites load their own data independently
  // and don't read `cards`/`loading` at all. This used to gate the whole
  // component before the area switch, so opening Imported Decks or
  // Favorites sat behind "Loading flashcards…" until My Cards' own fetch
  // finished (or hung) — an unnecessary loading state for screens that
  // had nothing to do with what was loading. The check now lives after
  // both of those branches, so it only ever applies to the 'own' area.
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
    // Exiting a STUDY session bumps deckRefreshSignal — studying is the one
    // sub-mode that actually changes deck data (new_cards/due_cards, via
    // rateCard's own count refresh) that the deck list itself displays.
    // DeckBrowser stays mounted the whole time (Batch 5), which is exactly
    // right for avoiding the forced-open bug, but means nothing re-fetches
    // those counts on its own once studying changes them — bumping the
    // signal is how it's told to, without forcing the full remount (and
    // the loading flash / lost scroll position) that would undo that fix.
    // Browse/Stats never change scheduling, so their own exits don't need
    // this — only clearing the active-study pointer, which they never set
    // in the first place, so that's a harmless no-op too.
    const exitImportedStudy = () => { clearActiveStudy(userId); setImportedSub(null); setDeckRefreshSignal(s => s + 1); };
    return (
      <>
        {importedSub?.mode === 'study' && (
          <StudySession deck={importedSub.deck} userId={userId} onExit={exitImportedStudy} />
        )}
        {importedSub?.mode === 'browse' && (
          <BrowseDeck deck={importedSub.deck} userId={userId} onExit={() => setImportedSub(null)} />
        )}
        {importedSub?.mode === 'stats' && (
          <ImportedStats userId={userId} onExit={() => setImportedSub(null)} />
        )}
        <div style={{ display: subOpen ? 'none' : 'block', maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
          <AreaTabs t={t} area={area} setArea={setArea} />
          <DeckBrowser key={deckBrowserKey} refreshSignal={deckRefreshSignal} userId={userId}
            onStudy={(deck) => {
              saveActiveStudy(userId, { area: 'imported', mode: 'study', deckId: deck.id, displayName: deck.display_name });
              setImportedSub({ mode: 'study', deck });
            }}
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
    // Batch 6: same fix as Imported Decks (Batch 5) — FavoritesScreen stays
    // mounted across a Study Favorites round trip instead of being replaced
    // by a differently-shaped root, so exiting a study session doesn't
    // force a full refetch + "Loading…" flash + lost search/filter state
    // just to get back to a list that (usually) hasn't changed. It DOES
    // still refetch once specifically on return from Study — not blindly
    // trusting staleness — via favoritesKey, since favoriting/unfavoriting
    // cards during that session is a real way the list itself changes;
    // this is a deliberate one-time refresh, not the old unconditional
    // remount-on-every-transition.
    return (
      <>
        {favoritesStudyDeck && (
          <StudySession deck={favoritesStudyDeck} userId={userId}
            onExit={() => { clearActiveStudy(userId); setFavoritesStudyDeck(null); setFavoritesKey(k => k + 1); }} />
        )}
        <div style={{ display: favoritesStudyDeck ? 'none' : 'block', maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
          <AreaTabs t={t} area={area} setArea={setArea} />
          <FavoritesScreen key={favoritesKey} userId={userId}
            onStudy={() => {
              saveActiveStudy(userId, { area: 'favorites' });
              setFavoritesStudyDeck(FAVORITES_DECK);
            }}
            onStudyOne={(card) => {
              saveActiveStudy(userId, { area: 'favorites', onlyCardId: card.id });
              setFavoritesStudyDeck({ ...FAVORITES_DECK, onlyCardId: card.id });
            }} />
        </div>
      </>
    );
  }

  // My Cards' own graded study session — takes over the whole screen while
  // active, same as importedSub/favoritesStudyDeck do for their own areas.
  // Placed before the `loading` gate: resuming into a session on reload
  // shouldn't have to wait on the folder list's own fetch first.
  if (ownStudyDeck) {
    return <StudySession deck={ownStudyDeck} userId={userId} onExit={exitOwnStudy} />;
  }

  if (showOwnStats) {
    return <OwnCardsStats userId={userId} onExit={() => setShowOwnStats(false)} />;
  }

  if (loading) return (
    <div style={{ textAlign:'center', paddingTop:60, color:t.text4, fontFamily:'Inter,sans-serif', fontSize:FONT.size.sm }}>
      Loading flashcards…
    </div>
  );

  // ── Single-card preview ("Review") ──────────────────────────────────
  // Ungraded by design — see studyOne's own comment above for why.
  if (view === 'studyOne') {
    const backTarget = () => { setView('list'); setDone(false); };

    if (done || !card) return (
      <div className="mb-fc-fade" style={{ maxWidth:480, margin:'0 auto', textAlign:'center',
        paddingTop:'14vh', fontFamily:'Inter,sans-serif' }}>
        <style>{localCss}</style>
        <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background:t.okBg,
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          <IconCheck size={22} style={{ color:t.ok }} />
        </div>
        <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text, marginBottom:8 }}>
          Card reviewed
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap', marginTop:18 }}>
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
        </div>

        {/* The card IS the screen — minimal chrome around it, per the "card
            as visual focus" direction. */}
        {/* mb-study-scope + data-selectable: the question/answer text stays
            fully selectable and copyable, but without the browser's own
            right-click menu / OS selection callout popping up over a study
            card — see lib/studyInteraction.js. The "Question"/"Answer"
            labels and buttons around it are untouched (not selectable,
            same as any UI chrome, same as before this change). */}
        <div key={studyIdx} className={`mb-fc-fade ${STUDY_SCOPE_CLASS}`} onContextMenu={suppressContextMenu}
          style={{ background:t.surface, border:`1px solid ${t.border}`,
          borderRadius:RADIUS.lg, padding:SPACE.xl2, minHeight:220, boxShadow:elevation(t,'sm'),
          marginBottom:SPACE.lg, display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontSize:FONT.size.micro, color:t.text4, fontWeight:FONT.weight.semibold,
            textTransform:'uppercase', letterSpacing:.8, marginBottom:SPACE.md }}>Question</div>
          <div data-selectable="true" style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.semibold, color:t.text, lineHeight:1.5, whiteSpace:'pre-wrap' }}
            dangerouslySetInnerHTML={{ __html: renderOwnCardText(card.question, false) }} />
          {flipped && (
            <div className="mb-fc-fade" style={{ marginTop:SPACE.xl2, paddingTop:SPACE.xl2, borderTop:`1px solid ${t.border}` }}>
              <div style={{ fontSize:FONT.size.micro, color:t.ok, fontWeight:FONT.weight.semibold,
                textTransform:'uppercase', letterSpacing:.8, marginBottom:SPACE.md }}>Answer</div>
              <div data-selectable="true" style={{ fontSize:FONT.size.lg, color:t.text2, lineHeight:1.7, whiteSpace:'pre-wrap' }}
                dangerouslySetInnerHTML={{ __html: renderOwnCardText(card.answer, true) }} />
            </div>
          )}
        </div>

        {!flipped ? (
          <Btn t={t} tone="primary" onClick={()=>setFlipped(true)} style={{ width:'100%', padding:'13px 18px' }}>
            Show Answer <span style={{ opacity:.7, fontWeight:FONT.weight.regular }}>· Space</span>
          </Btn>
        ) : (
          <Btn t={t} tone="ghost" onClick={activeFolder===null ? backToFolders : backTarget}
            style={{ width:'100%', padding:'13px 18px' }}>
            Back to List
          </Btn>
        )}
      </div>
    );
  }

  // ── Add mode ──────────────────────────────────────────────────────────
  if (view === 'add') {
    // Stage 2 item 6 — duplicate warning, "warn, never block". Checked
    // against every card the user owns (not just the current folder —
    // a near-duplicate filed under a different system is still a
    // near-duplicate), recomputed as they type. Never disables Add Card.
    const similar = findSimilarCard(q, cards);
    return (
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
        {similar && (
          <div style={{ background:t.warnBg, border:`1px solid ${t.warnBorder}`, borderRadius:RADIUS.md,
            padding:'10px 14px', fontSize:FONT.size.xs, color:t.warn, lineHeight:1.6 }}>
            ⚠️ A similar card already exists{similar.system ? ` in ${similar.system}` : ''}: "{stripOwnCardSyntax(similar.question).slice(0, 80)}"
          </div>
        )}
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
  }

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
      {studyByTimeTarget && (
        <StudyByTimePicker t={t} userId={userId} system={scopeToOwnCardsSystem(studyByTimeTarget.scope)}
          scopeLabel={studyByTimeTarget.label} onStart={startStudyByTimeBudget} onClose={() => setStudyByTimeTarget(null)} />
      )}
      <AreaTabs t={t} area={area} setArea={setArea} />
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:SPACE.xl, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text }}>Flashcards</div>
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:2 }}>
            {cards.length} card{cards.length!==1?'s':''} across {folders.length} folder{folders.length!==1?'s':''}
            {(srsCountsOverall.new + srsCountsOverall.due) > 0 && (
              <> · {srsCountsOverall.due} due, {srsCountsOverall.new} new</>
            )}
          </div>
        </div>
        {cards.length > 0 && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn t={t} tone="ghost" onClick={() => setShowOwnStats(true)}>Stats</Btn>
            <Btn t={t} tone="ghost" onClick={() => openStudyByTime({ kind: 'all' }, 'All folders')}>
              Study by time
            </Btn>
            <Btn t={t} tone="primary" icon={<IconPlay size={11} />}
              disabled={(srsCountsOverall.new + srsCountsOverall.due) === 0}
              onClick={() => startOwnStudy({ kind: 'all' })}
              style={{ opacity: (srsCountsOverall.new + srsCountsOverall.due) === 0 ? .5 : 1 }}>
              Study due (all folders)
            </Btn>
          </div>
        )}
      </div>

      {cards.length > 0 && <WeakSpotsPanel t={t} userId={userId} onStudySystem={studyWeakSystem} />}

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
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:FONT.size.md, fontWeight:FONT.weight.semibold,
                  color: f.key===UNCAT ? t.text3 : t.text,
                  fontStyle: f.key===UNCAT ? 'italic' : 'normal' }}>
                  {f.label}
                </div>
                {/* Stage 1 item 2 — New/Learning/Due per folder, not just a
                    total. Only the non-zero segments show, so a folder
                    nobody has studied yet doesn't read as "0 · 0 · 0". */}
                {(f.srs.new + f.srs.learning + f.srs.due) > 0 && (
                  <div style={{ fontSize:FONT.size.micro, color:t.text4, marginTop:2 }}>
                    {[
                      f.srs.due > 0 && `${f.srs.due} due`,
                      f.srs.learning > 0 && `${f.srs.learning} learning`,
                      f.srs.new > 0 && `${f.srs.new} new`,
                    ].filter(Boolean).join(' · ')}
                  </div>
                )}
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
  const folderSrs = folderMeta?.srs || srsCountsByFolder[activeFolder] || { new: 0, learning: 0, due: 0 };

  return (
    <div className="mb-fc-fade" style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <style>{localCss}</style>
      <ConfirmDialog t={t} state={confirmState} onCancel={() => setConfirmState(null)} />
      {studyByTimeTarget && (
        <StudyByTimePicker t={t} userId={userId} system={scopeToOwnCardsSystem(studyByTimeTarget.scope)}
          scopeLabel={studyByTimeTarget.label} onStart={startStudyByTimeBudget} onClose={() => setStudyByTimeTarget(null)} />
      )}
      <button onClick={backToFolders} className="mb-fc-btn" style={{ background:'none', border:'none',
        color:t.text3, cursor:'pointer', fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, marginBottom:SPACE.md,
        fontFamily:'Inter,sans-serif', padding:'4px 2px', display:'flex', alignItems:'center', gap:4 }}>
        <IconChevronLeft size={14} /> All Folders
      </button>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:SPACE.lg, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:9, height:9, borderRadius:RADIUS.circle, background:folderColor, flexShrink:0 }} />
          <div>
            <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text }}>
              {folderLabel} <span style={{ fontSize:FONT.size.sm, color:t.text4, fontWeight:FONT.weight.regular }}>({folderCards.length})</span>
            </div>
            {(folderSrs.new + folderSrs.learning + folderSrs.due) > 0 && (
              <div style={{ fontSize:FONT.size.micro, color:t.text4, marginTop:2 }}>
                {[
                  folderSrs.due > 0 && `${folderSrs.due} due`,
                  folderSrs.learning > 0 && `${folderSrs.learning} learning`,
                  folderSrs.new > 0 && `${folderSrs.new} new`,
                ].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {folderCards.length > 0 && !bulkMode && (
            <>
              <Btn t={t} tone="ghost"
                onClick={() => openStudyByTime(activeFolder === UNCAT ? { kind: 'uncat' } : { kind: 'system', system: activeFolder }, folderLabel)}>
                Study by time
              </Btn>
              <Btn t={t} tone="primary" icon={<IconPlay size={11} />}
                disabled={(folderSrs.new + folderSrs.due) === 0}
                style={{ opacity: (folderSrs.new + folderSrs.due) === 0 ? .5 : 1 }}
                onClick={() => startOwnStudy(activeFolder === UNCAT ? { kind: 'uncat' } : { kind: 'system', system: activeFolder })}>
                Study due
              </Btn>
            </>
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

      {folderCards.length > 0 && !bulkMode && (
        <input value={folderSearch} onChange={e => setFolderSearch(e.target.value)}
          placeholder="Search this folder…"
          style={{ width:'100%', boxSizing:'border-box', background:t.surface2, border:`1px solid ${t.borderStrong}`,
            borderRadius:RADIUS.md, color:t.text, padding:'10px 12px', fontSize:FONT.size.sm, outline:'none',
            fontFamily:'Inter,sans-serif', marginBottom:SPACE.lg }} />
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
      ) : visibleFolderCards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'50px 20px' }}>
          <div style={{ fontSize:28, marginBottom:10 }}>🔍</div>
          <div style={{ fontSize:FONT.size.base, color:t.text3 }}>No cards match "{folderSearch}".</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:SPACE.sm+2 }}>
          {visibleFolderCards.map(c => {
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
                    {stripOwnCardSyntax(c.question)}
                  </div>
                  <div style={{ fontSize:FONT.size.sm, color:t.text3, lineHeight:1.6,
                    overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                    {stripOwnCardSyntax(c.answer)}
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
  // "My Cards" / "Imported Decks" / "Favorite Cards" at their normal
  // padding+font don't all fit side by side much below ~390px — width:
  // 'fit-content' with no cap would then render WIDER than the viewport,
  // which is what actually causes page-level horizontal scroll (not the
  // tab labels themselves). maxWidth:'100%' + overflowX:'auto' turns that
  // into a contained, scrollable strip instead — the tabs still all exist
  // and are all reachable, just scroll horizontally AS A UNIT on the
  // narrowest phones rather than ever forcing the whole page to. The
  // slightly tighter mobile padding below means this only actually
  // engages at the very smallest widths this batch tests (320-360px);
  // 375px+ fits without scrolling either way.
  return (
    <div className="mb-area-tabs" style={{ display:'flex', gap:4, marginBottom:18, background:t.surface2,
      border:`1px solid ${t.border}`, borderRadius:RADIUS.md, padding:3, width:'fit-content', maxWidth:'100%',
      overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
      <style>{`
        @media (max-width: 480px) {
          .mb-area-tabs button { padding: 7px 11px !important; font-size: 12.5px !important; white-space: nowrap; }
        }
      `}</style>
      {AREA_TABS.map(tab => (
        <button key={tab.id} onClick={()=>setArea(tab.id)} style={{
          background: area===tab.id ? t.surface : 'transparent',
          color: area===tab.id ? t.text : t.text3,
          border:'none', borderRadius:RADIUS.sm, padding:'7px 16px', fontSize:13,
          fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif', flexShrink:0,
          boxShadow: area===tab.id ? elevation(t,'sm') : 'none' }}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
