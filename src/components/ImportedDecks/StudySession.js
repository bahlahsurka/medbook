// components/ImportedDecks/StudySession.js
//
// Phase L — study flow using the EXISTING scheduler (lib/srs/Scheduler.js)
// and its buildSessionQuery() ordering. No second scheduler, no invented
// ordering, no manual interval math — every number shown comes from
// scheduler.previewIntervals() / rateCard() (which itself calls
// scheduler.calculateNextReview()).

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
    if (!card || rating) return;
    const ratedIdx = idx;
    setRating(label);
    try {
      const updated = await api.rateCard(card, label);
      // Same reason ReviewQueue.js keeps its cards array live after rating:
      // ← lets you step back to this card and rate it again, and a re-rating
      // has to act on the card's CURRENT (post-rating) scheduling state, not
      // the stale pre-rating snapshot still sitting in the queue array.
      setQueue(q => { const next = [...q]; next[ratedIdx] = updated; return next; });
      advance();
    } catch (e) {
      setErr(e.message || 'Could not save rating');
    }
    setRating(null);
  };

  // Step back to the previous card — same behavior as ReviewQueue's ←
  // (goPrev): plain navigation, not a scheduling revert. Deliberately
  // doesn't touch anything a rating wrote; re-rating a revisited card works
  // exactly like rating any other card (see the comment in rate() above).
  const goPrev = () => {
    if (idx === 0) return;
    setIdx(p => p - 1);
    setRevealed(false);
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

  // Keyboard shortcuts — same hook, same bindings, same ← semantics as
  // ReviewQueue.js (the main app's review screen): Space to flip, a/h/g/Enter
  // to rate, ← for plain "previous card" navigation (not gated on having
  // just rated). Called unconditionally, before any of the early returns
  // below, per the rules of hooks — `enabled` covers every state where
  // acting on a keypress wouldn't make sense (still loading, paused, no
  // cards, or the session's already finished).
  const activeCard = queue && idx < queue.length ? queue[idx] : null;
  useReviewKeyboard(!!activeCard && !paused, {
    flipped: revealed,
    onFlip: () => setRevealed(true),
    onAgain: () => rate('again'),
    onHard: () => rate('hard'),
    onGood: () => rate('good'),
    onEasy: () => rate('easy'),
    onPrev: idx > 0 ? goPrev : undefined,
  });

  // Close the flag popup whenever the card changes (advance, going back, or
  // a flag was just picked) — it should never carry over onto the next card.
  useEffect(() => { setFlagPickerOpen(false); }, [card?.id]);

  // How much real vertical room this screen actually has — measured, not
  // guessed. height:'100%' looked like it should work (App.js's own shell
  // IS a definite-height flex chain all the way down), but there's one
  // plain, non-flex `<div key={view}>` wrapper in between (App.js's
  // per-destination fade-in wrapper) that resets to auto height, which
  // breaks CSS percentage-height resolution for every view rendered inside
  // it — not just this one, and not something to "fix" by changing that
  // shared wrapper for every other screen that relies on its auto sizing.
  // Measuring via getBoundingClientRect().top sidesteps that break
  // entirely: it doesn't care how many auto-height ancestors sit above it.
  const [availHeight, setAvailHeight] = useState(null);
  const rootRef = useRef(null);
  const measureHeight = useCallback((node) => {
    const el = node || rootRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    // 20px matches the app shell's own bottom padding on desktop — a
    // small, deliberately generous buffer so nothing touches the very
    // edge of the window; harmless if it's a couple px off on mobile.
    setAvailHeight(Math.max(360, window.innerHeight - top - 20));
  }, []);
  const setRootRef = useCallback((node) => { rootRef.current = node; measureHeight(node); }, [measureHeight]);
  useEffect(() => {
    const onResize = () => measureHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureHeight]);

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
    // viewport, no hover-only affordances. The 560px cap from the original
    // pass made the card itself tiny on anything wider than a phone —
    // unreadable at a glance and useless for screenshotting content/media,
    // the exact complaint this raised it to fix — so this now stretches
    // much wider (still capped, not edge-to-edge sprawl on an ultrawide
    // monitor) while staying just as narrow as before on an actual phone,
    // since maxWidth is only ever a ceiling.
    // Fills exactly the vertical room this screen was actually measured to
    // have (see availHeight/measureHeight above) instead of sizing the card
    // off a fixed vh guess independent of the header/buttons around it. A
    // vh cap either clipped a long card early or, on a short one, left a
    // dead gap below the rating buttons — both symptoms of the card's size
    // not actually being tied to the space it had to work with.
    <div ref={setRootRef} style={{ maxWidth: 1100, margin: '0 auto', fontFamily: 'Inter,sans-serif',
      height: availHeight != null ? availHeight : undefined, display: 'flex', flexDirection: 'column',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Always-visible "previous card" button, disabled at idx 0 — same
              placement/behavior as ReviewQueue.js's ← button, not a
              conditional pill that only appears right after rating. */}
          <button onClick={goPrev} disabled={idx === 0} title="Previous card" aria-label="Previous card"
            style={{ background: 'none', border: 'none', color: t.text3, fontSize: 13, fontWeight: 600,
              padding: '6px 4px 6px 0', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.4 : 1 }}>
            ← <span style={{ opacity: 0.6, fontWeight: 400 }}>Prev</span>
          </button>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0,
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

      <div style={{ height: 4, background: t.surface3, borderRadius: 4, marginBottom: 16, flexShrink: 0 }}>
        <div style={{ height: '100%', background: t.accent, borderRadius: 4,
          width: `${(idx / queue.length) * 100}%`, transition: 'width .3s' }} />
      </div>

      {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 12, flexShrink: 0 }}>{err}</div>}

      {card && note && model && (
        // flex:1 + minHeight:0 is what actually lets this claim the leftover
        // space instead of just sizing to its own content — minHeight:0
        // overrides a flex item's default "never shrink below content size",
        // which is what was fighting the fixed vh cap before.
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          ...(card.flag ? { borderLeft: `4px solid ${FLAG_COLORS[card.flag]}`, borderRadius: 4, paddingLeft: 10 } : {}) }}>
          <CardRenderer card={card} note={note} model={model} resolvedMedia={resolvedMedia} revealed={revealed} fill />
        </div>
      )}

      <div style={{ marginTop: 16, flexShrink: 0 }}>
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
              <button key={key} onClick={() => rate(key)} disabled={!!rating}
                style={{ ...B(color), opacity: (rating && rating !== key) ? 0.5 : 1,
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
