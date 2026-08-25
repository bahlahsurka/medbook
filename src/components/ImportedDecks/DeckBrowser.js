// components/ImportedDecks/DeckBrowser.js
//
// Phase I — the Imported Deck browser. Expandable/collapsible hierarchy via
// parent_id (Phase I1), per-deck actions with confirmations (Phase I2), and
// dedicated empty states (Phase I3).
//
// Counts come straight from the denormalized fields on imported_decks
// (new_cards, due_cards, total_cards) — this component NEVER scans
// imported_cards itself. See lib/importedDecks/api.js for the due_cards
// schema-gap note: a deck with due_cards === null means the live column
// doesn't exist yet, not that nothing is due — rendered as "—", not "0".

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';
import { IconChevronRight } from '../../lib/icons';

// Deck tree expansion state remembered across mounts within a session —
// local UI state per architectural rules ("expanded/collapsed deck nodes"
// is explicitly called out as appropriate for local state, not server state).
const EXPANDED_KEY = 'medbook_imported_deck_expanded';
function loadExpanded() {
  try { return new Set(JSON.parse(sessionStorage.getItem(EXPANDED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveExpanded(set) {
  try { sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...set])); } catch {}
}

export default function DeckBrowser({ userId, onStudy, onBrowse, onImportClick, onStatsClick, refreshSignal }) {
  const { t } = useTheme();
  const [roots, setRoots] = useState(null);      // null = loading
  const [children, setChildren] = useState({});  // parentId -> deck[] | 'loading'
  const [expanded, setExpanded] = useState(loadExpanded);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null); // deck or null
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // deck or null
  const [confirmReset, setConfirmReset] = useState(null);   // deck or null
  const [optionsTarget, setOptionsTarget] = useState(null); // deck or null — "Deck Options" modal
  const [optNewPerDay, setOptNewPerDay] = useState('');     // '' = unlimited
  const [optMaxReviews, setOptMaxReviews] = useState('');   // '' = unlimited
  const [optSaving, setOptSaving] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try { setRoots(await api.getRootDecks(userId)); }
    catch (e) { setErr(e.message || 'Could not load imported decks'); setRoots([]); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // `expanded` rehydrates from sessionStorage on every fresh mount (a page
  // reload, or a browser-tab restore) — correct, that's the point of
  // persisting it. But the fetched `children` cache is deliberately NOT
  // persisted (it's just an in-memory copy of server data, not meaningful
  // UI state), so it always comes back empty on a fresh mount. Left alone,
  // an already-expanded id then renders as open (chevron rotated, per
  // `expanded`) with nothing under it — stuck on "Loading subdecks…"
  // forever, since only toggleExpand's own click handler or
  // reloadExpandedChildren (run after a mutating action) ever populate
  // that cache. That mismatch — visually "forced open" but functionally
  // empty — is the actual root cause behind Batch 5's bug report. Fetch
  // once, for whatever was already expanded, right after mount.
  useEffect(() => {
    if (expanded.size) reloadExpandedChildren(expanded);
    // Mount-time only (deliberately []): this reconciles whatever
    // `expanded` rehydrated to. Every later change to `expanded` goes
    // through toggleExpand, which already fetches for the specific id it
    // just added — re-running this on every `expanded` change would
    // refetch the whole open subtree on every single click, not just the
    // newly-toggled node.
  }, []);

  // Refresh on demand, without a remount — a sibling of the mount-time
  // reconciliation effect above, not a replacement for it. DeckBrowser
  // deliberately stays mounted for the whole time the user is in Imported
  // Decks (FlashCards.js renders Study/Browse/Stats as siblings on top of
  // it, not as a replacement — see that file's own comment), which is
  // exactly right for avoiding the forced-open bug that fix was for, but
  // it also means nothing here ever re-fetches root/subdeck counts after
  // studying actually changes them — new_cards/due_cards on the decks a
  // session touched go stale the moment the user returns, with nothing
  // short of leaving Imported Decks entirely (which remounts everything)
  // to notice. `refreshSignal` is how FlashCards.js says "something
  // outside this component just changed deck data, re-fetch" without
  // forcing a full remount (and the state loss/loading flash/lost scroll
  // position that would bring back) — same load()+reloadExpandedChildren()
  // pair runAction already uses after a rename/archive/delete/reset,
  // reused here rather than a second refresh mechanism. Guarded against
  // its own first run via a REMEMBERED VALUE comparison (not a one-shot
  // boolean flag) — that initial load is already the mount-time effect's
  // job above, and a plain "have I run before" flag would still fire a
  // spurious extra fetch under React 18 StrictMode's dev-only double-
  // invoke (mount -> cleanup -> mount again): a flag flips permanently
  // false on the FIRST of those two synthetic runs, so the second one
  // would incorrectly read as "a real subsequent change." Comparing
  // against the actual last-seen value doesn't have that problem — both
  // synthetic runs see the same unchanged `refreshSignal` and correctly
  // skip either way; only a genuine bump reads as different from what's
  // remembered.
  const lastRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === lastRefreshSignal.current) return;
    lastRefreshSignal.current = refreshSignal;
    load();
    reloadExpandedChildren(expanded);
    // `expanded`/`load`/`reloadExpandedChildren` are read at the moment
    // this fires, which is exactly what's wanted (whatever's currently
    // expanded) — deliberately not listed as deps: this should only
    // re-run when the caller explicitly bumps refreshSignal, not merely
    // because the user expanded/collapsed a node in between.
  }, [refreshSignal]);

  const toggleExpand = async (deck) => {
    const next = new Set(expanded);
    if (next.has(deck.id)) {
      next.delete(deck.id);
    } else {
      next.add(deck.id);
      if (!children[deck.id]) {
        setChildren(p => ({ ...p, [deck.id]: 'loading' }));
        try {
          const kids = await api.getChildDecks(userId, deck.id);
          setChildren(p => ({ ...p, [deck.id]: kids }));
        } catch (e) {
          setChildren(p => ({ ...p, [deck.id]: [] }));
          setErr(e.message || 'Could not load subdecks');
        }
      }
    }
    setExpanded(next);
    saveExpanded(next);
  };

  // Any deck action can change counts/hierarchy anywhere in the tree, so the
  // simplest correct thing is to drop the whole children cache and re-fetch
  // it for every node the user currently has expanded — otherwise an
  // already-open subdeck list would sit on "Loading subdecks…" forever,
  // since only toggleExpand's own click handler ever populates that cache.
  const reloadExpandedChildren = async (expandedIds) => {
    const entries = await Promise.all([...expandedIds].map(async (id) => {
      try { return [id, await api.getChildDecks(userId, id)]; }
      catch { return [id, []]; }
    }));
    setChildren(Object.fromEntries(entries));
  };

  const runAction = async (deck, fn, successMsg) => {
    setBusyId(deck.id); setErr('');
    try { await fn(); if (successMsg) { /* toast could hook in here later */ } await load(); await reloadExpandedChildren(expanded); }
    catch (e) { setErr(e.message || 'Action failed'); }
    setBusyId(null);
  };

  const doRename = async () => {
    if (!renameValue.trim() || !renameTarget) return;
    setBusyId(renameTarget.id);
    try { await api.renameDeck(renameTarget.id, renameValue.trim()); await load(); await reloadExpandedChildren(expanded); }
    catch (e) { setErr(e.message || 'Rename failed'); }
    setBusyId(null); setRenameTarget(null);
  };

  const doArchive = (deck) => runAction(deck, () => api.archiveDeck(deck.id, true));

  const doDelete = async () => {
    if (!confirmDelete) return;
    await runAction(confirmDelete, () => api.deleteDeck(confirmDelete.id));
    setConfirmDelete(null);
  };

  const doReset = async () => {
    if (!confirmReset) return;
    await runAction(confirmReset, () => api.resetDeckProgress(confirmReset.id, userId));
    setConfirmReset(null);
  };

  const openOptions = (deck) => {
    setOptionsTarget(deck);
    setOptNewPerDay(deck.new_cards_per_day == null ? '' : String(deck.new_cards_per_day));
    setOptMaxReviews(deck.max_reviews_per_day == null ? '' : String(deck.max_reviews_per_day));
  };

  // Blank field = unlimited (null), matching Anki's own "no limit" convention
  // for these two settings — see SUPABASE_MIGRATION_STUDY_CONTROLS.sql.
  const doSaveOptions = async () => {
    if (!optionsTarget) return;
    setOptSaving(true); setErr('');
    try {
      await api.updateDeckOptions(optionsTarget.id, {
        newCardsPerDay: optNewPerDay.trim() === '' ? null : Math.max(0, parseInt(optNewPerDay, 10) || 0),
        maxReviewsPerDay: optMaxReviews.trim() === '' ? null : Math.max(0, parseInt(optMaxReviews, 10) || 0),
      });
      await load(); await reloadExpandedChildren(expanded);
      setOptionsTarget(null);
    } catch (e) {
      setErr(e.message || 'Could not save deck options');
    }
    setOptSaving(false);
  };

  const B = (bg, color = '#fff') => ({ background: bg, color, border: 'none', borderRadius: 8,
    padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif' });

  if (roots === null) return (
    <div style={{ textAlign: 'center', paddingTop: 60, color: t.text4, fontFamily: 'Inter,sans-serif' }}>
      Loading imported decks…
    </div>
  );

  // Hierarchy-control hover state + the subdeck reveal transition live here,
  // not inline — inline styles can't express :hover, and prefers-reduced-
  // motion needs a media query to gate the transition itself off (not just
  // shorten it) for users who've asked for that. Both are scoped to plain,
  // deliberately generic class names since nothing else in this tree uses
  // them — same pattern FlashCards.js already uses for its own hover/fade
  // rules.
  const css = `
    .mb-deck-toggle:hover { background: ${t.surface2} !important; color: ${t.text2} !important; }
    .mb-deck-toggle:active { transform: scale(0.94); }
    .mb-deck-children { animation: mb-deck-reveal 1ms; }
    @media (prefers-reduced-motion: no-preference) {
      .mb-deck-toggle-icon { transition: transform 180ms ease; }
      .mb-deck-children { animation: mb-deck-reveal 200ms ease; }
    }
    @keyframes mb-deck-reveal {
      from { opacity: 0; transform: translateY(-3px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Mobile deck-row redesign — see DeckNode's own comment for the full
       reasoning. The desktop composition (one horizontal line: toggle,
       name+stats, Study, Browse, ⋯) and the mobile composition (toggle,
       name+stats, ⋯ on one line; Study+Browse on their own full-width row
       below) are the SAME DOM nodes throughout, purely reordered/resized
       via flex order/flex-basis per breakpoint — never two parallel
       implementations, never duplicated buttons/menu state. */
    .mb-deck-browser { --mb-deck-indent: 18px; }
    @media (max-width: 640px) {
      .mb-deck-browser { --mb-deck-indent: 14px; }
    }
    .mb-deck-row { display: flex; flex-wrap: wrap; align-items: center; column-gap: 10px; row-gap: 6px; }
    .mb-deck-toggle { order: 1; }
    .mb-deck-info { order: 2; flex: 1 1 140px; min-width: 0; }
    .mb-deck-primary-actions { order: 3; display: flex; gap: 6px; flex: 0 0 auto; }
    .mb-deck-menu-wrap { order: 4; flex-shrink: 0; }
    .mb-deck-name {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    @media (max-width: 640px) {
      .mb-deck-row { align-items: flex-start; }
      .mb-deck-menu-wrap { order: 3; margin-left: auto; }
      .mb-deck-primary-actions { order: 5; flex-basis: 100%; margin-top: 2px; }
      .mb-deck-primary-actions .mb-deck-study-btn { flex: 1; }
      .mb-deck-primary-actions .mb-deck-study-btn, .mb-deck-primary-actions .mb-deck-browse-btn {
        padding-top: 10px; padding-bottom: 10px;
      }
      /* Two lines max, never the mid-word/mid-number split the old
         single-line ellipsis produced on a narrow phone ("Tzanki Ste…",
         "Biostati…") — deck identity is too important to guess at.
         -webkit-line-clamp despite the prefix has universal current
         browser support (Safari/Chrome/Firefox/Edge all ship it) and is
         still the only concise way to express "wrap, but at most N lines,
         ellipsize the rest" in CSS. */
      .mb-deck-name {
        white-space: normal; display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; word-break: break-word;
      }
    }
    /* Stats / + Import Anki Deck — same padding step-down reasoning as the
       study toolbar's icon tiles. !important because these reuse the
       shared B() button-style helper's inline padding (used all over this
       file, for modal buttons too) — scoping the override to this one
       class keeps every other B()-styled button untouched. */
    @media (max-width: 380px) {
      .mb-deck-topbtn { padding-left: 12px !important; padding-right: 12px !important; }
    }
  `;

  return (
    <div className="mb-deck-browser" style={{ maxWidth: 680, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
      <style>{css}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>
          Imported Decks <span style={{ fontSize: 13, color: t.text4, fontWeight: 400 }}>({roots.length})</span>
        </div>
        {/* flexWrap here too (not just on the outer row above) is a
            narrow-phone safety net, not the primary fix — the two buttons
            comfortably fit side by side down to 320px once their own
            padding steps down via .mb-deck-topbtn's media query below; this
            only ever engages if that estimate is ever off on a real device,
            wrapping cleanly instead of clipping/overflowing. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onStatsClick && (
            <button className="mb-deck-topbtn" onClick={onStatsClick} style={B(t.surface2, t.text2)}>📊 Stats</button>
          )}
          <button className="mb-deck-topbtn" onClick={onImportClick} style={B(t.accent)}>+ Import Anki Deck</button>
        </div>
      </div>

      {err && (
        <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
          padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 14 }}>{err}</div>
      )}

      {/* Empty state — Phase I3 */}
      {roots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📥</div>
          <div style={{ fontSize: 14, color: t.text3, marginBottom: 6 }}>No imported decks yet.</div>
          <div style={{ fontSize: 13, color: t.text4, marginBottom: 20 }}>
            Import an Anki .apkg deck to study it inside MedBook.
          </div>
          <button onClick={onImportClick} style={B(t.accent)}>+ Import Anki Deck</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {roots.map(deck => (
            <DeckNode key={deck.id} deck={deck} depth={0}
              expanded={expanded} childrenMap={children}
              onToggleExpand={toggleExpand}
              onStudy={onStudy} onBrowse={onBrowse}
              onRename={(d) => { setRenameTarget(d); setRenameValue(d.display_name); }}
              onArchive={doArchive}
              onDeleteRequest={setConfirmDelete}
              onResetRequest={setConfirmReset}
              onOptionsRequest={openOptions}
              busyId={busyId} t={t} />
          ))}
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <Modal t={t} onClose={() => setRenameTarget(null)} title={`Rename "${renameTarget.display_name}"`}>
          <input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus
            style={{ width: '100%', background: t.surface2, border: `1px solid ${t.borderStrong}`,
              borderRadius: 8, color: t.text, padding: '10px 12px', fontSize: 14, outline: 'none',
              boxSizing: 'border-box', fontFamily: 'Inter,sans-serif', marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doRename} disabled={!renameValue.trim() || busyId === renameTarget.id} style={B(t.accent)}>
              {busyId === renameTarget.id ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setRenameTarget(null)} style={B(t.surface3, t.text2)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation — Phase I2, explicit about what's removed */}
      {confirmDelete && (
        <Modal t={t} onClose={() => setConfirmDelete(null)} title={`Delete "${confirmDelete.display_name}"?`}>
          <div style={{ fontSize: 13.5, color: t.text2, lineHeight: 1.7, marginBottom: 8 }}>This will remove:</div>
          <ul style={{ fontSize: 13.5, color: t.text2, lineHeight: 1.8, margin: '0 0 14px', paddingLeft: 20 }}>
            <li>Imported cards</li>
            <li>Notes</li>
            <li>Deck hierarchy</li>
            <li>Associated imported media</li>
          </ul>
          <div style={{ fontSize: 13, color: t.text3, marginBottom: 6 }}>
            Your Review Entries and My Cards will not be affected.
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.danger, marginBottom: 18 }}>
            This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doDelete} disabled={busyId === confirmDelete.id}
              style={{ ...B(t.danger), background: t.danger }}>
              {busyId === confirmDelete.id ? 'Deleting…' : 'Delete Deck'}
            </button>
            <button onClick={() => setConfirmDelete(null)} style={B(t.surface3, t.text2)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Reset progress confirmation — Phase I2 */}
      {confirmReset && (
        <Modal t={t} onClose={() => setConfirmReset(null)} title={`Reset progress in "${confirmReset.display_name}"?`}>
          <div style={{ fontSize: 13.5, color: t.text2, lineHeight: 1.7, marginBottom: 14 }}>
            This resets every card's scheduling state back to New. Cards, notes, media, tags, and
            the deck hierarchy are not affected.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doReset} disabled={busyId === confirmReset.id} style={B(t.warn)}>
              {busyId === confirmReset.id ? 'Resetting…' : 'Reset Progress'}
            </button>
            <button onClick={() => setConfirmReset(null)} style={B(t.surface3, t.text2)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Deck Options — per-deck daily new/review caps (Anki's own "Deck
          Options" idea, scaled down to the two limits that actually apply
          to imported study sessions). Applies to whichever node is opened,
          not aggregated across the whole subtree — see getSessionCards in
          lib/importedDecks/api.js. */}
      {optionsTarget && (
        <Modal t={t} onClose={() => setOptionsTarget(null)} title={`Deck Options — "${optionsTarget.display_name}"`}>
          <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6, marginBottom: 18 }}>
            Limits apply per calendar day, to a study session started from this deck. Leave a field
            blank for no limit.
          </div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: t.text2, marginBottom: 6 }}>
            New cards / day
          </label>
          <input type="number" min="0" inputMode="numeric" value={optNewPerDay}
            onChange={e => setOptNewPerDay(e.target.value)} placeholder="Unlimited"
            style={{ width: '100%', background: t.surface2, border: `1px solid ${t.borderStrong}`,
              borderRadius: 8, color: t.text, padding: '10px 12px', fontSize: 14, outline: 'none',
              boxSizing: 'border-box', fontFamily: 'Inter,sans-serif', marginBottom: 14 }} />
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: t.text2, marginBottom: 6 }}>
            Max reviews / day
          </label>
          <input type="number" min="0" inputMode="numeric" value={optMaxReviews}
            onChange={e => setOptMaxReviews(e.target.value)} placeholder="Unlimited"
            style={{ width: '100%', background: t.surface2, border: `1px solid ${t.borderStrong}`,
              borderRadius: 8, color: t.text, padding: '10px 12px', fontSize: 14, outline: 'none',
              boxSizing: 'border-box', fontFamily: 'Inter,sans-serif', marginBottom: 20 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={doSaveOptions} disabled={optSaving} style={B(t.accent)}>
              {optSaving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setOptionsTarget(null)} style={B(t.surface3, t.text2)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Depth is capped for indentation purposes ("use a reasonable maximum" —
// a hierarchy 5+ levels deep shouldn't keep eating row width forever; the
// hierarchy itself is still fully navigable past this depth, only the
// VISUAL indent stops growing).
const MAX_INDENT_DEPTH = 4;

function DeckNode({ deck, depth, expanded, childrenMap, onToggleExpand, onStudy, onBrowse,
  onRename, onArchive, onDeleteRequest, onResetRequest, onOptionsRequest, busyId, t }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOpen = expanded.has(deck.id);
  const kids = childrenMap[deck.id];
  const hasKidsLoaded = Array.isArray(kids);
  const busy = busyId === deck.id;
  const canStudy = !!(deck.new_cards || deck.due_cards);
  const hasDue = !!deck.due_cards;
  const indentLevel = Math.min(depth, MAX_INDENT_DEPTH);
  const indent = `calc(var(--mb-deck-indent) * ${indentLevel})`;

  return (
    <div>
      {/* Desktop: one horizontal line (toggle, name+stats, Study, Browse,
          ⋯). Mobile: toggle+name+⋯ on the top line, Study+Browse get their
          own full-width line below — the SAME elements, reordered/resized
          via the .mb-deck-row/.mb-deck-info/.mb-deck-primary-actions/
          .mb-deck-menu-wrap flex rules in DeckBrowser's own <style>, not a
          second parallel layout. */}
      <div className="mb-deck-row" style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
        padding: '12px 14px', marginLeft: indent, boxShadow: `0 1px 2px ${t.shadow}`,
        opacity: busy ? 0.6 : 1,
        // The parent's vertical guide line (an absolutely-positioned sibling
        // one level up, in .mb-deck-children) paints above normal-flow
        // content regardless of DOM order — without this the line visibly
        // cut across indented rows' Study button instead of stopping at
        // their left edge. `position:relative` (no z-index needed) gives
        // this row its own stacking box so it paints over the line, same as
        // the un-indented root cards already visually occlude nothing since
        // they sit outside any .mb-deck-children container at all.
        position: 'relative' }}>

        {/* Hierarchy control — a deliberately roomy, standalone tap target
            (40x40) so expand/collapse never has to compete with Study/
            Browse/⋯ for precision, and never risks being mistaken for
            "open this deck". The icon itself stays small and restrained;
            the button around it is what's actually comfortable to hit —
            large interaction target, small visual icon. */}
        <button onClick={() => onToggleExpand(deck)} aria-expanded={isOpen}
          title={isOpen ? 'Collapse subdecks' : 'Expand subdecks'} className="mb-deck-toggle"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, flexShrink: 0, padding: 0,
            background: isOpen ? t.surface2 : 'transparent', color: t.text3,
            border: 'none', borderRadius: 10, cursor: 'pointer' }}>
          <IconChevronRight size={15} className="mb-deck-toggle-icon"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
        </button>

        <div className="mb-deck-info">
          <div className="mb-deck-name" style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
            {deck.display_name}
          </div>
          {/* One text line with middle-dot separators, not three separate
              flex/gap spans — the old per-stat spans had no whiteSpace of
              their own, so under mobile width pressure a single stat like
              "2587 new" could wrap BETWEEN its number and its word ("2587"
              / "new" stacked). Plain text wraps as a whole phrase if it
              ever truly has to, never mid-stat. Large decks get thousands
              separators (deck.new_cards.toLocaleString()) for the same
              scannability reason the spec's own mobile example uses them.
              Due gets a restrained color-only emphasis (not a badge) when
              there's actually something due — it's the one number that
              means "something to act on right now". */}
          <div style={{ fontSize: 11.5, color: t.text4, marginTop: 3 }}>
            {(deck.new_cards ?? 0).toLocaleString()} new · <span style={{
              color: hasDue ? t.accent : t.text4, fontWeight: hasDue ? 700 : 400 }}>
              {deck.due_cards == null ? '—' : deck.due_cards.toLocaleString()} due
            </span> · {(deck.total_cards ?? 0).toLocaleString()} total
          </div>
        </div>

        <div className="mb-deck-menu-wrap" style={{ position: 'relative' }}>
          <button onClick={() => setMenuOpen(p => !p)} title="More actions" aria-label="More actions" style={{
            background: t.surface2, border: `1px solid ${t.border}`, color: t.text2,
            borderRadius: 6, padding: '6px 9px', fontSize: 12, cursor: 'pointer' }}>
            ⋯
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
              <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 11,
                background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8,
                boxShadow: `0 4px 16px ${t.shadowStrong}`, minWidth: 160, overflow: 'hidden' }}>
                {[
                  ['Rename', () => onRename(deck)],
                  ['Deck Options', () => onOptionsRequest(deck)],
                  ['Reset Progress', () => onResetRequest(deck)],
                  ['Archive', () => onArchive(deck)],
                  ['Delete', () => onDeleteRequest(deck)],
                ].map(([label, fn]) => (
                  <div key={label} onClick={() => { setMenuOpen(false); fn(); }} style={{
                    padding: '9px 14px', fontSize: 12.5, cursor: 'pointer',
                    color: label === 'Delete' ? t.danger : t.text2,
                    fontFamily: 'Inter,sans-serif' }}>
                    {label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mb-deck-primary-actions">
          <button className="mb-deck-study-btn" onClick={() => onStudy(deck)} disabled={!canStudy} style={{
            background: canStudy ? t.accent : t.surface3,
            color: canStudy ? '#fff' : t.text4,
            border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
            cursor: canStudy ? 'pointer' : 'default',
            fontFamily: 'Inter,sans-serif' }}>
            ▶ Study
          </button>
          <button className="mb-deck-browse-btn" onClick={() => onBrowse(deck)} style={{
            background: t.surface2, border: `1px solid ${t.border}`, color: t.text2,
            borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
            Browse
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mb-deck-children" style={{ marginTop: 6, position: 'relative',
          display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Subtle vertical guide connecting this deck to its subdecks —
              a folder-like hierarchy cue instead of indentation alone, so
              the relationship reads at a glance without any extra chrome. */}
          <div aria-hidden style={{ position: 'absolute', left: `calc(${indent} + 34px)`, top: 0, bottom: 8,
            width: 1, background: t.border }} />

          {!hasKidsLoaded && (
            <div style={{ marginLeft: `calc(var(--mb-deck-indent) * ${Math.min(depth + 1, MAX_INDENT_DEPTH)})`,
              fontSize: 12, color: t.text4, padding: '6px 0' }}>
              Loading subdecks…
            </div>
          )}
          {hasKidsLoaded && kids.length === 0 && (
            <div style={{ marginLeft: `calc(var(--mb-deck-indent) * ${Math.min(depth + 1, MAX_INDENT_DEPTH)})`,
              fontSize: 12, color: t.text4, padding: '6px 0' }}>
              No subdecks.
            </div>
          )}
          {hasKidsLoaded && kids.map(child => (
            <DeckNode key={child.id} deck={child} depth={depth + 1}
              expanded={expanded} childrenMap={childrenMap} onToggleExpand={onToggleExpand}
              onStudy={onStudy} onBrowse={onBrowse} onRename={onRename} onArchive={onArchive}
              onDeleteRequest={onDeleteRequest} onResetRequest={onResetRequest}
              onOptionsRequest={onOptionsRequest}
              busyId={busyId} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Modal({ t, title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: t.overlay, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surface, borderRadius: 14,
        padding: 24, maxWidth: 420, width: '100%', boxShadow: `0 8px 32px ${t.shadowStrong}`,
        fontFamily: 'Inter,sans-serif', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 16 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}
