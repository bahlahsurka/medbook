// components/ImportedDecks/FavoritesScreen.js
//
// Batch 4 — the user-facing Favorites experience. Data layer (batch 3,
// lib/importedDecks/favorites.js) already tested and merged; this is the
// screen built on top of it. Styled to match its siblings in this
// directory (BrowseDeck.js/DeckBrowser.js's literal-px, t.* token
// convention) rather than FlashCards.js's own SPACE/RADIUS token scale —
// this lives in the same family as those files, not the My Cards screen.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTheme } from '../../lib/theme';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import * as api from '../../lib/importedDecks/api';
import * as favoritesApi from '../../lib/importedDecks/favorites';
import { FLAG_COLORS } from '../../lib/importedDecks/flags';
import { IconStar, IconPlay, IconSearch } from '../../lib/icons';
import CardRenderer, { cardMediaFilenames } from './CardRenderer';

/** Mirrors BrowseDeck.js's own stripHtml — a one-line pure helper, cheaper
 *  to duplicate than to thread through a shared-utils import for. */
function stripHtml(html) { return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

/** "Tzanki Step 2::Cardiology::Arrhythmias" -> "Tzanki Step 2 › Cardiology
 *  › Arrhythmias" — full_name already IS the deck/subdeck path (Anki's own
 *  "::" nesting), so this is purely a display transform, not a second
 *  hierarchy lookup. */
function deckPath(fullName) {
  return String(fullName || '').split('::').join(' › ');
}

export default function FavoritesScreen({ userId, onStudy, onStudyOne }) {
  const { t } = useTheme();
  const [cards, setCards] = useState(null); // null = loading
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const debSearch = useDebouncedValue(search, 200);
  const [deckId, setDeckId] = useState('');
  const [tag, setTag] = useState('');
  const [openCard, setOpenCard] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const rows = await favoritesApi.getFavoriteCards(userId);
      setCards(rows);
    } catch (e) {
      setErr(e.message || 'Could not load favorites');
      setCards([]);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Deck/tag options derived from the loaded favorites themselves — no
  // separate deck-tree or tag-list request. Favorites are a small,
  // already-in-memory set; filtering it client-side (like the options
  // below) is the "existing infrastructure reused, not a second search
  // engine built" this screen calls for, sized to what a favorites list
  // actually is rather than borrowing BrowseDeck's server-side pagination
  // machinery built for a single deck's thousands of cards.
  const deckOptions = useMemo(() => {
    const byId = new Map();
    (cards || []).forEach(c => { if (c.deck) byId.set(c.deck.id, c.deck); });
    return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [cards]);

  const tagOptions = useMemo(() => {
    const set = new Set();
    (cards || []).forEach(c => (c.tags || []).forEach(tg => set.add(tg)));
    return [...set].sort();
  }, [cards]);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = debSearch.trim().toLowerCase();
    return cards.filter(c => {
      if (deckId && c.deck_id !== deckId) return false;
      if (tag && !(c.tags || []).includes(tag)) return false;
      if (q && !stripHtml(c.sort_field || (c.fields || [])[0] || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, debSearch, deckId, tag]);

  const removeFavorite = async (card) => {
    // Instant, no reload — drop it from local state right away, restore the
    // exact prior list if the delete fails, same optimistic/rollback
    // contract StudySession's own star toggle follows.
    const prevCards = cards;
    setCards(cs => cs.filter(c => c.id !== card.id));
    try {
      await favoritesApi.removeFavorite(card.id, userId);
    } catch (e) {
      setCards(prevCards);
      setErr(e.message || `Could not remove "${stripHtml(card.sort_field || '').slice(0, 40)}" from favorites`);
    }
  };

  const totalCount = cards?.length ?? 0;
  const filtersActive = !!(debSearch || deckId || tag);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.text, display: 'flex', alignItems: 'center', gap: 7 }}>
            <IconStar size={15} filled style={{ color: '#eab308' }} />
            Favorite Cards
          </div>
          <div style={{ fontSize: 12.5, color: t.text4, marginTop: 2 }}>
            {cards === null ? 'Loading…' : `${totalCount} card${totalCount !== 1 ? 's' : ''}`}
          </div>
        </div>
        {totalCount > 0 && (
          <button className="mb-fav-btn" onClick={onStudy} style={{
            background: t.accent, color: '#fff', border: 'none', borderRadius: 8,
            padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Inter,sans-serif', display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconPlay size={11} /> Study Favorites
          </button>
        )}
      </div>

      <style>{`
        .mb-fav-btn { transition: filter .12s ease, transform .12s ease; }
        .mb-fav-btn:hover:not(:disabled) { filter: brightness(0.97); }
        body.medbook-dark .mb-fav-btn:hover:not(:disabled) { filter: brightness(1.2); }
        .mb-fav-btn:active:not(:disabled) { transform: scale(0.95); }
        .mb-fav-row { transition: border-color .12s ease, transform .12s ease; }
        .mb-fav-row:hover { border-color: ${t.borderStrong}; }
        @media (prefers-reduced-motion: reduce) { .mb-fav-btn, .mb-fav-row { transition: none !important; } }
      `}</style>

      {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 14 }}>{err}</div>}

      {totalCount > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
            <IconSearch size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: t.text4 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search favorites…"
              style={{ width: '100%', boxSizing: 'border-box', background: t.surface2, border: `1px solid ${t.borderStrong}`,
                borderRadius: 8, color: t.text, padding: '9px 12px 9px 30px', fontSize: 13.5, outline: 'none',
                fontFamily: 'Inter,sans-serif' }} />
          </div>
          {deckOptions.length > 1 && (
            <select value={deckId} onChange={e => setDeckId(e.target.value)}
              style={{ background: t.surface2, border: `1px solid ${t.borderStrong}`, borderRadius: 8,
                color: t.text, padding: '9px 10px', fontSize: 13, fontFamily: 'Inter,sans-serif', maxWidth: 200 }}>
              <option value="">All decks</option>
              {deckOptions.map(d => <option key={d.id} value={d.id}>{d.display_name}</option>)}
            </select>
          )}
          {tagOptions.length > 0 && (
            <select value={tag} onChange={e => setTag(e.target.value)}
              style={{ background: t.surface2, border: `1px solid ${t.borderStrong}`, borderRadius: 8,
                color: t.text, padding: '9px 10px', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>
              <option value="">All tags</option>
              {tagOptions.map(tg => <option key={tg} value={tg}>{tg}</option>)}
            </select>
          )}
        </div>
      )}

      {cards === null ? (
        <div style={{ textAlign: 'center', padding: '50px 0', color: t.text4, fontSize: 13 }}>Loading…</div>
      ) : totalCount === 0 ? (
        // Section 6's exact required copy — not a generic "empty database"
        // message, and no dashboard-style illustration/stats around it.
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: t.surface2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <IconStar size={20} style={{ color: t.text4 }} />
          </div>
          <div style={{ fontSize: 14, color: t.text2, lineHeight: 1.7, maxWidth: 360, margin: '0 auto' }}>
            Favorite important cards while studying.<br />They'll appear here for quick review later.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
          <div style={{ fontSize: 13.5, color: t.text3 }}>
            {filtersActive ? 'No favorites match these filters.' : 'No favorites yet.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(card => (
            <FavoriteRow key={card.id} card={card} t={t}
              onOpen={() => setOpenCard(card)}
              onStudyOne={() => onStudyOne(card)}
              onRemove={() => removeFavorite(card)} />
          ))}
        </div>
      )}

      {openCard && (
        <FavoritePreviewModal t={t} card={openCard} onClose={() => setOpenCard(null)} />
      )}
    </div>
  );
}

