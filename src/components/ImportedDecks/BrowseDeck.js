// components/ImportedDecks/BrowseDeck.js
//
// Phase K/K1/K2 — browse + search inside one deck. Server-side pagination
// (api.browseCards) throughout — this component never fetches a whole
// deck's cards, which matters concretely for the ~7,043-card test deck.
// Debounced search reuses the app's existing lib/useDebouncedValue, the
// same hook the entry list and global search already use.

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../lib/theme';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import * as api from '../../lib/importedDecks/api';
import { FLAGS, FLAG_COLORS, FLAG_NAMES } from '../../lib/importedDecks/flags';
import CardRenderer, { cardMediaFilenames } from './CardRenderer';

const PAGE_SIZE = 30;
const STATES = ['new', 'learning', 'review', 'suspended']; // Phase K's required state filters
                                                             // ('Due' is derived — due_at <= now, not a stored state)

const STATE_COLOR = { new: '#2563eb', learning: '#d97706', review: '#16a34a', suspended: '#6b7280' };

export default function BrowseDeck({ deck, userId, onExit }) {
  const { t } = useTheme();
  const [search, setSearch] = useState('');
  const debSearch = useDebouncedValue(search, 250);
  const [state, setState] = useState('');
  const [tag, setTag] = useState('');
  const [flag, setFlag] = useState(''); // '' = all, '0' = unflagged only, '1'-'7' = that color
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState(null); // null = loading
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [openCard, setOpenCard] = useState(null); // full renderer loads only on demand (K1)

  useEffect(() => { setPage(0); }, [debSearch, state, tag, flag]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const result = await api.browseCards(deck.id, {
        search: debSearch, state, tag, flag: flag === '' ? null : Number(flag),
        page, pageSize: PAGE_SIZE, userId,
      });
      setRows(result.rows); setTotal(result.total);
    } catch (e) { setErr(e.message || 'Could not load cards'); setRows([]); }
  }, [deck.id, debSearch, state, tag, flag, page, userId]);

  useEffect(() => { load(); }, [load]);

  const [allTags, setAllTags] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.getDeckTags(deck.id, userId).then(tags => { if (!cancelled) setAllTags(tags); }).catch(() => {});
    return () => { cancelled = true; };
  }, [deck.id, userId]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>
      <button onClick={onExit} style={{ background: 'none', border: 'none', color: t.text3,
        cursor: 'pointer', fontSize: 13, fontWeight: 500, marginBottom: 14, padding: 0 }}>
        ← {deck.display_name}
      </button>

      <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 14 }}>
        Browse <span style={{ fontSize: 13, color: t.text4, fontWeight: 400 }}>({total.toLocaleString()})</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cards…"
          style={{ flex: 1, minWidth: 160, background: t.surface2, border: `1px solid ${t.borderStrong}`,
            borderRadius: 8, color: t.text, padding: '9px 12px', fontSize: 13.5, outline: 'none',
            fontFamily: 'Inter,sans-serif' }} />
        <select value={state} onChange={e => setState(e.target.value)}
          style={{ background: t.surface2, border: `1px solid ${t.borderStrong}`, borderRadius: 8,
            color: t.text, padding: '9px 10px', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>
          <option value="">All states</option>
          {STATES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        {allTags.length > 0 && (
          <select value={tag} onChange={e => setTag(e.target.value)}
            style={{ background: t.surface2, border: `1px solid ${t.borderStrong}`, borderRadius: 8,
              color: t.text, padding: '9px 10px', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>
            <option value="">All tags</option>
            {allTags.map(tg => <option key={tg} value={tg}>{tg}</option>)}
          </select>
        )}
        <select value={flag} onChange={e => setFlag(e.target.value)}
          style={{ background: t.surface2, border: `1px solid ${t.borderStrong}`, borderRadius: 8,
            color: t.text, padding: '9px 10px', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>
          <option value="">All flags</option>
          <option value="0">🏳 No flag</option>
          {FLAGS.map(f => <option key={f} value={f}>🚩 {FLAG_NAMES[f]}</option>)}
        </select>
      </div>

      {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 14 }}>{err}</div>}

      {rows === null ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: t.text4, fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
          <div style={{ fontSize: 13.5, color: t.text3 }}>
            {debSearch || state || tag ? 'No cards match these filters.' : 'No cards in this deck.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(card => <CardRow key={card.id} card={card} t={t} onOpen={() => setOpenCard(card)} />)}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 18 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ ...pageBtn(t), opacity: page === 0 ? 0.4 : 1 }}>‹ Prev</button>
          <span style={{ fontSize: 12.5, color: t.text3 }}>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ ...pageBtn(t), opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next ›</button>
        </div>
      )}

      {/* Full renderer loads only when a row is opened (Phase K1) */}
      {openCard && (
        <CardPreviewModal t={t} card={openCard} onClose={() => setOpenCard(null)}
          onFlagChange={updated => {
            setOpenCard(updated);
            setRows(rs => rs.map(r => (r.id === updated.id ? updated : r)));
          }} />
      )}
    </div>
  );
}

function pageBtn(t) {
  return { background: t.surface2, border: `1px solid ${t.border}`, color: t.text2, borderRadius: 6,
    padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'Inter,sans-serif' };
}

// Row shows enough to identify a card WITHOUT loading the full sandboxed
// renderer (Phase K1) — plain-text-stripped preview of the sort field.
function CardRow({ card, t, onOpen }) {
  const preview = stripHtml(card.sort_field || card.fields?.[0] || '').slice(0, 90);
  return (
    <div onClick={onOpen} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 9,
      borderLeft: card.flag ? `4px solid ${FLAG_COLORS[card.flag]}` : `1px solid ${t.border}`,
      padding: '11px 14px', cursor: 'pointer', boxShadow: `0 1px 2px ${t.shadow}`,
      display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: STATE_COLOR[card.state] || t.text4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' }}>{preview || '(empty)'}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: t.text4, textTransform: 'capitalize' }}>{card.state}</span>
          {(card.tags || []).slice(0, 3).map(tg => (
            <span key={tg} style={{ fontSize: 10, color: t.text4, background: t.surface3,
              borderRadius: 8, padding: '1px 7px' }}>{tg}</span>
          ))}
          {card.due_at && <span style={{ fontSize: 10.5, color: t.text4 }}>
            due {new Date(card.due_at).toLocaleDateString()}
          </span>}
        </div>
      </div>
      <span style={{ fontSize: 13, color: t.text4, flexShrink: 0 }}>›</span>
    </div>
  );
}

function CardPreviewModal({ t, card, onClose, onFlagChange }) {
  const [noteModel, setNoteModel] = useState({ note: null, model: null });
  useEffect(() => {
    let cancelled = false;
    api.getNoteAndModel(card.note_id).then(nm => { if (!cancelled) setNoteModel(nm); }).catch(() => {});
    return () => { cancelled = true; };
  }, [card.note_id]);
  const { note, model } = noteModel;

  // Batch 6 fix: this preview used to hardcode resolvedMedia={{}}, so any
  // card with an image or audio reference always rendered the "missing
  // media" placeholder here even when the same card's media resolves fine
  // in the real study screen — same resolveMedia() call StudySession makes,
  // scoped by this card's own deck_id (see StudySession's own comment on
  // why: the endpoint walks up to the card's real root deck regardless of
  // which id it's given, so this is a no-op for an ordinary single-deck
  // browse and the actually-correct scoping for any future caller where it
  // isn't).
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
  const [revealed, setRevealed] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);
  const toggleFlag = async (f) => {
    if (flagBusy) return;
    const next = card.flag === f ? 0 : f;
    setFlagBusy(true);
    try {
      const updated = await api.setCardFlag(card.id, next);
      onFlagChange(updated);
    } catch { /* preview modal has no error slot — silently leave the flag unchanged */ }
    setFlagBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: t.overlay, zIndex: 250,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surface, borderRadius: 14, padding: 20,
        maxWidth: 520, width: '100%', boxShadow: `0 8px 32px ${t.shadowStrong}`, fontFamily: 'Inter,sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Card Preview</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.text3,
            cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, opacity: flagBusy ? 0.5 : 1 }}>
          <span style={{ fontSize: 11.5, color: t.text3, fontWeight: 600, marginRight: 1 }}>Flag:</span>
          {FLAGS.map(f => (
            <button key={f} onClick={() => toggleFlag(f)} disabled={flagBusy}
              title={card.flag === f ? `Clear flag (${FLAG_NAMES[f]})` : FLAG_NAMES[f]}
              style={{ width: 18, height: 18, borderRadius: '50%', background: FLAG_COLORS[f], padding: 0,
                border: card.flag === f ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>
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

function stripHtml(html) { return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
