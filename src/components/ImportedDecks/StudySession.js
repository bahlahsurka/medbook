// components/ImportedDecks/StudySession.js
//
// Phase L — study flow using the EXISTING scheduler (lib/srs/Scheduler.js)
// and its buildSessionQuery() ordering. No second scheduler, no invented
// ordering, no manual interval math — every number shown comes from
// scheduler.previewIntervals() / rateCard() (which itself calls
// scheduler.calculateNextReview()).

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';
import { scheduler } from '../../lib/srs/Scheduler';
import { useReviewKeyboard } from '../../lib/useReviewKeyboard';
import { FLAGS, FLAG_COLORS, FLAG_NAMES } from '../../lib/importedDecks/flags';
import { IconChevronLeft, IconPause, IconX, IconMaximize, IconMinimize, IconSearch } from '../../lib/icons';
import CardRenderer, { cardMediaFilenames, cardSideImages } from './CardRenderer';

// Rating strip — name first, interval (t.tokenKey) secondary. Theme tokens,
// not hardcoded hex: identical to the old hardcoded values in light mode
// (t.danger/t.warn/t.ok/t.accent === the old #dc2626/#d97706/#16a34a/
// #2563eb exactly), but properly softened in dark mode instead of blasting
// the same light-mode saturated hex onto a dark background.
const RATINGS = [
  ['again', 'Again', 'danger'],
  ['hard', 'Hard', 'warn'],
  ['good', 'Good', 'ok'],
  ['easy', 'Easy', 'accent'],
];

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

  // Batch 2 — Focus Mode: hides everything but the minimum needed to get
  // back out (plus the image-expand affordance, if the card has one), so
  // the card itself gets nearly the whole viewport for studying and
  // screenshotting. It only ever hides/shrinks chrome that's already on
  // this screen — no new navigation system, no separate route/screen.
  const [focusMode, setFocusMode] = useState(false);
  // Image lightbox — the enlarged-image URL currently showing, or null.
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // The toolbar renders via a portal into App.js's OWN persistent header bar
  // (#mb-study-toolbar-slot — see its comment there) instead of a second
  // row inside this screen, so a study session reuses chrome that's
  // already on screen rather than adding more. That div is a sibling
  // rendered earlier in the same tree, so it already exists in the DOM by
  // the time this component's own render runs — but `document.getElementById`
  // still needs an effect (not a render-time call) to be safe against
  // React strict-mode's double-render and any future change to render
  // order; null on the very first paint just means the toolbar portal
  // doesn't render that one frame, not that it's ever stuck missing.
  const [headerSlot, setHeaderSlot] = useState(null);
  useEffect(() => { setHeaderSlot(document.getElementById('mb-study-toolbar-slot')); }, []);

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

  // Batch 2 — image expansion. Which resolved image (if any) is visible on
  // the currently-shown side of the card, for the "expand image" toolbar
  // icon. See cardSideImages()'s own comment for why this can't just be
  // "whichever image was tapped" — the sandboxed iframe has no channel to
  // tell the parent that.
  const sideImages = useMemo(
    () => (card && note && model) ? cardSideImages({ card, note, model, resolvedMedia, revealed }) : [],
    [card, note, model, resolvedMedia, revealed]
  );

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
  // cards, or the session's already finished). Deliberately NOT gated on
  // focusMode — Focus Mode only hides/shrinks buttons, it doesn't change
  // what the screen can do, so keyboard-driven studying keeps working
  // exactly as before while it's on. It IS gated on the lightbox, per this
  // hook's own doc comment ("disabled while a modal like the image
  // lightbox is open on top of it") — otherwise "a" while just looking at
  // an enlarged image would silently rate the card underneath it.
  const activeCard = queue && idx < queue.length ? queue[idx] : null;
  useReviewKeyboard(!!activeCard && !paused && !lightboxSrc, {
    flipped: revealed,
    onFlip: () => setRevealed(true),
    onAgain: () => rate('again'),
    onHard: () => rate('hard'),
    onGood: () => rate('good'),
    onEasy: () => rate('easy'),
    onPrev: idx > 0 ? goPrev : undefined,
  });

  // Close the flag popup and any open image lightbox whenever the card
  // changes (advance, going back, or a flag was just picked) — neither
  // should ever carry over onto the next card.
  useEffect(() => { setFlagPickerOpen(false); setLightboxSrc(null); }, [card?.id]);

  // Escape is the fallback "get me out" key for both the lightbox and
  // Focus Mode — on top of the explicit close/exit buttons each already
  // has. Lightbox takes priority when both are open (it's the topmost
  // layer). A plain window listener, not useReviewKeyboard: Escape isn't a
  // review action, and this needs to keep working even while the lightbox
  // has that hook disabled.
  useEffect(() => {
    if (!lightboxSrc && !focusMode) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (lightboxSrc) setLightboxSrc(null);
      else setFocusMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxSrc, focusMode]);

  // Focus Mode hides the flag button entirely, so an open flag picker
  // would otherwise be stranded on screen with no way to see what opened it.
  useEffect(() => { if (focusMode) setFlagPickerOpen(false); }, [focusMode]);

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

  // Small, consistently-sized icon tiles — restrained background + subtle
  // border, not a pill — matching ReviewQueue.js's own toolbar-button
  // treatment (same brightness-filter hover/active trick, reused verbatim
  // below for both themes) rather than inventing a second convention.
  const iconBtnStyle = (extra = {}) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34, flexShrink: 0, padding: 0,
    background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 8,
    color: t.text3, cursor: 'pointer', ...extra,
  });

  return (
    // Study canvas: the toolbar/progress-bar/rating-row are all trimmed to
    // their minimum comfortable size specifically so the card gets the
    // majority of the viewport — see the width/height comments below for
    // the two axes that make that concrete, and the .mb-ss-root media rule
    // for the tablet-landscape width bump.
    //
    // Fills exactly the vertical room this screen was actually measured to
    // have (see availHeight/measureHeight above) instead of sizing the card
    // off a fixed vh guess independent of the header/buttons around it. A
    // vh cap either clipped a long card early or, on a short one, left a
    // dead gap below the rating buttons — both symptoms of the card's size
    // not actually being tied to the space it had to work with.
    <div ref={setRootRef} className="mb-ss-root" style={{ marginLeft: 'auto', marginRight: 'auto', fontFamily: 'Inter,sans-serif',
      height: availHeight != null ? availHeight : undefined, display: 'flex', flexDirection: 'column',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <style>{`
        .mb-ss-root { max-width: 1100px; }
        /* Pull the screen up flush against the app header, cancelling the
           shared content area's own top padding (App.js: 20px desktop /
           14px <=768px) instead of just leaving it as dead space above the
           toolbar. Scoped to this one screen via negative margin — not a
           change to that shared padding, which every other screen still
           uses as-is. (Set here, not in the inline style object above:
           inline styles always beat a CSS class for the same property, so
           an inline marginTop would silently block this — same reason
           max-width lives in CSS too, a few lines up.) The header's own
           border-bottom already reads as the section divider, so landing
           flush under it looks deliberate rather than cramped. */
        .mb-ss-root { margin-top: -20px; }
        @media (max-width: 768px) {
          .mb-ss-root { margin-top: -14px; }
        }
        /* Tablet landscape (the primary device) — let the card actually use
           the wide viewport instead of capping at the same width as portrait. */
        @media (min-width: 900px) and (orientation: landscape) {
          .mb-ss-root { max-width: 1500px; }
        }
        .mb-ss-iconbtn { transition: filter .12s ease, transform .12s ease, background-color .12s ease; }
        .mb-ss-iconbtn:hover:not(:disabled) { filter: brightness(0.97); }
        body.medbook-dark .mb-ss-iconbtn:hover:not(:disabled) { filter: brightness(1.25); }
        .mb-ss-iconbtn:active:not(:disabled) { transform: scale(0.93); }
        .mb-ss-ratebtn { transition: filter .12s ease; }
        .mb-ss-ratebtn:active:not(:disabled) { filter: brightness(0.92); }
        .mb-ss-showanswer { transition: filter .12s ease, transform .12s ease; }
        .mb-ss-showanswer:hover { filter: brightness(1.04); }
        .mb-ss-showanswer:active { transform: scale(0.99); }
        /* Batch 2 — Focus Mode's own entrance/exit is the one "mode
           transition" in this screen; animating just this one collapsing
           strip (rather than every element that swaps) is what keeps it
           "extremely subtle" instead of turning into a layout shuffle. */
        .mb-ss-progress-wrap { transition: max-height .2s ease, opacity .15s ease, margin-bottom .2s ease; overflow: hidden; }
        .mb-ss-lightbox { animation: mb-ss-lightbox-in .15s ease; }
        @keyframes mb-ss-lightbox-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .mb-ss-iconbtn, .mb-ss-ratebtn, .mb-ss-showanswer, .mb-ss-progress-wrap { transition: none !important; }
          .mb-ss-lightbox { animation: none !important; }
        }
      `}</style>

      {/* Quiet toolbar — icon-only, consistent 34px tiles, restrained
          background/border rather than large standalone buttons. Progress
          stays plainly readable text; Exit stays visually distinct (an X,
          not just another tile) so it's never mistaken for a study action.
          In Focus Mode this row collapses to just the handful of controls
          that still make sense with the chrome minimized — everything else
          (Previous/Pause/Flag/progress/session-exit) is one tap away behind
          the un-focus button, not gone.
          Portaled into App.js's own header bar (#mb-study-toolbar-slot)
          instead of taking a row of its own here — that row is already on
          screen for every view, "Flashcards" just leaves most of it empty,
          so a study session reuses it rather than adding a second one. */}
      {headerSlot && createPortal(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1, minWidth: 0 }}>
        {focusMode ? (
          <>
            <div />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {sideImages.length > 0 && (
                <button className="mb-ss-iconbtn" onClick={() => setLightboxSrc(sideImages[0])}
                  title="Expand image" aria-label="Expand image" style={iconBtnStyle()}>
                  <IconSearch size={14} />
                </button>
              )}
              <button className="mb-ss-iconbtn" onClick={() => setFocusMode(false)}
                title="Exit Focus Mode (Esc)" aria-label="Exit Focus Mode" style={iconBtnStyle()}>
                <IconMinimize size={14} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="mb-ss-iconbtn" onClick={goPrev} disabled={idx === 0}
                title="Previous card" aria-label="Previous card"
                style={iconBtnStyle({ opacity: idx === 0 ? 0.4 : 1, cursor: idx === 0 ? 'default' : 'pointer' })}>
                <IconChevronLeft size={16} />
              </button>
              <button className="mb-ss-iconbtn" onClick={() => setPaused(true)}
                title="Pause session" aria-label="Pause session" style={iconBtnStyle()}>
                <IconPause size={13} />
              </button>
              <button className="mb-ss-iconbtn" onClick={() => setFlagPickerOpen(o => !o)}
                title={card.flag ? `Flagged: ${FLAG_NAMES[card.flag]}` : 'Flag this card'} aria-label="Flag this card"
                style={iconBtnStyle({ background: flagPickerOpen ? t.surface3 : t.surface2 })}>
                {/* 🚩 is a fixed-color emoji glyph — CSS `color` can't tint it, so
                    the current flag color is shown as a separate dot instead. */}
                <span style={{ position: 'relative', fontSize: 14, lineHeight: 1 }}>
                  🚩
                  {card.flag > 0 && (
                    <span style={{ position: 'absolute', right: -3, bottom: -2, width: 6, height: 6,
                      borderRadius: '50%', background: FLAG_COLORS[card.flag], border: `1px solid ${t.surface2}` }} />
                  )}
                </span>
              </button>
            </div>
            <span style={{ fontSize: 13, color: t.text3, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {idx + 1} / {queue.length}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {sideImages.length > 0 && (
                <button className="mb-ss-iconbtn" onClick={() => setLightboxSrc(sideImages[0])}
                  title="Expand image" aria-label="Expand image" style={iconBtnStyle()}>
                  <IconSearch size={14} />
                </button>
              )}
              <button className="mb-ss-iconbtn" onClick={() => setFocusMode(true)}
                title="Focus Mode" aria-label="Enter Focus Mode" style={iconBtnStyle()}>
                <IconMaximize size={14} />
              </button>
              <button className="mb-ss-iconbtn" onClick={exit} title="Exit session" aria-label="Exit session" style={iconBtnStyle()}>
                <IconX size={15} />
              </button>
            </div>
          </>
        )}
        </div>,
        headerSlot
      )}

      {flagPickerOpen && !focusMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0,
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

      {/* Reclaimed (collapsed to 0) in Focus Mode, animated via
          .mb-ss-progress-wrap rather than just conditionally rendering it,
          so the card growing to fill the space reads as one smooth motion
          instead of a jump cut. */}
      <div className="mb-ss-progress-wrap" style={{ maxHeight: focusMode ? 0 : 13, opacity: focusMode ? 0 : 1, marginBottom: focusMode ? 0 : 10, flexShrink: 0 }}>
        <div style={{ height: 3, background: t.surface3, borderRadius: 3 }}>
          <div style={{ height: '100%', background: t.accent, borderRadius: 3,
            width: `${(idx / queue.length) * 100}%`, transition: 'width .25s ease' }} />
        </div>
      </div>

      {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 10, flexShrink: 0 }}>{err}</div>}

      {card && note && model && (
        // flex:1 + minHeight:0 is what actually lets this claim the leftover
        // space instead of just sizing to its own content — minHeight:0
        // overrides a flex item's default "never shrink below content size",
        // which is what was fighting the fixed vh cap before. This is the
        // hero of the screen — everything above/below it is trimmed
        // specifically so this gets the majority of the viewport.
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          ...(card.flag ? { borderLeft: `4px solid ${FLAG_COLORS[card.flag]}`, borderRadius: 4, paddingLeft: 10 } : {}) }}>
          <CardRenderer card={card} note={note} model={model} resolvedMedia={resolvedMedia} revealed={revealed} fill />
        </div>
      )}

      <div style={{ marginTop: 10, flexShrink: 0 }}>
        {!revealed ? (
          // Large single tap target — the primary touch action (Phase L4).
          <button onClick={() => setRevealed(true)} className="mb-ss-showanswer" style={{
            width: '100%', background: t.accent, color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 10px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter,sans-serif' }}>
            Show Answer
          </button>
        ) : (
          // One cohesive rating strip — a shared rounded container with a
          // hairline divider between segments, not four separately-rounded
          // buttons with gaps between them. Name is the primary label;
          // the interval sits underneath, smaller and dimmer — secondary
          // information, per the brief.
          <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', boxShadow: `0 1px 3px ${t.shadow}` }}>
            {RATINGS.map(([key, label, tokenKey], i) => (
              <button key={key} className="mb-ss-ratebtn" onClick={() => rate(key)} disabled={!!rating}
                style={{
                  flex: 1, minHeight: 54, padding: '10px 6px',
                  // A touch softer than the raw token — blended toward the
                  // card's own surface rather than a hardcoded new hex, so
                  // it stays theme-correct (and restrained) in both modes.
                  background: `color-mix(in srgb, ${t[tokenKey]} 90%, ${t.surface})`,
                  color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif',
                  borderRight: i < RATINGS.length - 1 ? '1px solid rgba(255,255,255,0.22)' : 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  opacity: (rating && rating !== key) ? 0.5 : 1,
                }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.78 }}>{intervals?.[key]?.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Image expansion — see cardSideImages()'s comment for why this is a
          card-level "expand" affordance rather than a tap directly on the
          image inside the iframe. Sits outside the toolbar's normal flow
          when open (position:fixed covers the viewport regardless of this
          div's own max-width), so it never competes with or covers the
          card itself — the card isn't even visible underneath it. */}
      {lightboxSrc && (
        <div className="mb-ss-lightbox" onClick={() => setLightboxSrc(null)} role="dialog" aria-modal="true"
          aria-label="Enlarged image" style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
            padding: 'max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px))',
          }}>
          <button className="mb-ss-iconbtn" onClick={() => setLightboxSrc(null)} title="Close" aria-label="Close enlarged image"
            style={iconBtnStyle({ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)', color: '#fff' })}>
            <IconX size={16} />
          </button>
          <img src={lightboxSrc} alt="" onClick={(e) => e.stopPropagation()} style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6,
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)', cursor: 'default',
          }} />
        </div>
      )}
    </div>
  );
}