// Compact preview — stripped text, deck/subdeck path, tags, flag border,
// star (doubles as the remove-favorite action AND the "this is a favorite"
// indicator — one control for both, not two separate pieces of UI for the
// same fact). Deliberately no card HTML/iframe here; that only loads for a
// row that's actually opened (FavoritePreviewModal), same "don't render
// the whole card in the list" restraint BrowseDeck's own CardRow uses.
function FavoriteRow({ card, t, onOpen, onStudyOne, onRemove }) {
  const preview = stripHtml(card.sort_field || (card.fields || [])[0] || '').slice(0, 100);
  return (
    <div className="mb-fav-row" style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 9,
      borderLeft: card.flag ? `4px solid ${FLAG_COLORS[card.flag]}` : `1px solid ${t.border}`,
      padding: '11px 12px', boxShadow: `0 1px 2px ${t.shadow}`,
      display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
        <div style={{ fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>{preview || '(empty)'}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {card.deck && (
            <span style={{ fontSize: 10.5, color: t.text4 }}>{deckPath(card.deck.full_name)}</span>
          )}
          {(card.tags || []).slice(0, 3).map(tg => (
            <span key={tg} style={{ fontSize: 10, color: t.text4, background: t.surface3,
              borderRadius: 8, padding: '1px 7px' }}>{tg}</span>
          ))}
        </div>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button className="mb-fav-btn" onClick={onStudyOne} title="Study this card" aria-label="Study this card"
          style={{ background: t.surface2, border: `1px solid ${t.border}`, color: t.text3,
            borderRadius: 7, width: 28, height: 28, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconPlay size={10} />
        </button>
        <button className="mb-fav-btn" onClick={onRemove} title="Remove favorite" aria-label="Remove favorite"
          style={{ background: t.surface2, border: `1px solid ${t.border}`, color: '#eab308',
            borderRadius: 7, width: 28, height: 28, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconStar size={13} filled />
        </button>
      </div>
    </div>
  );
}

// Read-only preview — same shape as BrowseDeck's own CardPreviewModal (full
// CardRenderer loads only once opened), independent copy rather than an
// import from BrowseDeck.js: that component isn't exported, and adding a
// favorites-specific action to a modal another unrelated screen owns would
// entangle two screens that should stay independent.
function FavoritePreviewModal({ t, card, onClose }) {
  const [noteModel, setNoteModel] = useState({ note: null, model: null });
  useEffect(() => {
    let cancelled = false;
    api.getNoteAndModel(card.note_id).then(nm => { if (!cancelled) setNoteModel(nm); }).catch(() => {});
    return () => { cancelled = true; };
  }, [card.note_id]);
  const { note, model } = noteModel;
  const [revealed, setRevealed] = useState(false);

  // Batch 6 fix: same bug as BrowseDeck's own CardPreviewModal — this used
  // to hardcode resolvedMedia={{}}, so any favorited card with an image or
  // audio reference always showed the "missing media" placeholder here even
  // when it plays/displays fine in the real study screen. Scoped by this
  // card's own deck_id (favorites can span multiple decks — see
  // StudySession's identical comment on why the per-card id matters, not
  // some single static deck).
  const [resolvedMedia, setResolvedMedia] = useState({});
  useEffect(() => {
    if (!note || !model) return;
    let cancelled = false;
    const filenames = cardMediaFilenames({ card, note, model });
    if (!filenames.length) { setResolvedMedia({}); return; }
    api.resolveMedia(card.deck_id, filenames).then(map => { if (!cancelled) setResolvedMedia(map); })
      .catch(() => { if (!cancelled) setResolvedMedia({}); });
    return () => { cancelled = true; };
  }, [card, note, model]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: t.overlay, zIndex: 250,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surface, borderRadius: 14, padding: 20,
        maxWidth: 520, width: '100%', boxShadow: `0 8px 32px ${t.shadowStrong}`, fontFamily: 'Inter,sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconStar size={12} filled style={{ color: '#eab308' }} /> Favorite Card
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.text3,
            cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {card.deck && (
          <div style={{ fontSize: 11, color: t.text4, marginBottom: 10 }}>{deckPath(card.deck.full_name)}</div>
        )}
        {note && model
          ? <CardRenderer card={card} note={note} model={model} resolvedMedia={resolvedMedia} revealed={revealed} />
          : <div style={{ padding: '20px 0', textAlign: 'center', color: t.text4, fontSize: 13 }}>Loading…</div>}
        <button onClick={() => setRevealed(p => !p)} style={{ marginTop: 12, width: '100%',
          background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
          {revealed ? 'Hide Answer' : 'Show Answer'}
        </button>
      </div>
    </div>
  );
}
