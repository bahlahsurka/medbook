// components/ImportedDecks/StudySession.js
//
// Phase L — study flow using the EXISTING scheduler (lib/srs/Scheduler.js)
// and its buildSessionQuery() ordering. No second scheduler, no invented
// ordering, no manual interval math — every number shown comes from
// scheduler.previewIntervals() / rateCard() (which itself calls
// scheduler.calculateNextReview()).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';
import { scheduler } from '../../lib/srs/Scheduler';
import { useReviewKeyboard } from '../../lib/useReviewKeyboard';
import { FLAGS, FLAG_COLORS, FLAG_NAMES } from '../../lib/importedDecks/flags';
import CardRenderer, { cardMediaFilenames } from './CardRenderer';

const SESSION_KEY_PREFIX = 'medbook_imported_session_';

function loadSaved(deckId) {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY_PREFIX + deckId) || 'null'); }
  catch { return null; }
}
function saveSession(deckId, state) {
  try { sessionStorage.setItem(SESSION_KEY_PREFIX + deckId, JSON.stringify(state)); } catch {}
}
function clearSession(deckId) {
  try { sessionStorage.removeItem(SESSION_KEY_PREFIX + deckId); } catch {}
}

export default function StudySession({ deck, userId, onExit }) {
  const { t } = useTheme();
  const [queue, setQueue] = useState(null);   // null = loading
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resolvedMedia, setResolvedMedia] = useState({});
  const [rating, setRating] = useState(null); // in-flight rating, disables buttons briefly
  const [err, setErr] = useState('');
  // The single most recent rating, kept only until either another card is
  // rated or an undo consumes it — { snapshot: the card's full row exactly
  // as it was BEFORE that rating, idx: which position it was rated at }.
  // Undo is single-level, matching Anki's default Ctrl+Z: reverting one
  // rating doesn't chain further back than that.
  const [lastRated, setLastRated] = useState(null);
  const [undoing, setUndoing] = useState(false);

  // Load session — recover a saved position for this deck if one exists
  // (Phase L3: "if the user leaves and returns while a session is active,
  // recover the session state"), otherwise build a fresh queue.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr('');
      try {
        const saved = loadSaved(deck.id);
        const cards = await api.getSessionCards([deck.id], { limit: 50, userId });
        if (cancelled) return;
        setQueue(cards);
        // Only trust a saved index if the queue is still the same length —
        // a cheap sanity check against a queue that's since changed server-side.
        setIdx(saved && saved.total === cards.length ? Math.min(saved.idx, cards.length - 1) : 0);
      } catch (e) {
        if (!cancelled) { setErr(e.message || 'Could not load session cards'); setQueue([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [deck.id, userId]);

  useEffect(() => {
    if (queue === null || !queue.length) return;
    saveSession(deck.id, { idx, total: queue.length });
  }, [deck.id, idx, queue]);

  const card = queue?.[idx];

  // Note + model for the current card — never the whole deck's, one card
  // at a time. Async because the real path is a fetch (api.getNoteAndModel),
  // not a synchronous mock lookup.
  const [noteModel, setNoteModel] = useState({ note: null, model: null });
  useEffect(() => {
    if (!card) { setNoteModel({ note: null, model: null }); return; }
    let cancelled = false;
    api.getNoteAndModel(card.note_id)
      .then(nm => { if (!cancelled) setNoteModel(nm); })
      .catch(e => { if (!cancelled) { setErr(e.message || 'Could not load card content'); setNoteModel({ note: null, model: null }); } });
    return () => { cancelled = true; };
  }, [card]);
  const { note, model } = noteModel;

  // Resolve this card's media before rendering — never the whole deck's.
  useEffect(() => {
    if (!card || !note || !model) return;
    let cancelled = false;
    const filenames = cardMediaFilenames({ card, note, model });
    if (!filenames.length) { setResolvedMedia({}); return; }
    api.resolveMedia(deck.id, filenames).then(map => { if (!cancelled) setResolvedMedia(map); })
      .catch(() => { if (!cancelled) setResolvedMedia({}); });
    return () => { cancelled = true; };
  }, [card, note, model, deck.id]);

  const intervals = useMemo(() => card ? scheduler.previewIntervals(card) : null, [card]);

  const advance = useCallback(() => {
    setRevealed(false);
    setIdx(p => p + 1);
  }, []);

  const rate = async (label) => {
    if (!card || rating || undoing) return;
    const snapshot = card; // full row, exactly as it stood before this rating
    const ratedIdx = idx;
    setRating(label);
    try {
      await api.rateCard(card, label);
      setLastRated({ snapshot, idx: ratedIdx });
      advance();
    } catch (e) {
      setErr(e.message || 'Could not save rating');
    }
    setRating(null);
  };

  const undo = async () => {
    if (!lastRated || rating || undoing) return;
    setUndoing(true); setErr('');
    try {
      const restored = await api.undoRating(lastRated.snapshot.id, lastRated.snapshot);
      setQueue(q => { const next = [...q]; next[lastRated.idx] = restored; return next; });
      setIdx(lastRated.idx);
      setRevealed(false);
      setLastRated(null);
    } catch (e) {
      setErr(e.message || 'Could not undo');
    }
    setUndoing(false);
  };

  const exit = () => { clearSession(deck.id); onExit(); };
  const finishedNormally = () => { clearSession(deck.id); };

  // Toggling the SAME flag again clears it (0) — same convention Anki
  // itself uses, so "flag this card red" and "unflag it" are the same
  // action on the same button rather than needing a separate clear step.
  const [flagPickerOpen, setFlagPickerOpen] = useState(false);
  const setFlag = async (flag) => {
    if (!card) return;
    const next = card.flag === flag ? 0 : flag;
    setFlagPickerOpen(false);
    try {
      const updated = await api.setCardFlag(card.id, next);
      setQueue(q => { const copy = [...q]; copy[idx] = updated; return copy; });
    } catch (e) {
      setErr(e.message || 'Could not set flag');
    }
  };

  // Keyboard shortcuts (Phase L, previously entirely absent from this
  // screen): Space to flip, a/h/g/Enter to rate, ← to undo the last
  // rating. Called unconditionally, before any of the early returns below,
  // per the rules of hooks — `enabled` covers every state where acting on
  // a keypress wouldn't make sense (still loading, paused, no cards, or
  // the session's already finished).
  const activeCard = queue && idx < queue.length ? queue[idx] : null;
  useReviewKeyboard(!!activeCard && !paused, {
    flipped: revealed,
    onFlip: () => setRevealed(true),
    onAgain: () => rate('again'),
    onHard: () => rate('hard'),
    onGood: () => rate('good'),
    onEasy: () => rate('easy'),
    onPrev: lastRated ? undo : undefined,
  });

  // Close the flag popup whenever the card changes (advance, undo, or a
  // flag was just picked) — it should never carry over onto the next card.
  useEffect(() => { setFlagPickerOpen(false); }, [card?.id]);

  const B = (bg, color = '#fff') => ({ background: bg, color, border: 'none', borderRadius: 10,
    padding: '14px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' });

  if (queue === null) return (
    <div style={{ textAlign: 'center', paddingTop: 60, color: t.text4, fontFamily: 'Inter,sans-serif' }}>
      Loading session…
    </div>
  );

  if (paused) return (
    <div style={{ maxWidth: 420, margin: '80px auto 0', textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ fontSize: 34, marginBottom: 14 }}>⏸</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 6 }}>Session Paused</div>
      <div style={{ fontSize: 13, color: t.text3, marginBottom: 22 }}>
        Card {idx + 1} of {queue.length} — your place is saved.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={() => setPaused(false)} style={B(t.accent)}>▶ Resume</button>
        <button onClick={exit} style={B(t.surface3, t.text2)}>Exit Session</button>
      </div>
    </div>
  );

  if (!queue.length) return (
    <div style={{ maxWidth: 420, margin: '60px auto 0', textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
      <div style={{ fontSize: 15, color: t.text3, marginBottom: 20 }}>No cards are due in "{deck.display_name}" right now.</div>
      <button onClick={onExit} style={B(t.surface3, t.text2)}>← Back to Deck</button>
    </div>
  );

  if (idx >= queue.length) {
    finishedNormally();
    return (
      <div style={{ maxWidth: 420, margin: '60px auto 0', textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 6 }}>Session Complete</div>
        <div style={{ fontSize: 13, color: t.text3, marginBottom: 22 }}>
          You went through all {queue.length} cards in "{deck.display_name}".
        </div>
        <button onClick={onExit} style={{ ...B(t.accent) }}>← Back to Deck</button>
      </div>
    );
  }

  return (
    // Mobile/tablet-first (Phase L4): safe-area padding, large tap targets
    // on the rating row, single-column layout that doesn't rely on a wide
    // viewport, no hover-only affordances.
    <div style={{ maxWidth: 560, margin: '0 auto', fontFamily: 'Inter,sans-serif',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={() => setPaused(true)} style={{ background: 'none', border: 'none',
            color: t.text3, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 4px 6px 0' }}>
            ⏸ Pause
          </button>
          <button onClick={() => setFlagPickerOpen(o => !o)} title={card.flag ? `Flagged: ${FLAG_NAMES[card.flag]}` : 'Flag this card'}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 15, padding: '6px 4px', color: t.text3,
              opacity: flagPickerOpen || card.flag ? 1 : 0.7 }}>
            {/* 🚩 is a fixed-color emoji glyph — CSS `color` can't tint it, so
                the current flag color is shown as a separate dot instead. */}
            🚩{card.flag > 0 && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: FLAG_COLORS[card.flag] }} />
            )}
          </button>
        </div>
        <span style={{ fontSize: 13, color: t.text3, fontWeight: 600 }}>{idx + 1} / {queue.length}</span>
        <button onClick={exit} style={{ background: 'none', border: 'none',
          color: t.text3, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '6px 0' }}>
          ✕ Exit
        </button>
      </div>

      {flagPickerOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '8px 10px', background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: t.text3, fontWeight: 600 }}>Flag:</span>
          {FLAGS.map(f => (
            <button key={f} onClick={() => setFlag(f)} title={card.flag === f ? `Clear flag (${FLAG_NAMES[f]})` : FLAG_NAMES[f]}
              style={{ width: 20, height: 20, borderRadius: '50%', background: FLAG_COLORS[f], padding: 0,
                border: card.flag === f ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />
          ))}
          <button onClick={() => setFlagPickerOpen(false)} style={{ marginLeft: 'auto', background: 'none',
            border: 'none', color: t.text3, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Close
          </button>
        </div>
      )}

      <div style={{ height: 4, background: t.surface3, borderRadius: 4, marginBottom: 16 }}>
        <div style={{ height: '100%', background: t.accent, borderRadius: 4,
          width: `${(idx / queue.length) * 100}%`, transition: 'width .3s' }} />
      </div>

      {lastRated && (
        <button onClick={undo} disabled={undoing} style={{ display: 'flex', alignItems: 'center', gap: 6,
          background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text2,
          cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 12px', marginBottom: 12,
          fontFamily: 'Inter,sans-serif', opacity: undoing ? 0.6 : 1 }}>
          ↶ {undoing ? 'Undoing…' : 'Undo last rating'} <span style={{ opacity: 0.6, fontWeight: 400 }}>(←)</span>
        </button>
      )}

      {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 12 }}>{err}</div>}

      {card && note && model && (
        <div style={card.flag ? { borderLeft: `4px solid ${FLAG_COLORS[card.flag]}`, borderRadius: 4, paddingLeft: 10 } : undefined}>
          <CardRenderer card={card} note={note} model={model} resolvedMedia={resolvedMedia} revealed={revealed} />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {!revealed ? (
          // Large single tap target — the primary touch action (Phase L4).
          <button onClick={() => setRevealed(true)} style={{ ...B(t.accent), width: '100%', padding: '16px 10px', fontSize: 15 }}>
            Show Answer
          </button>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              ['again', 'Again', '#dc2626'],
              ['hard', 'Hard', '#d97706'],
              ['good', 'Good', '#16a34a'],
              ['easy', 'Easy', '#2563eb'],
            ].map(([key, label, color]) => (
              <button key={key} onClick={() => rate(key)} disabled={!!rating || undoing}
                style={{ ...B(color), opacity: (rating && rating !== key) || undoing ? 0.5 : 1,
                  display: 'flex', flexDirection: 'column', gap: 4, minHeight: 58 }}>
                <span>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.9 }}>{intervals?.[key]?.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
