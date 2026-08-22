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

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';

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

export default function DeckBrowser({ userId, onStudy, onBrowse, onImportClick, onStatsClick }) {
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

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>
          Imported Decks <span style={{ fontSize: 13, color: t.text4, fontWeight: 400 }}>({roots.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onStatsClick && (
            <button onClick={onStatsClick} style={B(t.surface2, t.text2)}>📊 Stats</button>
          )}
          <button onClick={onImportClick} style={B(t.accent)}>+ Import Anki Deck</button>
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

function DeckNode({ deck, depth, expanded, childrenMap, onToggleExpand, onStudy, onBrowse,
  onRename, onArchive, onDeleteRequest, onResetRequest, onOptionsRequest, busyId, t }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOpen = expanded.has(deck.id);
  const kids = childrenMap[deck.id];
  const hasKidsLoaded = Array.isArray(kids);
  const busy = busyId === deck.id;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10,
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
        padding: '12px 14px', marginLeft: depth * 18, boxShadow: `0 1px 2px ${t.shadow}`,
        opacity: busy ? 0.6 : 1 }}>

        <button onClick={() => onToggleExpand(deck)} title={isOpen ? 'Collapse' : 'Expand'}
          style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer',
            fontSize: 12, width: 18, flexShrink: 0, padding: 0,
            transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>
          ▶
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deck.display_name}
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11.5, color: t.text4, marginTop: 3 }}>
            <span>{deck.new_cards ?? 0} new</span>
            <span>{deck.due_cards == null ? '— due' : `${deck.due_cards} due`}</span>
            <span>{deck.total_cards ?? 0} total</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0, position: 'relative' }}>
          <button onClick={() => onStudy(deck)} disabled={!(deck.new_cards || deck.due_cards)} style={{
            background: (deck.new_cards || deck.due_cards) ? t.accent : t.surface3,
            color: (deck.new_cards || deck.due_cards) ? '#fff' : t.text4,
            border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
            cursor: (deck.new_cards || deck.due_cards) ? 'pointer' : 'default',
            fontFamily: 'Inter,sans-serif' }}>
            ▶ Study
          </button>
          <button onClick={() => onBrowse(deck)} style={{
            background: t.surface2, border: `1px solid ${t.border}`, color: t.text2,
            borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
            Browse
          </button>
          <button onClick={() => setMenuOpen(p => !p)} style={{
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
      </div>

      {isOpen && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!hasKidsLoaded && (
            <div style={{ marginLeft: (depth + 1) * 18, fontSize: 12, color: t.text4, padding: '6px 0' }}>
              Loading subdecks…
            </div>
          )}
          {hasKidsLoaded && kids.length === 0 && (
            <div style={{ marginLeft: (depth + 1) * 18, fontSize: 12, color: t.text4, padding: '6px 0' }}>
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
