// components/ImportedDecks/StudySession.js
//
// Phase L — study flow using the EXISTING scheduler (lib/srs/Scheduler.js)
// and its buildSessionQuery() ordering. No second scheduler, no invented
// ordering, no manual interval math — every number shown comes from
// scheduler.previewIntervals() / rateCard() (which itself calls
// scheduler.calculateNextReview()).
//
// ── Critical Bug Fix Batch 1 — resumable sessions ──────────────────────
// Root cause of "reopening a deck shuffles the cards and starts over":
// this component used to call api.getSessionCards()/getFavoriteCards()
// fresh on every mount, and only sanity-checked a saved position by
// ARRAY LENGTH (`saved.total === cards.length`) before trusting it — never
// verifying the freshly-fetched cards were even the SAME cards. But
// getSessionCards() isn't stable across repeated calls: its "new" portion
// has no ORDER BY, and its "due" portion depends on the current wall-clock
// time and today's already-studied counts, both of which drift between
// calls. So a saved idx could — and did — end up pointing at a different
// card than the one the user was actually looking at, on ANY remount
// (reopening the deck, or a mobile browser discarding/recreating the tab
// on backgrounding — see studySessionStore.js's own comment for why that
// specific case matters and why localStorage, not sessionStorage, is used).
//
// Fix: once a session is created, its card ORDER is frozen (persisted as
// an id list, via studySessionStore.js) and never rebuilt on remount.
// Resuming re-fetches CURRENT row data for exactly those ids
// (api.getCardsByIds) instead of re-running the query that chose them.
//
// ── Critical Bug Fix Batch 2 — Previous actually undoes the rating ─────
// Root cause: goPrev() used to be `setIdx(p => p - 1)` and nothing else —
// pure UI navigation with zero awareness that rating a card had already
// written a permanent scheduling change (a card row UPDATE plus an
// imported_review_log INSERT, both already committed by the time Previous
// could even be pressed). Pressing Previous then rating the same card
// again computed the new interval from the ALREADY-rated state — Good
// (0d->3d) then Previous then Good again would compute the second Good
// from a 3-day-old interval instead of the original 0, compounding
// instead of replacing.
//
// Fix: rate() snapshots the card's exact pre-rating scheduling fields
// before calling rateCard, and records `{previousState, rating,
// ratedAtIso}` keyed by card id in `actions` — the ONLY state this needs
// beyond what Batch 1 already persists, so it's added to that same
// session snapshot rather than a second, incompatible history mechanism.
// goPrev() checks `actions` for the card it's returning to: if that card
// has an undo-able current-session rating, it calls api.unrateCard to
// restore the card row to `previousState` field-for-field (a plain write,
// not a recomputation — it can't itself produce a wrong interval) and
// delete ONLY that rating's own imported_review_log row (matched by
// card_id + its exact reviewed_at timestamp, never a broader match that
// could reach into legitimate history from before this session). If the
// returned-to card has NO recorded action (never rated, or already
// undone), Previous is exactly the old plain index decrement — no undo
// work, no added latency.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';
import * as favoritesApi from '../../lib/importedDecks/favorites';
import { scheduler } from '../../lib/srs/Scheduler';
import { useReviewKeyboard } from '../../lib/useReviewKeyboard';
import { FLAGS, FLAG_COLORS, FLAG_NAMES } from '../../lib/importedDecks/flags';
import { IconChevronLeft, IconPause, IconX, IconMaximize, IconMinimize, IconSearch, IconStar } from '../../lib/icons';
import CardRenderer, { cardMediaFilenames, cardSideImages } from './CardRenderer';
import { deckKeyFor, newSessionId, loadSession, saveSession, clearSession } from '../../lib/importedDecks/studySessionStore';

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

export default function StudySession({ deck, userId, onExit }) {
  const { t } = useTheme();
  const [queue, setQueue] = useState(null);   // null = loading
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resolvedMedia, setResolvedMedia] = useState({});
  const [rating, setRating] = useState(null); // in-flight rating, disables buttons briefly
  const [err, setErr] = useState('');

  // Batch 4 — favorite state for the WHOLE session, loaded once as a Set
  // (favoritesApi.getFavoriteCardIds), not one request per card — exactly
  // the bulk-read that module's own doc comment says it exists for. The
  // toggle below is the optimistic-UI layer favorites.js deliberately
  // leaves to its caller: flip the local Set immediately so the star
  // reacts the instant it's tapped, persist in the background, and put
  // the Set back exactly as it was — never just "off" — if the write
  // fails, surfacing a concise error instead of silently losing the tap.
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  useEffect(() => {
    let cancelled = false;
    favoritesApi.getFavoriteCardIds(userId).then(ids => { if (!cancelled) setFavoriteIds(ids); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

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

  // deck.id/isFavorites/onlyCardId together identify WHICH study target
  // this is — stable for the component's whole mount (a different target
  // means a different `deck` prop, which unmounts and remounts this
  // component entirely, per FlashCards.js's own key/prop wiring). Plain
  // const, not memoized: deckKeyFor() is a cheap string computation, not
  // worth useMemo's own bookkeeping.
  const deckKey = deckKeyFor(deck);

  // Any session previously saved for this exact target — read ONCE, at
  // mount, via a lazy useState initializer (not an effect: this has to be
  // known synchronously on the very first render, so the resume prompt
  // below can show immediately with no loading flash first). It never
  // changes for the life of this mount, which is also why it's safe to
  // reference from the effect below without listing it as a dependency —
  // same reasoning as DeckBrowser's own mount-time-only effect.
  const [pendingResume] = useState(() => loadSession(userId, deckKey));
  // Batch 4 — `deck.isFavorites` is how "Study Favorites" reuses this exact
  // component instead of a second study-session implementation: a virtual
  // deck-shaped object (see FAVORITES_DECK in FlashCards.js), not a real
  // imported_decks row, that swaps WHERE the queue comes from and nothing
  // else — the rest of this component (rating, flagging, Focus Mode, the
  // image lightbox, keyboard shortcuts) doesn't know or care where its
  // cards came from. `deck.onlyCardId`, set alongside it for a single
  // favorited card's own "Study" action, filters that same fetch down to
  // one card — still the real queue/advance/rate machinery below, not a
  // special-cased single-card mode.
  //
  // `resumeChoice` starts already resolved (no prompt) UNLESS there's
  // actual progress worth asking the user about — a saved session that
  // never got past card 1 has nothing meaningful to choose between
  // "resume" and "start new" for, so it's just silently reused/extended
  // rather than interrupting the user with a pointless prompt every time
  // Study is opened. See the render-time early return below for the
  // prompt itself.
  const [resumeChoice, setResumeChoice] = useState(() => (
    pendingResume && pendingResume.idx > 0 && Array.isArray(pendingResume.cardIds) && pendingResume.cardIds.length
      ? null
      : (pendingResume ? 'resume' : 'new')
  ));
  const sessionIdRef = useRef(null);
  const createdAtRef = useRef(null);

  // Critical Bug Fix Batch 2 — undo history for Previous. Keyed by card id
  // (not queue index: the frozen order makes them equivalent, but the id
  // is what actually identifies "this card's most recent current-session
  // rating," which is the thing being undone). Only ever holds an entry
  // for a card that has an UNDO-ABLE rating outstanding — rate() adds one
  // on success, goPrev() removes it once undone, and re-rating an already-
  // undone card overwrites it fresh rather than stacking. Persisted as
  // part of the session snapshot (below) — see this file's header comment
  // on why: Previous has to keep working after a reload, same as the rest
  // of session state does since Batch 1.
  const [actions, setActions] = useState({}); // { [cardId]: { previousState, rating, ratedAtIso } }
  // Live imported_review_log insert promises, keyed by card id —
  // deliberately NOT persisted (promises aren't serializable, and by the
  // time a session is ever resumed, real wall-clock time has passed and
  // the original insert is guaranteed to have already settled either way,
  // per unrateCard's own comment). Only matters for the same-mount case:
  // rate a card, then hit Previous before the fire-and-forget insert from
  // THAT rating has necessarily landed yet.
  const logInsertsRef = useRef({});
  // True while an undo (the async half of goPrev) is in flight — disables
  // Previous and the rating buttons so a second action can't land on top
  // of a restore that hasn't finished yet ("prevent the user from
  // accidentally applying another rating on corrupted state").
  const [restoring, setRestoring] = useState(false);

  // Load session — RESUME re-fetches current row data for the FROZEN set
  // of card ids a previous session already chose (never re-running
  // getSessionCards/getFavoriteCards, which is exactly what was producing
  // a different card set on every remount — see this file's own header
  // comment). NEW builds a fresh queue exactly as before and immediately
  // establishes a session identity for it, so the very next remount — even
  // one caused by a mobile browser discarding the tab mid-session — has
  // something to resume into instead of starting from nothing again.
  useEffect(() => {
    if (resumeChoice === null) return; // waiting on the user's resume/start-new choice
    let cancelled = false;
    (async () => {
      setErr('');
      try {
        if (resumeChoice === 'resume' && pendingResume) {
          sessionIdRef.current = pendingResume.sessionId || newSessionId();
          createdAtRef.current = pendingResume.createdAt || pendingResume.lastActiveAt || new Date().toISOString();
          const rows = await api.getCardsByIds(pendingResume.cardIds);
          if (cancelled) return;
          const byId = new Map(rows.map(r => [r.id, r]));
          // Reassemble in the FROZEN order, dropping any id that no longer
          // exists (deleted/reset since) rather than erroring on it.
          const ordered = pendingResume.cardIds.map(id => byId.get(id)).filter(Boolean);
          setQueue(ordered);
          let restoredIdx = Math.min(pendingResume.idx || 0, Math.max(0, ordered.length - 1));
          // Duplicate-review guard — see the file header comment and
          // rate()'s own doc comment for the exact race this covers: a
          // rating whose write reached the server but whose response
          // never reached the client before an interruption. Detected via
          // last_reviewed_at moving past this session's own last
          // confirmed activity — not a new column, just the same field
          // getSessionCards' daily-cap query already reads.
          const atSavedIdx = ordered[restoredIdx];
          if (atSavedIdx?.last_reviewed_at && pendingResume.lastActiveAt
              && new Date(atSavedIdx.last_reviewed_at) > new Date(pendingResume.lastActiveAt)) {
            restoredIdx += 1;
          }
          setIdx(restoredIdx);
          setPaused(!!pendingResume.paused);
          setActions(pendingResume.actions || {});
        } else {
          sessionIdRef.current = newSessionId();
          createdAtRef.current = new Date().toISOString();
          const cards = deck.isFavorites
            ? (await favoritesApi.getFavoriteCards(userId)).filter(c => !deck.onlyCardId || c.id === deck.onlyCardId)
            : await api.getSessionCards([deck.id], { limit: 50, userId });
          if (cancelled) return;
          setQueue(cards);
          setIdx(0);
        }
      } catch (e) {
        if (!cancelled) { setErr(e.message || 'Could not load session cards'); setQueue([]); }
      }
    })();
    return () => { cancelled = true; };
    // `pendingResume` is a mount-stable lazy-init value (see above) —
    // intentionally not listed as a dependency, same reasoning as
    // DeckBrowser's own mount-time-only effect.
  }, [deck.id, deck.isFavorites, deck.onlyCardId, userId, resumeChoice]);

  // Persist proactively on every meaningful change — card advances, a
  // rating lands, pause/resume — rather than trying to catch a single
  // "leaving" event. Mobile browsers don't reliably fire beforeunload at
  // all, which is exactly why this can't be the only mechanism (see
  // pagehide/visibilitychange handling further down for the belt-and-
  // suspenders flush on the way out). Pure localStorage writes — no
  // network request here, so there's no backend "request storm" risk from
  // writing this often.
  // Mirrors the latest snapshot into a ref (not just localStorage) so the
  // pagehide/visibilitychange listener below can re-flush the exact same
  // payload synchronously, without needing to re-subscribe those listeners
  // on every idx/queue/paused change.
  const sessionSnapshotRef = useRef(null);
  useEffect(() => {
    if (queue === null || !queue.length || !sessionIdRef.current) { sessionSnapshotRef.current = null; return; }
    const snapshot = {
      sessionId: sessionIdRef.current,
      deckId: deck.id,
      cardIds: queue.map(c => c.id),
      idx,
      paused,
      status: 'active',
      createdAt: createdAtRef.current || new Date().toISOString(),
      actions, // Critical Bug Fix Batch 2 — undo history, see its own declaration above
    };
    sessionSnapshotRef.current = snapshot;
    saveSession(userId, deckKey, snapshot);
  }, [userId, deckKey, deck.id, idx, queue, paused, actions]);

  // Belt-and-suspenders flush for exactly the mobile lifecycle events this
  // batch is about — pagehide fires more reliably than visibilitychange on
  // some mobile browsers when a PWA is swiped away, so both are handled
  // (same reasoning lib/useStudySession.js's own heartbeat already
  // documents for the App-level "time spent studying" tracker). In
  // practice the effect above already writes on every relevant state
  // change before any of these can fire — this is defensive insurance
  // against a delayed/batched write racing an interruption, not the
  // primary mechanism.
  useEffect(() => {
    const flush = () => { if (sessionSnapshotRef.current) saveSession(userId, deckKey, sessionSnapshotRef.current); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [userId, deckKey]);

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
  //
  // Scoped by the CARD's own deck_id, not the static `deck` prop — the
  // media-resolve endpoint walks up from whatever id it's given to that
  // card's real root deck (api/imported-media-resolve.mjs's own comment),
  // so either id reaches the same root in a normal single-deck session.
  // Study Favorites is exactly the case where they can differ: its cards
  // can come from entirely different decks, and the static `deck` prop
  // there is a virtual favorites placeholder with no real row at all — the
  // endpoint would 403 on it immediately. card.deck_id is always a real
  // deck this specific card actually belongs to, regardless of which
  // session pulled it in.
  useEffect(() => {
    if (!card || !note || !model) return;
    let cancelled = false;
    const filenames = cardMediaFilenames({ card, note, model });
    if (!filenames.length) { setResolvedMedia({}); return; }
    api.resolveMedia(card.deck_id || deck.id, filenames).then(map => { if (!cancelled) setResolvedMedia(map); })
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

  // Duplicate-review note: if the app is interrupted while api.rateCard's
  // request is in flight — the write reaches the server, but the response
  // never reaches this client — `idx` never advances locally (setQueue/
  // advance below never run), so a naive resume would show this exact
  // card again as if it were never rated, and a second rating would
  // compound an interval that had already moved. The queue-loading effect
  // above guards against exactly this on resume (comparing the card's
  // last_reviewed_at against the session's last confirmed activity) — see
  // its own comment. Nothing extra is needed here: this function doesn't
  // know whether a future interruption will land mid-flight, only the
  // resume path can detect that after the fact.
  const rate = async (label) => {
    if (!card || rating || restoring) return;
    const ratedIdx = idx;
    // Critical Bug Fix Batch 2 — snapshot exactly the fields a rating can
    // change, from the card as it stands RIGHT NOW, before calling
    // rateCard. This is the only place this snapshot can be taken: once
    // rateCard's patch lands, the pre-rating values are gone from every
    // copy of this card MedBook holds (the row itself, and the queue
    // entry rate() is about to overwrite below) except this one.
    const previousState = Object.fromEntries(api.SCHEDULING_FIELDS.map(f => [f, card[f]]));
    setRating(label);
    try {
      const { card: updated, logInsert } = await api.rateCard(card, label);
      // Same reason ReviewQueue.js keeps its cards array live after rating:
      // ← lets you step back to this card and rate it again, and a re-rating
      // has to act on the card's CURRENT (post-rating) scheduling state, not
      // the stale pre-rating snapshot still sitting in the queue array.
      setQueue(q => { const next = [...q]; next[ratedIdx] = updated; return next; });
      // Record the undo entry AFTER the rating is confirmed saved — never
      // on a failed rating, which correctly leaves nothing for Previous to
      // undo (there's nothing to undo; the rating never happened).
      // Overwrites any earlier entry for this same card outright — exactly
      // right for "rate, Previous, rate again": the second rating's own
      // previousState (captured above, from whatever the card looked like
      // at THIS moment — i.e. already back at its pre-first-rating values,
      // since Previous restores before this can run again) is what matters
      // going forward, not the first rating's now-irrelevant history.
      logInsertsRef.current[card.id] = logInsert;
      setActions(a => ({ ...a, [card.id]: { previousState, rating: label, ratedAtIso: updated.last_reviewed_at } }));
      advance();
    } catch (e) {
      setErr(e.message || 'Could not save rating');
    }
    setRating(null);
  };

  // Optimistic toggle — flip the local Set immediately (the star reacts
  // this frame), persist in the background via toggleFavorite (which
  // itself takes the CURRENT state rather than re-deriving it — see its
  // own doc comment), and roll the Set back to exactly what it was if the
  // write fails, surfacing why rather than leaving a star that lied.
  const toggleCardFavorite = async () => {
    if (!card) return;
    const wasFavorited = favoriteIds.has(card.id);
    setFavoriteIds(prev => {
      const next = new Set(prev);
      wasFavorited ? next.delete(card.id) : next.add(card.id);
      return next;
    });
    try {
      await favoritesApi.toggleFavorite(card.id, userId, wasFavorited);
    } catch (e) {
      setFavoriteIds(prev => {
        const next = new Set(prev);
        wasFavorited ? next.add(card.id) : next.delete(card.id);
        return next;
      });
      setErr(e.message || 'Could not update favorite');
    }
  };

  // Critical Bug Fix Batch 2 — Previous means "go back to the previous
  // card AND undo the most recent CURRENT-SESSION rating on it," not just
  // "decrement the index." If the card being returned to has no recorded
  // action (never rated this session, or already undone and not re-rated
  // — see rate()'s own comment), this degrades to exactly the old plain
  // navigation: nothing to undo, so nothing async happens and it's just as
  // instant as before.
  //
  // Deliberately NOT optimistic about the undo itself (unlike, say, the
  // favorite-star toggle): this only navigates back and reveals the card
  // once the restore has actually succeeded, so the user can never be
  // looking at a "reverted" card whose underlying scheduling state wasn't
  // really reverted. `restoring` disables Previous and the rating buttons
  // for the (normally brief) time this takes, rather than letting a
  // second action land on top of a restore still in flight.
  const goPrev = async () => {
    if (idx === 0 || restoring || rating) return;
    const targetIdx = idx - 1;
    const target = queue[targetIdx];
    const action = target ? actions[target.id] : null;
    if (!action) { setIdx(targetIdx); setRevealed(false); return; }
    setRestoring(true);
    setErr('');
    try {
      const restored = await api.unrateCard(target.id, target.deck_id, action.previousState, action.ratedAtIso, logInsertsRef.current[target.id]);
      setQueue(q => { const next = [...q]; next[targetIdx] = restored; return next; });
      setActions(a => { const next = { ...a }; delete next[target.id]; return next; });
      delete logInsertsRef.current[target.id];
      setIdx(targetIdx);
      setRevealed(false);
    } catch (e) {
      // Restore failed — stay exactly where we are (still on the LATER
      // card, action entry untouched) rather than navigating to a card
      // whose data might now be in an inconsistent state. The user can
      // press Previous again to retry.
      setErr(e.message || 'Could not undo the last rating — still on the previous card, nothing changed. Try Previous again.');
    }
    setRestoring(false);
  };

  // Exiting mid-session is a deliberate "leave for now", not "abandon my
  // progress" — the persisted session is left in place (subject to its own
  // 24h expiry) so a later "Study" click on this same deck offers to
  // resume it, same as recovering from an actual interruption would. Only
  // an actually-finished session (below) gets cleared: there's nothing
  // left to resume into once every card's been seen.
  const exit = () => { onExit(); };
  const finishedNormally = () => { clearSession(userId, deckKey); };

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
  useReviewKeyboard(!!activeCard && !paused && !lightboxSrc && !restoring, {
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

  // Escape is the fallback "get me out" key for the lightbox, the flag
  // popover, and Focus Mode — on top of the explicit close/exit affordance
  // each already has (the popover's is now just "click outside", since it
  // dropped its own inline Close button once it became a real anchored
  // dropdown). Checked in topmost-layer-first order. A plain window
  // listener, not useReviewKeyboard: Escape isn't a review action, and
  // this needs to keep working even while the lightbox has that hook
  // disabled.
  useEffect(() => {
    if (!lightboxSrc && !focusMode && !flagPickerOpen) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (lightboxSrc) setLightboxSrc(null);
      else if (flagPickerOpen) setFlagPickerOpen(false);
      else setFocusMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxSrc, focusMode, flagPickerOpen]);

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

  // Explicit "Resume Study?" choice — shown only when there's real
  // progress worth asking about (see resumeChoice's own init above). This
  // is the one place "opening the same deck" is NOT allowed to silently
  // mean "start a new session": the user picks, every time, rather than
  // either always resuming (which would be surprising if they genuinely
  // wanted a fresh pass) or always restarting (the bug this whole batch
  // exists to fix).
  if (resumeChoice === null) return (
    <div style={{ maxWidth: 420, margin: '80px auto 0', textAlign: 'center', fontFamily: 'Inter,sans-serif' }}>
      <div style={{ fontSize: 34, marginBottom: 14 }}>↩️</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 6 }}>Resume Study?</div>
      <div style={{ fontSize: 13, color: t.text3, marginBottom: 22 }}>
        {deck.display_name} — card {pendingResume.idx + 1} of {pendingResume.cardIds.length}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={() => setResumeChoice('resume')} style={B(t.accent)}>▶ Resume</button>
        <button onClick={() => { clearSession(userId, deckKey); setResumeChoice('new'); }} style={B(t.surface3, t.text2)}>
          Start New Session
        </button>
      </div>
    </div>
  );

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
  // width/height live in the .mb-ss-iconbtn CSS class (below), not here —
  // inline styles always beat a CSS class for the same property, and the
  // narrow-viewport media queries need to be able to override the tile
  // size without an !important fight. Everything else about a tile stays
  // here since it doesn't need to respond to viewport width.
  const iconBtnStyle = (extra = {}) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, padding: 0,
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
        .mb-ss-iconbtn { width: 34px; height: 34px; transition: filter .12s ease, transform .12s ease, background-color .12s ease; }
        .mb-ss-iconbtn:hover:not(:disabled) { filter: brightness(0.97); }
        body.medbook-dark .mb-ss-iconbtn:hover:not(:disabled) { filter: brightness(1.25); }
        .mb-ss-iconbtn:active:not(:disabled) { transform: scale(0.93); }
        /* Toolbar counter fix — root cause of "1 /\n50": this span sat in a
           plain flex row (space-between) with no whiteSpace/flexShrink of
           its own, so once the icon tiles on either side genuinely didn't
           fit the viewport, the browser shrank the LEAST-constrained item —
           this text — by wrapping it, rather than the icon tiles (all
           width:34/flexShrink:0, so they can't shrink at all). nowrap makes
           wrapping impossible outright; flexShrink:0 stops it from being
           compressed below its own content width either. min-width reserves
           room for the widest realistic case ("50 / 50") so the icon groups
           on either side don't visibly shift as the digit count changes
           between single- and double-digit positions. */
        .mb-ss-counter { font-size: 13px; white-space: nowrap; flex-shrink: 0; min-width: 46px; text-align: center; }
        /* Icon-group gaps live in CSS (not inline) for the same reason
           iconbtn's size does — the narrow-viewport rules below need to
           shrink them without an inline-style fight. */
        .mb-ss-icongroup { display: flex; align-items: center; gap: 6px; }
        /* Reclaim just enough room for the counter to comfortably read as
           one unit on real phone widths (320-430px) — tiles and gaps step
           down together rather than any one control disappearing. "Do not
           remove controls" is satisfied by construction: every rule here
           only ever resizes/re-spaces what's already there. */
        @media (max-width: 480px) {
          .mb-ss-iconbtn { width: 32px; height: 32px; }
          .mb-ss-icongroup { gap: 4px; }
          .mb-ss-counter { font-size: 12px; min-width: 42px; }
        }
        @media (max-width: 360px) {
          .mb-ss-iconbtn { width: 29px; height: 29px; }
          .mb-ss-icongroup { gap: 3px; }
        }
        /* Measured (not guessed) against a worst-case toolbar — all 7 icon
           tiles including the image-zoom one, plus a realistic "50 / 50"
           counter, which is wider than its min-width once double digits
           appear on both sides — the 360px tier's own numbers start
           genuinely overflowing the available header width below ~332px
           (an iPhone SE/similar being the real case that hits this, not a
           hypothetical). One more step down closes it with room to spare. */
        @media (max-width: 340px) {
          .mb-ss-iconbtn { width: 27px; height: 27px; }
          .mb-ss-icongroup { gap: 2px; }
        }
        .mb-ss-ratebtn { transition: filter .12s ease; }
        .mb-ss-ratebtn:active:not(:disabled) { filter: brightness(0.92); }
        .mb-ss-showanswer { transition: filter .12s ease, transform .12s ease; }
        .mb-ss-showanswer:hover { filter: brightness(1.04); }
        .mb-ss-showanswer:active { transform: scale(0.99); }
        .mb-ss-flagpop { animation: mb-ss-flagpop-in .12s ease; transform-origin: top left; }
        @keyframes mb-ss-flagpop-in { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: none; } }
        /* Batch 2 — Focus Mode's own entrance/exit is the one "mode
           transition" in this screen; animating just this one collapsing
           strip (rather than every element that swaps) is what keeps it
           "extremely subtle" instead of turning into a layout shuffle. */
        .mb-ss-progress-wrap { transition: max-height .2s ease, opacity .15s ease, margin-bottom .2s ease; overflow: hidden; }
        .mb-ss-lightbox { animation: mb-ss-lightbox-in .15s ease; }
        @keyframes mb-ss-lightbox-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .mb-ss-iconbtn, .mb-ss-ratebtn, .mb-ss-showanswer, .mb-ss-progress-wrap { transition: none !important; }
          .mb-ss-lightbox, .mb-ss-flagpop { animation: none !important; }
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
            <div className="mb-ss-icongroup">
              <button className="mb-ss-iconbtn" onClick={toggleCardFavorite}
                title={favoriteIds.has(card.id) ? 'Remove favorite' : 'Favorite this card'}
                aria-label={favoriteIds.has(card.id) ? 'Remove favorite' : 'Favorite this card'}
                style={iconBtnStyle({ color: favoriteIds.has(card.id) ? '#eab308' : t.text3 })}>
                <IconStar size={14} filled={favoriteIds.has(card.id)} />
              </button>
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
            <div className="mb-ss-icongroup">
              <button className="mb-ss-iconbtn" onClick={goPrev} disabled={idx === 0 || restoring || !!rating}
                title="Previous card" aria-label="Previous card"
                style={iconBtnStyle({ opacity: (idx === 0 || restoring) ? 0.4 : 1, cursor: (idx === 0 || restoring) ? 'default' : 'pointer' })}>
                <IconChevronLeft size={16} />
              </button>
              <button className="mb-ss-iconbtn" onClick={() => setPaused(true)}
                title="Pause session" aria-label="Pause session" style={iconBtnStyle()}>
                <IconPause size={13} />
              </button>
              {/* position:relative wrapper makes the color popover a true
                  sub-part of this button — anchored right below/beside it
                  via absolute positioning — instead of a full-width bar
                  down in the content area with no visible connection to
                  what opened it. */}
              <div style={{ position: 'relative' }}>
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
                {flagPickerOpen && (
                  <>
                    {/* Full-viewport, invisible, dismiss-on-click — NOT a
                        cosmetic backdrop. A plain "click outside closes it"
                        document listener can't work here: most of the
                        screen is the card's sandboxed iframe, and a click
                        that lands inside an iframe never bubbles out to the
                        parent document at all (separate browsing context —
                        true regardless of sandboxing). This scrim sits
                        between the popover (z-index 20, above it) and
                        everything else, so it's what actually catches
                        "clicked the card to dismiss this" rather than that
                        click silently doing nothing. */}
                    <div onClick={() => setFlagPickerOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 15 }} />
                    <div className="mb-ss-flagpop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20,
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 9px',
                      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
                      boxShadow: `0 8px 24px ${t.shadowStrong}`, whiteSpace: 'nowrap' }}>
                      {FLAGS.map(f => (
                        <button key={f} onClick={() => setFlag(f)} title={card.flag === f ? `Clear flag (${FLAG_NAMES[f]})` : FLAG_NAMES[f]}
                          style={{ width: 18, height: 18, borderRadius: '50%', background: FLAG_COLORS[f], padding: 0,
                            border: card.flag === f ? `2px solid ${t.text}` : '2px solid transparent', cursor: 'pointer' }} />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button className="mb-ss-iconbtn" onClick={toggleCardFavorite}
                title={favoriteIds.has(card.id) ? 'Remove favorite' : 'Favorite this card'}
                aria-label={favoriteIds.has(card.id) ? 'Remove favorite' : 'Favorite this card'}
                style={iconBtnStyle({ color: favoriteIds.has(card.id) ? '#eab308' : t.text3 })}>
                <IconStar size={14} filled={favoriteIds.has(card.id)} />
              </button>
            </div>
            <span className="mb-ss-counter" style={{ color: t.text3, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {idx + 1} / {queue.length}
            </span>
            <div className="mb-ss-icongroup">
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
              <button key={key} className="mb-ss-ratebtn" onClick={() => rate(key)} disabled={!!rating || restoring}
                style={{
                  flex: 1, minHeight: 54, padding: '10px 6px',
                  // A touch softer than the raw token — blended toward the
                  // card's own surface rather than a hardcoded new hex, so
                  // it stays theme-correct (and restrained) in both modes.
                  background: `color-mix(in srgb, ${t[tokenKey]} 90%, ${t.surface})`,
                  color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif',
                  borderRight: i < RATINGS.length - 1 ? '1px solid rgba(255,255,255,0.22)' : 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  opacity: ((rating && rating !== key) || restoring) ? 0.5 : 1,
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
