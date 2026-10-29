import { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR } from '../lib/constants';
import { useTheme, SPACE, RADIUS, FONT, MOTION, Z, BREAKPOINT } from '../lib/theme';
import { getReviewQueueTheme } from '../lib/reviewQueueTheme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { buildCycledQueue } from '../lib/reviewQueue';
import { computeSystemStats } from '../lib/systemStats';
import { normalizeSections } from '../services/ai';
import { loadSession, saveSession, clearSession, newSessionId } from '../lib/reviewSessionStore';
import { flushStudySessionNow } from '../lib/useStudySession';
import ReviewKeyPoints, { hasKeyPoints } from './ReviewKeyPoints';
import { IconPlay, IconPause, IconCheck, IconChevronLeft, IconChevronRight,
  IconX, IconZap } from '../lib/icons';
import RichRuns from '../lib/RichRuns';

const SANS = 'Inter,sans-serif';

// Renders notes with the same highlight colours the entry has in its
// system view. Formatting and highlight colour are composed in ONE pass
// inside RichRuns (buildFormattedParts) — never by slicing `text` at
// highlight boundaries before handing it to RichRuns, which is what used to
// corrupt a **bold** run whenever a highlight landed partway through it.
function RenderedNotes({ text, highlights, isDark }) {
  return (
    <span style={{whiteSpace:'pre-wrap'}}>
      <RichRuns text={text} highlights={highlights} isDark={isDark} />
    </span>
  );
}

// The supporting column (images + AI key points) extracted into its own
// memoized component — performance fix: ReviewQueue's session timer
// re-renders the whole screen every second (elapsedSec ticking), and this
// column, once revealed, is the single most expensive thing on it to
// re-paint (decoded images, laid out again every tick). None of its props
// change on a timer tick — only when the card itself changes — so wrapping
// it here lets React skip re-rendering it on every elapsedSec update while
// changing nothing about what it actually does.
//
// Deliberately NOT extended to the main card/notes/rating area in the same
// way: that content's handlers (rate/skip) close over several pieces of
// fast-changing session state (sessionDone, idx, total), and this file's
// ESLint setup doesn't enforce react-hooks/exhaustive-deps — memoizing
// those without that safety net risks a stale-closure bug silently
// corrupting what gets submitted to spaced-repetition scheduling, which is
// a far worse outcome than the re-render cost it would save. `onImageClick`
// below is a plain useState setter (setLightboxIdx), which React guarantees
// is always referentially stable — no such risk here.
const SideColumn = memo(function SideColumn({ rt, images, aiSections, hasKeyPoints, onImageClick }) {
  const hasImages = images?.length > 0;
  return (
    <div className="mb-rq-side-col mb-rq-fade">
      {hasImages && (
        <div style={{ marginBottom: hasKeyPoints ? SPACE.xl : 0 }}>
          <div style={{ fontSize:FONT.size.xs, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.bold,
            textTransform:'uppercase', marginBottom:10 }}>
            Images
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {images.map((url, i) => (
              <img key={i} src={url} alt="" onClick={()=>onImageClick(i)} className="mb-rq-img"
                style={{ width:'100%', maxHeight:280, objectFit:'contain', borderRadius:RADIUS.xl,
                  cursor:'zoom-in', background:rt.surfaceSunken, display:'block',
                  border:`1px solid ${rt.border}`, boxShadow:`0 6px 20px -10px ${rt.shadow}` }} />
            ))}
          </div>
        </div>
      )}
      {hasKeyPoints && <ReviewKeyPoints sections={aiSections} />}
    </div>
  );
});

function LbBtn({ onClick, title, style, children }) {
  return (
    <button className="mb-rq-btn" onClick={onClick} title={title} aria-label={title} style={{
      background:'rgba(255,255,255,.15)', border:'none', color:'#fff', cursor:'pointer',
      display:'flex', alignItems:'center', justifyContent:'center', ...style }}>
      {children}
    </button>
  );
}

// Arrow-navigable lightbox — matches DetailView.js's, restyled in the same
// pass (batch 6) this file wasn't part of at the time. Swipe-to-navigate is
// deliberately NOT wired up here (unlike DetailView.js's): in review mode
// people routinely pinch-zoom into an image and then pan around it, and a
// horizontal pan of more than 50px was being read as a swipe and yanking
// them to the next/previous image mid-pan. Prev/Next stay available via
// the on-screen buttons.
function Lightbox({ images, start, onClose }) {
  const [idx, setIdx] = useState(start);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:Z.lightbox,
      display:'flex', alignItems:'center', justifyContent:'center', animation:`medbook-scrim-in ${MOTION.normal} ${MOTION.ease}` }}>
      <LbBtn onClick={onClose} title="Close" style={{ position:'absolute', top:16, right:20,
        width:40, height:40, borderRadius:RADIUS.circle }}><IconX size={18} /></LbBtn>
      {images.length > 1 && <>
        <div style={{ position:'absolute', top:20, left:'50%', transform:'translateX(-50%)',
          color:'#fff', fontSize:13, background:'rgba(0,0,0,.5)', padding:'4px 14px', borderRadius:RADIUS.pill }}>
          {idx + 1}/{images.length}
        </div>
        <LbBtn onClick={prev} title="Previous image" style={{ position:'absolute', left:12,
          width:44, height:44, borderRadius:RADIUS.circle }}><IconChevronLeft size={22} /></LbBtn>
        <LbBtn onClick={next} title="Next image" style={{ position:'absolute', right:12,
          width:44, height:44, borderRadius:RADIUS.circle }}><IconChevronRight size={22} /></LbBtn>
      </>}
      <img key={idx} src={images[idx]} alt=""
        style={{ maxWidth:'90vw', maxHeight:'85vh', borderRadius:RADIUS.md, objectFit:'contain', display:'block',
          animation:`medbook-pop-in ${MOTION.normal} ${MOTION.ease}` }}
        onClick={e => e.stopPropagation()} />
      <div onClick={onClose} style={{ position:'absolute', inset:0, zIndex:-1 }} />
    </div>
  );
}

const RATINGS = [
  { key:'again', label:'Again', tone:'danger' },
  { key:'hard',  label:'Hard',  tone:'warn'   },
  { key:'good',  label:'Good',  tone:'accent' },
  { key:'easy',  label:'Easy',  tone:'ok'     },
];

// Deliberately just these three (+ "All" below) — not the full DIFFICULTY
// list from lib/constants.js, which also has "Flagged". This filter is
// about how hard an entry is to review, not about flagging; Flagged stays
// out unless asked for.
const REVIEW_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

// One global, fixed scope — unlike System Review (one modal per system),
// there's only ever one Review Queue screen, so one saved session is all
// it needs. See reviewSessionStore.js's own header comment for why this
// exists and how resuming works.
const SESSION_SCOPE = 'queue';

// Quick-pick block sizes for the Card Count selector — 'all' (the existing,
// unchanged behaviour: cycle through everything due+new) plus a few common
// exact counts. A custom number input sits alongside these for "an exact
// block" beyond these presets.
const CARD_COUNT_PRESETS = [10, 20, 30, 50];

// mm:ss (or h:mm:ss past an hour) for the live header timer — deliberately
// a different shape from Insights' own formatDuration (seconds → "2m"/"1h
// 5m"): this one is a ticking readout mid-session, that one's a finished
// summary, and conflating the two formats would make neither read right.
function formatElapsed(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

// Same scheduling math as before this batch — UNCHANGED. This is the "Review
// Queue data logic" the brief explicitly says not to touch.
function calcNext(entry, rating) {
  let interval = entry.review_interval || 1;
  let ef = entry.ease_factor || 2.5;
  if      (rating === 'again') { interval = 1; }
  else if (rating === 'hard')  { interval = Math.max(1, Math.round(interval * 1.2)); ef = Math.max(1.3, ef - 0.15); }
  else if (rating === 'good')  { interval = Math.max(1, Math.round(interval * ef)); }
  else if (rating === 'easy')  { interval = Math.max(1, Math.round(interval * ef * 1.3)); ef = Math.min(4, ef + 0.1); }
  const next = new Date();
  next.setDate(next.getDate() + interval);
  return {
    review_interval: interval,
    ease_factor: parseFloat(ef.toFixed(2)),
    next_review: next.toISOString(),
    review_count: (entry.review_count || 0) + 1,
    last_reviewed: new Date().toISOString()
  };
}

// Presentation-only formatter for the interval preview under each rating
// button — reads calcNext's OWN output (never re-implements the math), so
// the label can never drift from what actually gets saved.
function formatDays(d) {
  if (d < 1) return `${Math.round(d * 24)}h`;
  if (d < 30) return `${d}d`;
  if (d < 365) return `${(d / 30).toFixed(1)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

// Display-only cap for the "Due Today" count — a literal count in the
// hundreds reads as alarming/overwhelming rather than useful, so anything
// past DUE_DISPLAY_CAP shows as "50+" instead of the exact number. Purely
// cosmetic: the real dueCount this is derived from is untouched, so a Due
// session still pulls every card that's actually due, exactly as before —
// only the headline number and the "Due (N)" mode button label are capped.
const DUE_DISPLAY_CAP = 50;
function formatDueCount(n) {
  return n > DUE_DISPLAY_CAP ? `${DUE_DISPLAY_CAP}+` : String(n);
}

// Short, human description of the current session configuration — read by
// the CTA panel's summary line. Pure presentation; reads the same filter
// state the controls themselves set, never a second source of truth.
function describeSession(mode, systemCount, difficulty) {
  const parts = [];
  parts.push(mode === 'due' ? 'Due cards' : mode === 'new' ? 'New cards' : 'Due + new cards');
  parts.push(systemCount === 0 ? 'every system' : systemCount === 1 ? '1 system' : `${systemCount} systems`);
  if (difficulty !== 'All') parts.push(difficulty.toLowerCase());
  return parts.join(' · ');
}

export default function ReviewQueue({ allEntries, onReviewed, userSystems, initialFilterSystem, userId }) {
  const { isDark } = useTheme();
  const rt = getReviewQueueTheme(isDark);

  // Always-current entries, WITHOUT making the queue rebuild on every rating.
  // (Rebuilding mid-session makes the list shift under the cursor and skip cards.)
  const entriesRef = useRef(allEntries);
  entriesRef.current = allEntries;

  // Landing/overview screen (new this batch) — the queue used to drop you
  // straight into the first due card with no "what am I about to do" step.
  // `sessionStarted` gates that; everything below it (queue/idx/flipped/…)
  // is the exact same session machinery as before.
  const [sessionStarted, setSessionStarted] = useState(false);
  const [filterMode, setFilterMode]     = useState('all');   // 'all' | 'due' | 'new'
  const [filterSystem, setFilterSystem] = useState([]);       // [] = every system; else a list of selected system names
  const [filterDifficulty, setFilterDifficulty] = useState('All'); // 'All' | 'Easy' | 'Medium' | 'Hard'

  const [queue, setQueue] = useState([]);
  const [idx, setIdx]  = useState(0);
  const [flipped, setFlipped]   = useState(false);
  const [sessionDone, setSess]  = useState(0);
  const [done, setDone]         = useState(false);
  const [ended, setEnded]       = useState(false); // user paused midway
  const [lightboxIdx, setLightboxIdx] = useState(null); // index into card.images, or null
  const [cardLimit, setCardLimit] = useState('all'); // 'all' | exact card count for this session

  // Count-up session timer — elapsedSec is the authoritative displayed/
  // persisted value, ticking via timerRunning rather than a raw Date.now()
  // diff so pausing genuinely freezes it (no "paused time" counted) and
  // resuming continues from exactly where it left off.
  const [elapsedSec, setElapsedSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // Resumable sessions — see reviewSessionStore.js's own header comment for
  // the full "why": switching apps / backgrounding on mobile can discard and
  // recreate this whole tab's JS context, which used to throw away an
  // in-progress session with no way back except starting over.
  //
  // `pendingResume` is read fresh from localStorage any time the overview
  // screen is about to render (recomputed whenever `sessionStarted` flips
  // back to false, or `resumeVersion` is bumped by an explicit Discard) —
  // deliberately NOT a one-time mount-only read, since a session saved
  // mid-mount (e.g. the user reviews a few cards, then clicks Back to
  // Overview) needs to show up as resumable without requiring an actual
  // component remount.
  const [resumeVersion, setResumeVersion] = useState(0);
  const pendingResume = useMemo(() => loadSession(userId, SESSION_SCOPE),
    [userId, sessionStarted, resumeVersion]);
  const sessionIdRef = useRef(null);
  const createdAtRef = useRef(null);

  // One review_sessions row per session (see SUPABASE_MIGRATION_REVIEW_
  // SESSIONS.sql), written once it ends — loggedRef guards against writing
  // it twice (e.g. reaching "done" and then also unmounting). sessionMetaRef
  // holds the system/target-count this session started with, captured once
  // at the start since filterSystem/cardLimit can change again afterward
  // (picking new filters for the NEXT session shouldn't retroactively alter
  // what gets logged for this one).
  const loggedRef = useRef(true); // true = nothing pending (no session started yet)
  const sessionMetaRef = useRef(null);

  // Persist this session's result exactly once, whenever it ends — reaching
  // "done", exiting to the overview, or starting a fresh session before this
  // one got anywhere (abandoning it). Never logged if nothing was actually
  // rated (sessionDone===0, or the override passed from rate() below is 0)
  // — opening Review Queue and immediately leaving isn't "a study session".
  // Fire-and-forget, same as review_log/study_sessions: a missing table or
  // transient failure here must never affect the review itself.
  // `countOverride` exists because rate() calls this in the same tick as
  // setSess(sessionDone+1) — state setters don't apply until the next
  // render, so reading `sessionDone` here would undercount the very last
  // card by one without it.
  const flushSessionLog = (countOverride) => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    // Commit the app-wide Study Time timer's elapsed-so-far right now,
    // instead of leaving it to the next heartbeat tick (up to 30s away) or
    // a tab hide that might not come for a while — in-app navigation away
    // from Review Queue (e.g. "Back to Overview") never triggers either of
    // those on its own, since the tab itself never actually hides. Without
    // this, a finished review session showed up in "Recent study sessions"
    // immediately but its time could sit uncommitted in Study Time for a
    // while, reading as "not counted" even though it hadn't been lost.
    // Unconditional (not inside the count/userId guards below) — the user
    // was actively using the app for this whole stretch regardless of
    // whether any cards ended up rated.
    flushStudySessionNow();
    const count = countOverride ?? sessionDone;
    if (count === 0 || !userId) return;
    const meta = sessionMetaRef.current || {};
    supabase.from('review_sessions').insert({
      user_id: userId,
      system: meta.system || null,
      card_count: count,
      target_count: meta.targetCount ?? null,
      duration_seconds: elapsedSec,
      started_at: new Date(Date.now() - elapsedSec * 1000).toISOString(),
    }).then(({ error }) => {
      if (error && process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[ReviewQueue] review_sessions insert failed — has SUPABASE_MIGRATION_REVIEW_SESSIONS.sql been run?', error.message);
      }
    });
  };

  // Unmount safety net — navigating away from Review Queue entirely (e.g.
  // to Dashboard) unmounts this component; without this, a session
  // abandoned that way (as opposed to via "Back to Overview") would never
  // get logged. flushRef always holds the LATEST flushSessionLog closure
  // (reassigned every render), so this cleanup — fixed at effect-setup
  // time — still sees current sessionDone/elapsedSec/userId when it
  // actually runs, instead of whatever they were on first mount.
  const flushRef = useRef(flushSessionLog);
  flushRef.current = flushSessionLog;
  useEffect(() => () => flushRef.current(), []);

  // Shared by startNewSession and the initialFilterSystem effect below
  // (which can't call startNewSession directly — see its own comment) so
  // both reset the timer/log bookkeeping identically.
  const beginSession = (builtQueue, meta) => {
    flushSessionLog(); // in case a previous unfinished session is being abandoned
    clearSession(userId, SESSION_SCOPE); // a brand-new session obsoletes any saved one
    sessionIdRef.current = newSessionId();
    createdAtRef.current = new Date().toISOString();
    setQueue(builtQueue);
    setIdx(0); setFlipped(false); setDone(false); setEnded(false); setSess(0);
    setSessionStarted(true);
    setElapsedSec(0); setTimerRunning(true);
    loggedRef.current = false;
    sessionMetaRef.current = meta;
  };

  // Reconstruct a saved session by re-mapping its frozen, ordered entry-id
  // list back onto the CURRENT allEntries (never a second fetch — see
  // reviewSessionStore.js's own header comment on why that's safe/correct
  // here) — dropping any id that's since been deleted.
  //
  // Guards against the same race studySessionStore's imported-deck resume
  // does: if the app was interrupted while a rating's Supabase write was
  // in flight, the write can still have reached the server even though
  // `idx` never advanced locally before the interruption. Detected the same
  // way — comparing the resumed card's own `last_reviewed` against this
  // session's last confirmed activity — and, if so, stepping one card
  // forward instead of replaying an already-saved rating.
  const resumeSession = (saved) => {
    flushSessionLog();
    const byId = new Map(Object.values(entriesRef.current).flat().map(e => [e.id, e]));
    const ordered = (saved.entryIds || []).map(id => byId.get(id)).filter(Boolean);
    if (ordered.length === 0) {
      clearSession(userId, SESSION_SCOPE);
      alert("That session's cards no longer exist — starting a new session instead.");
      startNewSession();
      return;
    }
    let restoredIdx = Math.min(saved.idx || 0, ordered.length - 1);
    const atSavedIdx = ordered[restoredIdx];
    if (atSavedIdx?.last_reviewed && saved.lastActiveAt
        && new Date(atSavedIdx.last_reviewed) > new Date(saved.lastActiveAt)) {
      restoredIdx = Math.min(restoredIdx + 1, ordered.length - 1);
    }
    sessionIdRef.current = saved.sessionId || newSessionId();
    createdAtRef.current = saved.createdAt || saved.lastActiveAt || new Date().toISOString();
    setQueue(ordered);
    setIdx(restoredIdx);
    setFlipped(false); setDone(false); setEnded(false);
    setSess(saved.sessionDone || 0);
    setSessionStarted(true);
    setElapsedSec(saved.elapsedSec || 0);
    setTimerRunning(true);
    loggedRef.current = false;
    sessionMetaRef.current = saved.meta || null;
    if (saved.filterMode) setFilterMode(saved.filterMode);
    // Older saved sessions stored a single system name as a plain string;
    // normalize to the array shape so downstream code (the chips' active
    // state, filterEntries, etc.) never has to care which era a resumed
    // session came from.
    if (saved.filterSystem !== undefined) {
      setFilterSystem(Array.isArray(saved.filterSystem)
        ? saved.filterSystem
        : (saved.filterSystem ? [saved.filterSystem] : []));
    }
    if (saved.filterDifficulty) setFilterDifficulty(saved.filterDifficulty);
    if (saved.cardLimit !== undefined) setCardLimit(saved.cardLimit);
  };

  const discardResume = () => {
    clearSession(userId, SESSION_SCOPE);
    setResumeVersion(v => v + 1);
  };

  // Same due/fresh definitions used everywhere else in the app (Dashboard,
  // reviewQueue.js's own buildCycledQueue) — filtering just chooses which
  // entries feed the UNCHANGED queue builder, it doesn't reimplement it.
  const filterEntries = useCallback((mode, system, difficulty = 'All') => {
    let list = Object.values(entriesRef.current).flat();
    // `system` is normally the filterSystem array (possibly several systems
    // selected at once, to mix them into one session), but a couple of call
    // sites (the priority-row quick action, the initialFilterSystem effect)
    // still pass a single system name as a plain string — accept both.
    const systems = Array.isArray(system) ? system : (system ? [system] : []);
    if (systems.length > 0) list = list.filter(e => systems.includes(e.system));
    if (difficulty !== 'All') list = list.filter(e => e.difficulty === difficulty);
    const now = new Date();
    if (mode === 'due') list = list.filter(e => e.next_review && new Date(e.next_review) <= now);
    else if (mode === 'new') list = list.filter(e => !e.next_review);
    return list;
  }, []);

  // Deliberately NOT a useCallback — it closes over flushSessionLog, which
  // in turn closes over sessionDone/elapsedSec/userId; memoizing this on a
  // narrower dep list (filters only) would let it silently call a STALE
  // flushSessionLog whenever those hadn't changed but the session's own
  // progress had. Nothing depends on this function's referential identity
  // (see the initialFilterSystem effect's own comment on why IT avoids
  // that dependency), so there's no cost to leaving it unmemoized.
  const startNewSession = (mode = filterMode, system = filterSystem, difficulty = filterDifficulty, limit = cardLimit) => {
    let built = buildCycledQueue(filterEntries(mode, system, difficulty));
    if (limit !== 'all') built = built.slice(0, limit);
    // Logged/displayed (review_sessions.system, Insights' "Recent study
    // sessions") as a single human-readable label — a plain name for one
    // system, a comma-joined list for a mixed session, null for "every
    // system". Never the raw array: that column is just text.
    const systems = Array.isArray(system) ? system : (system ? [system] : []);
    beginSession(built, { system: systems.length ? systems.join(', ') : null, targetCount: limit === 'all' ? null : limit });
  };

  const backToOverview = () => { flushSessionLog(); setSessionStarted(false); };

  // Persist proactively on every meaningful change — card advances, a
  // rating lands, pause/resume, elapsed time ticking — rather than trying
  // to catch a single "leaving" event, which mobile browsers don't
  // reliably fire at all. Pure localStorage writes — no network request
  // here, so there's no backend "request storm" risk from writing this
  // often. Stops writing once `done` (a completed session has nothing left
  // worth resuming into — cleared explicitly below instead).
  const sessionSnapshotRef = useRef(null);
  useEffect(() => {
    if (!sessionStarted || done || !queue.length || !sessionIdRef.current) {
      sessionSnapshotRef.current = null;
      return;
    }
    const snapshot = {
      sessionId: sessionIdRef.current,
      entryIds: queue.map(e => e.id),
      idx, sessionDone, elapsedSec,
      status: 'active',
      createdAt: createdAtRef.current || new Date().toISOString(),
      filterMode, filterSystem, filterDifficulty, cardLimit,
      meta: sessionMetaRef.current,
    };
    sessionSnapshotRef.current = snapshot;
    saveSession(userId, SESSION_SCOPE, snapshot);
  }, [userId, sessionStarted, done, queue, idx, sessionDone, elapsedSec,
      filterMode, filterSystem, filterDifficulty, cardLimit]);

  // Belt-and-suspenders flush for exactly the mobile lifecycle events this
  // exists for — pagehide fires more reliably than visibilitychange on some
  // mobile browsers when a PWA is backgrounded/swiped away (same reasoning
  // lib/useStudySession.js's own heartbeat already documents). In practice
  // the effect above already writes on every relevant state change before
  // any of these can fire — this is defensive insurance against a delayed/
  // batched write racing an interruption, not the primary mechanism.
  useEffect(() => {
    const flush = () => { if (sessionSnapshotRef.current) saveSession(userId, SESSION_SCOPE, sessionSnapshotRef.current); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [userId]);

  // Arriving from Insights' "Needs attention" — jump straight into a due
  // session for that system, exactly like clicking a priority row on this
  // screen's own overview already does.
  //
  // Calls beginSession directly instead of startNewSession: depending on
  // `filterEntries` (stable — a useCallback with no deps) instead of
  // startNewSession itself keeps this effect genuinely single-fire per
  // navigation, since setFilterSystem below would otherwise combine with a
  // startNewSession dependency to fire this effect a second time right
  // after the first, reshuffling the queue twice on landing. A "Needs
  // attention" jump always means every due card in that system, so it
  // bypasses the Card Count limit entirely (targetCount: null) rather than
  // inheriting whatever was last picked on this screen's own overview.
  useEffect(() => {
    if (!initialFilterSystem) return;
    setFilterSystem([initialFilterSystem]);
    // A difficulty picked in some earlier session on this screen shouldn't
    // silently narrow this one too — arriving from "Needs attention" means
    // every due card in this system, not whatever was last selected here.
    setFilterDifficulty('All');
    beginSession(buildCycledQueue(filterEntries('due', initialFilterSystem, 'All')),
      { system: initialFilterSystem, targetCount: null });
  }, [initialFilterSystem, filterEntries]);

  const card = queue[idx];
  const total = queue.length;

  // The existing AI Analysis output for this card, if any — never generated
  // here, only read back (see services/ai/ResponseParser.js's
  // normalizeSections, the same normaliser DetailView.js uses so an old/
  // partial row can't crash this). Must run on EVERY render, including the
  // overview/done/ended screens below where `card` is undefined — a hook
  // can't be called only on some renders (Rules of Hooks), so this can't
  // live further down past those early returns.
  const cardAiSections = useMemo(() => normalizeSections(card?.ai_sections), [card]);
  const cardHasKeyPoints = hasKeyPoints(cardAiSections);
  const cardHasImages = card?.images?.length > 0;

  // This screen's own prev/counter/pause cluster and progress fill portal
  // into App.js's PERSISTENT header bar (#mb-study-toolbar-slot and
  // #mb-header-progress-slot) instead of a second header row drawn inside
  // this component — the same pattern StudySession.js already uses for its
  // own toolbar. That frees the entire top of this screen for the card
  // itself. Those divs are siblings rendered earlier in the same tree, so
  // they already exist by the time this render runs, but `getElementById`
  // still needs an effect (not a render-time call) — see StudySession.js's
  // identical comment on its own headerSlot.
  const [headerSlot, setHeaderSlot] = useState(null);
  const [progressSlot, setProgressSlot] = useState(null);
  useEffect(() => {
    setHeaderSlot(document.getElementById('mb-study-toolbar-slot'));
    setProgressSlot(document.getElementById('mb-header-progress-slot'));
  }, []);

  // Keyboard: Space=reveal, Enter=Easy, g=Good, h=Hard, a=Again.
  // Disabled on the overview screen, once the session is over, or while the
  // image lightbox is open on top.
  useReviewKeyboard(sessionStarted && !done && !ended && !!card && lightboxIdx===null, {
    flipped, onFlip: () => setFlipped(true),
    onAgain: () => rate('again'), onHard: () => rate('hard'),
    onGood: () => rate('good'),   onEasy: () => rate('easy'),
    onPrev: () => goPrev(),
  });
  const progress = total > 0 ? Math.round((sessionDone / total) * 100) : 0;

  // ── Overview data — all real, all already-used definitions ──────────────
  //
  // Global (unscoped — every system, every difficulty) counts, used ONLY to
  // decide whether to show the "you're caught up" celebratory screen below.
  // That decision has to stay global: if it used the scoped counts instead,
  // picking a system/difficulty combination that happens to have zero due
  // or new cards would swap the ENTIRE overview (filters included) for that
  // dead-end screen, with no way back to change the selection. Starting a
  // session that matches nothing already has its own proper empty state
  // (the "Nothing matches this filter" screen further down, with a Back to
  // Overview button) — this one is reserved for "truly nothing, anywhere".
  const globalDueCount = useMemo(() => {
    const now = new Date();
    return Object.values(allEntries).flat()
      .filter(e => e.next_review && new Date(e.next_review) <= now).length;
  }, [allEntries]);

  const globalNewCount = useMemo(() =>
    Object.values(allEntries).flat().filter(e => !e.next_review).length,
  [allEntries]);

  const globalNextDue = useMemo(() => {
    const now = new Date();
    const upcoming = Object.values(allEntries).flat()
      .filter(e => e.next_review && new Date(e.next_review) > now)
      .map(e => new Date(e.next_review))
      .sort((a, b) => a - b);
    return upcoming[0] || null;
  }, [allEntries]);

  // Scoped to whichever system/difficulty is currently selected below, NOT
  // always every system — this is exactly the bug that made picking a
  // system here do nothing visible: dueCount/newCount used to read straight
  // from `allEntries` regardless of filterSystem, so the StatPills (and the
  // "Due (N)"/"New (N)" filter button labels, which read these same two
  // values) kept showing the all-systems totals no matter what you'd just
  // selected. Deriving everything from one `scopedEntries` memo means
  // picking a system or a difficulty can't leave any one of these three
  // numbers stale while the others update.
  const scopedEntries = useMemo(() => {
    let list = Object.values(allEntries).flat();
    if (filterSystem.length > 0) list = list.filter(e => filterSystem.includes(e.system));
    if (filterDifficulty !== 'All') list = list.filter(e => e.difficulty === filterDifficulty);
    return list;
  }, [allEntries, filterSystem, filterDifficulty]);

  const dueCount = useMemo(() => {
    const now = new Date();
    return scopedEntries.filter(e => e.next_review && new Date(e.next_review) <= now).length;
  }, [scopedEntries]);

  const newCount = useMemo(() =>
    scopedEntries.filter(e => !e.next_review).length,
  [scopedEntries]);

  const nextDue = useMemo(() => {
    const now = new Date();
    const upcoming = scopedEntries
      .filter(e => e.next_review && new Date(e.next_review) > now)
      .map(e => new Date(e.next_review))
      .sort((a, b) => a - b);
    return upcoming[0] || null;
  }, [scopedEntries]);

  // Same shared per-system rollup Dashboard/Sidebar already use — not a
  // second counting system, the same one, just surfaced here too.
  const priority = useMemo(() => {
    if (!userSystems) return [];
    return computeSystemStats(allEntries, userSystems, rt.accent)
      .filter(s => s.dueCount > 0)
      .sort((a, b) => b.dueCount - a.dueCount)
      .slice(0, 6);
  }, [allEntries, userSystems, rt.accent]);

  const rate = async (rating) => {
    if (!card) return;
    const updates = calcNext(card, rating);
    const { error } = await supabase.from('entries').update(updates).eq('id', card.id);
    if (error) {
      alert(`Couldn't save this review: ${error.message}\n\nIf this mentions a missing column, run the SM-2 migration in Supabase.`);
      return;
    }
    onReviewed({ ...card, ...updates });
    // Real retention data for Insights — one row per rating. Fire-and-forget
    // and never surfaced to the user: this is supplementary analytics, not
    // part of the scheduling update above, so a missing table (migration
    // not run yet) or a transient failure here must never block a review
    // that already succeeded. See SUPABASE_MIGRATION_INSIGHTS.sql.
    if (userId) {
      supabase.from('review_log').insert({
        user_id: userId, entry_id: card.id, system: card.system, rating,
      }).then(({ error: logError }) => {
        if (logError && process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[ReviewQueue] review_log insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', logError.message);
        }
      });
    }
    const newSessionDone = sessionDone + 1;
    setSess(newSessionDone);
    if (idx + 1 >= total) {
      setDone(true);
      setTimerRunning(false);
      flushSessionLog(newSessionDone);
      clearSession(userId, SESSION_SCOPE); // completed — nothing left worth resuming into
    } else { setIdx(p => p + 1); setFlipped(false); }
  };

  const skip = () => {
    if (idx + 1 >= total) { setDone(true); clearSession(userId, SESSION_SCOPE); }
    else { setIdx(p => p + 1); setFlipped(false); }
  };

  // Re-view a prior card. Deliberately does NOT touch sessionDone/progress —
  // those only move forward from an actual rating — so stepping back and
  // forth can't inflate "reviewed" past how many cards were really rated.
  // Re-rating a revisited card still works exactly like rating any other
  // card (rate() reads the card's CURRENT scheduling state, so it's a
  // normal "I take that back" correction, not a special case).
  const goPrev = () => {
    if (idx === 0) return;
    setIdx(p => p - 1);
    setFlipped(false);
  };

  const pauseSession = () => { setEnded(true); setTimerRunning(false); };

  // ── Shared local CSS — editorial-luxury interaction language ────────────
  // One rule set for both the setup screen (new composition) and the
  // active-card/paused/complete screens below (lighter-touch restyle of
  // the existing structure) so the whole component reads as one coherent
  // instrument. Motion is collapsed app-wide for prefers-reduced-motion by
  // public/index.html's own global rule — nothing extra needed here.
  const localCss = `
    .mb-rq-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-rq-btn:hover:not(:disabled) { filter: brightness(1.06); }
    .mb-rq-btn:active:not(:disabled) { transform: scale(0.97); }
    .mb-rq-rate:active { transform: scale(0.95); }
    .mb-rq-row { transition: background ${MOTION.fast} ${MOTION.ease}; }
    .mb-rq-row:hover { background: ${rt.surfaceQuiet}; }
    .mb-rq-row:active { transform: scale(0.99); }
    .mb-rq-fade { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }

    /* Secondary-element chips (mode / system / difficulty / count) — subtle
       outline by default, a short lift + border/background shift on hover,
       a firm press. Selection itself is communicated by fill + border
       colour (set inline per-chip), never by this rule alone. */
    .mb-rq-chip {
      transition: background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease},
        color ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease};
    }
    .mb-rq-chip:hover:not(:disabled) { transform: translateY(-1px); }
    .mb-rq-chip:active:not(:disabled) { transform: translateY(0) scale(0.97); }

    .mb-rq-cta-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease},
      box-shadow ${MOTION.fast} ${MOTION.ease}; }
    .mb-rq-cta-btn:hover { filter: brightness(1.08); box-shadow: 0 10px 28px -10px ${rt.accentDeep}; }
    .mb-rq-cta-btn:active { transform: scale(0.98); }

    /* Setup-screen composition — single column until there's real width,
       then an asymmetric two-column workspace: configuration on the left,
       a standing session-summary + Start Review instrument on the right.
       The right column becomes sticky-to-top on desktop (see .mb-rq-cta's
       own media query below) — the SAME markup repositioned, not two
       different renders. */
    .mb-rq-shell {
      display: grid; grid-template-columns: minmax(0,1fr);
      grid-template-areas: "identity" "resume" "status" "config" "cta";
      gap: ${SPACE.xl2}px;
    }
    @media (min-width:${BREAKPOINT.tablet}px) {
      .mb-rq-shell {
        grid-template-columns: minmax(0,1fr) 336px;
        grid-template-areas: "identity identity" "resume resume" "status cta" "config cta";
        gap: ${SPACE.xl3}px;
        align-items: start;
      }
      /* Sticky-top only — the right column is naturally shorter than the
         left, so this keeps Start Review in view while the left column
         scrolls past it. Deliberately NOT mirrored as sticky-bottom on the
         single-column mobile/tablet layout below: with the CTA as a grid
         item in an implicitly-sized row, sticky-bottom was confirmed (by
         direct measurement, not guesswork) to engage immediately at the
         top of the page instead of only after scrolling past it, pinning
         the CTA over the configuration controls above it. Keeping the CTA
         in normal document flow at those widths avoids that — it's still
         the clearly-visible final element in a short, scannable sequence,
         "reachable" the same way the pre-redesign page always was. */
      .mb-rq-cta { position: sticky; top: ${SPACE.xl}px; }
    }

    /* Card column + supporting column — single column (card alone, or
       card then supporting info stacked) until there's real width to work
       with, matching every other responsive grid in this app (Dashboard). */
    .mb-rq-content { display:grid; grid-template-columns:minmax(0,1fr); gap:${SPACE.xl}px; align-items:start; }
    @media (min-width:${BREAKPOINT.tablet}px) {
      .mb-rq-content.has-side { grid-template-columns:minmax(0,1fr) 320px; gap:${SPACE.xl2+4}px; }
    }

    /* Scrollable study surface — the only part of the active-review screen
       that scrolls. A visible but unobtrusive scrollbar so it doesn't read
       as a cramped inner box. */
    .mb-rq-scroll { scrollbar-width:thin; scrollbar-color:${rt.borderRich} transparent; }
    .mb-rq-scroll::-webkit-scrollbar { width:8px; }
    .mb-rq-scroll::-webkit-scrollbar-thumb { background:${rt.borderRich}; border-radius:8px; }

    .mb-rq-img { transition:transform ${MOTION.fast} ${MOTION.ease}, box-shadow ${MOTION.fast} ${MOTION.ease}; }
    .mb-rq-img:hover { transform:translateY(-2px); }

    /* Anchored rating footer — a top divider plus an upward-cast shadow so
       it reads as a surface sitting above the study area, not just content
       that happens to trail the card. */
    .mb-rq-ratingbar {
      padding:${SPACE.lg}px 2px ${SPACE.xs}px; border-top:1px solid ${rt.border};
      box-shadow:0 -16px 28px -20px ${rt.shadowRich};
    }
  `;

  // ── Overview / landing screen ────────────────────────────────────────
  if (!sessionStarted) {
    const nothingAtAll = globalDueCount === 0 && globalNewCount === 0;
    const sessionSummary = describeSession(filterMode, filterSystem.length, filterDifficulty);
    const willReviewCount = cardLimit !== 'all' ? Math.min(cardLimit, dueCount + newCount) : (dueCount + newCount);

    return (
      <div className="mb-rq-fade" style={{ maxWidth:1060, margin:'0 auto', fontFamily:SANS }}>
        <style>{localCss}</style>

        <div className="mb-rq-shell">
          {/* ── Identity — page title + study context, no border: text and
              hierarchy carry it, matching the brief's "minimal boundaries
              around ordinary text." ───────────────────────────────────── */}
          <div style={{ gridArea:'identity' }}>
            <div style={{ fontSize:FONT.size.micro, color:rt.accent, letterSpacing:1.6, fontWeight:FONT.weight.bold,
              textTransform:'uppercase', marginBottom:8 }}>
              Study Session
            </div>
            <div style={{ fontFamily:SANS, fontSize:28, fontWeight:FONT.weight.bold,
              color:rt.text, lineHeight:1.15, letterSpacing:-.3 }}>
              Review Queue
            </div>
            <div style={{ fontSize:FONT.size.base, color:rt.text3, marginTop:6, maxWidth:440, lineHeight:1.5 }}>
              What should you review right now?
            </div>
          </div>

          {/* ── Resumable session — same logic as before, restyled into an
              accent-tinted banner that reads as "pick up where you left
              off", distinct from the rest of the page's graphite surfaces. */}
          {pendingResume && (pendingResume.sessionDone > 0 || pendingResume.idx > 0) && Array.isArray(pendingResume.entryIds) && pendingResume.entryIds.length > 0 && (
            <div style={{ gridArea:'resume', background:rt.accentBg, border:`1px solid ${rt.accentBorder}`,
              borderRadius:RADIUS.lg, padding:`${SPACE.md+2}px ${SPACE.lg}px`,
              display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:180 }}>
                <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:rt.accentStrong }}>
                  Resume your last session
                </div>
                <div style={{ fontSize:FONT.size.xs, color:rt.text3, marginTop:2 }}>
                  {pendingResume.sessionDone || 0} of {pendingResume.entryIds.length} cards reviewed
                  {pendingResume.elapsedSec > 0 ? ` · ${formatElapsed(pendingResume.elapsedSec)}` : ''}
                </div>
              </div>
              <button className="mb-rq-btn" onClick={() => resumeSession(pendingResume)} style={{
                background:rt.accent, color:isDark?'#1b1420':'#fff', border:'none', borderRadius:RADIUS.sm+1,
                padding:'9px 18px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
                fontFamily:SANS }}>
                Resume
              </button>
              <button className="mb-rq-btn" onClick={discardResume} style={{
                background:'none', color:rt.text3, border:`1px solid ${rt.border}`, borderRadius:RADIUS.sm+1,
                padding:'9px 14px', fontSize:FONT.size.sm, cursor:'pointer', fontFamily:SANS }}>
                Discard
              </button>
            </div>
          )}

          {nothingAtAll ? (
            <div style={{ gridArea:'status', background:rt.surface, border:`1px solid ${rt.borderRich}`,
              borderRadius:RADIUS.xl2, padding:'52px 28px', textAlign:'center',
              boxShadow:`0 1px 2px ${rt.shadow}` }}>
              <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background:rt.successBg,
                border:`1px solid ${rt.successBorder}`,
                display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
                <IconCheck size={22} style={{ color:rt.success }} />
              </div>
              <div style={{ fontFamily:SANS, fontSize:FONT.size.xl, fontWeight:FONT.weight.bold,
                color:rt.text, marginBottom:8 }}>
                You're caught up
              </div>
              <div style={{ fontSize:FONT.size.sm, color:rt.text3, lineHeight:1.65, maxWidth:360, margin:'0 auto' }}>
                {globalNextDue
                  ? <>No reviews are due right now. Next card is scheduled for{' '}
                      <strong style={{ color:rt.text2 }}>
                        {globalNextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
                      </strong>.</>
                  : 'No cards due. Rate entries here as you review them to start scheduling.'}
              </div>
            </div>
          ) : (
            <>
              {/* ── Review status — ONE rich container holding the editorial
                  due/new masthead and, when relevant, the priority list
                  beneath a hairline rule. Replaces a row of generic stat
                  cards with a single considered instrument reading. ──── */}
              <div style={{ gridArea:'status', background:rt.surface, border:`1px solid ${rt.borderRich}`,
                borderRadius:RADIUS.xl2, boxShadow:`0 1px 2px ${rt.shadow}`, overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'stretch', padding:`${SPACE.xl}px ${SPACE.xl2}px` }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:SANS, fontSize:FONT.size.display, fontWeight:FONT.weight.bold,
                      color: dueCount>0 ? rt.due : rt.text, lineHeight:1, letterSpacing:-1, fontVariantNumeric:'tabular-nums' }}>
                      {formatDueCount(dueCount)}
                    </div>
                    <div style={{ fontSize:FONT.size.xs, color:rt.text3, letterSpacing:.6, fontWeight:FONT.weight.semibold,
                      textTransform:'uppercase', marginTop:8 }}>
                      Due Today
                    </div>
                  </div>
                  <div style={{ width:1, background:rt.border, margin:'2px 0' }} />
                  <div style={{ flex:1, paddingLeft:SPACE.xl2 }}>
                    <div style={{ fontFamily:SANS, fontSize:FONT.size.display, fontWeight:FONT.weight.bold,
                      color: newCount>0 ? rt.fresh : rt.text, lineHeight:1, letterSpacing:-1, fontVariantNumeric:'tabular-nums' }}>
                      {newCount}
                    </div>
                    <div style={{ fontSize:FONT.size.xs, color:rt.text3, letterSpacing:.6, fontWeight:FONT.weight.semibold,
                      textTransform:'uppercase', marginTop:8 }}>
                      New
                    </div>
                  </div>
                  {nextDue && dueCount===0 && (
                    <div style={{ flex:1, paddingLeft:SPACE.xl2, borderLeft:`1px solid ${rt.border}`,
                      display:'flex', flexDirection:'column', justifyContent:'center' }}>
                      <div style={{ fontSize:FONT.size.xs, color:rt.text4 }}>Next due</div>
                      <div style={{ fontSize:FONT.size.sm, color:rt.text2, fontWeight:FONT.weight.semibold, marginTop:2 }}>
                        {nextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
                      </div>
                    </div>
                  )}
                </div>

                {priority.length > 0 && (
                  <>
                    <div style={{ height:1, background:rt.border }} />
                    <div style={{ padding:`${SPACE.lg}px ${SPACE.xl2}px` }}>
                      <div style={{ fontSize:FONT.size.xs, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                        textTransform:'uppercase', marginBottom:SPACE.sm+2, display:'flex', alignItems:'center', gap:6 }}>
                        <IconZap size={11} /> High Priority — {priority.length} system{priority.length!==1?'s':''} need review
                      </div>
                      <div style={{ display:'flex', flexDirection:'column' }}>
                        {priority.map((s, i) => (
                          <button key={s.name} className="mb-rq-row" onClick={() => { setFilterSystem([s.name]); setFilterDifficulty('All'); startNewSession('due', s.name, 'All'); }}
                            style={{ display:'flex', alignItems:'center', gap:SPACE.sm, padding:'9px 4px',
                              borderRadius:RADIUS.sm, cursor:'pointer', background:'none', border:'none', textAlign:'left' }}>
                            <div style={{ width:7, height:7, borderRadius:RADIUS.circle, background:s.color, flexShrink:0 }} />
                            <div style={{ flex:1, fontSize:FONT.size.sm, color:rt.text2, fontWeight:FONT.weight.medium,
                              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                            {i === 0 && <IconZap size={11} style={{ color:rt.due, flexShrink:0 }} />}
                            <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, color:rt.due,
                              background:rt.dueBg, borderRadius:RADIUS.pill, padding:'2px 8px', flexShrink:0 }}>
                              {s.dueCount}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ── Configure Session — one rich container, sub-sections
                  separated by hairline rules rather than stacked boxes.
                  System selection gets the most internal space of the
                  four, per the brief's call for "appropriate visual
                  prominence." ──────────────────────────────────────── */}
              <div style={{ gridArea:'config', background:rt.surface, border:`1px solid ${rt.borderRich}`,
                borderRadius:RADIUS.xl2, boxShadow:`0 1px 2px ${rt.shadow}`, padding:`${SPACE.xl}px ${SPACE.xl2}px` }}>
                <div style={{ fontFamily:SANS, fontSize:FONT.size.lg, fontWeight:FONT.weight.bold,
                  color:rt.text, marginBottom:SPACE.lg }}>
                  Configure Session
                </div>

                {/* Mode */}
                <div style={{ marginBottom:SPACE.lg }}>
                  <div style={{ fontSize:FONT.size.micro, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                    textTransform:'uppercase', marginBottom:SPACE.sm }}>Review Mode</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {[
                      { key:'all', label:'All' },
                      { key:'due', label:`Due (${formatDueCount(dueCount)})` },
                      { key:'new', label:`New (${newCount})` },
                    ].map(f => (
                      <button key={f.key} className="mb-rq-chip" onClick={()=>setFilterMode(f.key)} style={{
                        fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:SANS,
                        background: filterMode===f.key ? rt.accentBg : 'transparent',
                        color: filterMode===f.key ? rt.accentStrong : rt.text3,
                        border:`1px solid ${filterMode===f.key ? rt.accentBorder : rt.border}`,
                        borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer' }}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ height:1, background:rt.border, margin:`${SPACE.lg}px 0` }} />

                {/* Systems — given the most room, per the brief. */}
                {userSystems?.length > 0 && (
                  <div style={{ marginBottom:SPACE.lg }}>
                    <div style={{ fontSize:FONT.size.micro, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                      textTransform:'uppercase', marginBottom:SPACE.sm }}>
                      Medical Systems {filterSystem.length>0 && <span style={{ color:rt.accent }}>· {filterSystem.length} selected</span>}
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button className="mb-rq-chip" onClick={()=>setFilterSystem([])} style={{
                        fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:SANS,
                        background: filterSystem.length===0 ? rt.accentBg : 'transparent',
                        color: filterSystem.length===0 ? rt.accentStrong : rt.text3,
                        border:`1px solid ${filterSystem.length===0 ? rt.accentBorder : rt.border}`,
                        borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer' }}>
                        All systems
                      </button>
                      {userSystems.map(s => {
                        const active = filterSystem.includes(s.name);
                        const dot = s.color || SYS_COLOR[s.name] || rt.accent;
                        return (
                          <button key={s.name} className="mb-rq-chip"
                            onClick={() => setFilterSystem(prev => prev.includes(s.name) ? prev.filter(n => n !== s.name) : [...prev, s.name])}
                            style={{
                              display:'flex', alignItems:'center', gap:7,
                              fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, fontFamily:SANS,
                              background: active ? rt.accentBg : 'transparent',
                              color: active ? rt.accentStrong : rt.text2,
                              border:`1px solid ${active ? rt.accentBorder : rt.border}`,
                              borderRadius:RADIUS.pill, padding:'7px 14px 7px 10px', cursor:'pointer' }}>
                            <span style={{ width:6, height:6, borderRadius:RADIUS.circle, background:dot, flexShrink:0 }} />
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ height:1, background:rt.border, margin:`${SPACE.lg}px 0` }} />

                {/* Difficulty */}
                <div style={{ marginBottom:SPACE.lg }}>
                  <div style={{ fontSize:FONT.size.micro, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                    textTransform:'uppercase', marginBottom:SPACE.sm }}>Difficulty</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {['All', ...REVIEW_DIFFICULTIES].map(d => {
                      const active = filterDifficulty === d;
                      const c = d === 'All' ? rt.text3 : (DIFF_COLOR[d] || rt.text3);
                      return (
                        <button key={d} className="mb-rq-chip" onClick={()=>setFilterDifficulty(d)} style={{
                          fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:SANS,
                          background: active ? `${c}1f` : 'transparent', color: active ? c : rt.text3,
                          border:`1px solid ${active ? `${c}55` : rt.border}`,
                          borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer' }}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ height:1, background:rt.border, margin:`${SPACE.lg}px 0` }} />

                {/* Card Count */}
                <div>
                  <div style={{ fontSize:FONT.size.micro, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                    textTransform:'uppercase', marginBottom:SPACE.sm }}>Review Quantity</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    <button className="mb-rq-chip" onClick={()=>setCardLimit('all')} style={{
                      fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:SANS,
                      background: cardLimit==='all' ? rt.accentBg : 'transparent',
                      color: cardLimit==='all' ? rt.accentStrong : rt.text3,
                      border:`1px solid ${cardLimit==='all' ? rt.accentBorder : rt.border}`,
                      borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer' }}>
                      All
                    </button>
                    {CARD_COUNT_PRESETS.map(n => (
                      <button key={n} className="mb-rq-chip" onClick={()=>setCardLimit(n)} style={{
                        fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:SANS,
                        background: cardLimit===n ? rt.accentBg : 'transparent',
                        color: cardLimit===n ? rt.accentStrong : rt.text3,
                        border:`1px solid ${cardLimit===n ? rt.accentBorder : rt.border}`,
                        borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer' }}>
                        {n}
                      </button>
                    ))}
                    <input type="number" min="1" placeholder="Custom"
                      value={typeof cardLimit === 'number' && !CARD_COUNT_PRESETS.includes(cardLimit) ? cardLimit : ''}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        setCardLimit(v > 0 ? v : 'all');
                      }}
                      style={{ width:92, fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, fontFamily:SANS,
                        background:'transparent', color:rt.text2, border:`1px solid ${rt.border}`,
                        borderRadius:RADIUS.pill, padding:'8px 12px', outline:'none' }} />
                  </div>
                </div>
              </div>

              {/* ── Session summary + Start Review — the dedicated primary
                  action, richly bordered and visually distinct from the
                  quieter configuration controls beside it. Sticky on
                  desktop, a reachable bottom-anchored bar on mobile. ──── */}
              <div className="mb-rq-cta" style={{ gridArea:'cta', background:rt.surfaceRaised,
                border:`1.5px solid ${rt.accentBorder}`, borderRadius:RADIUS.xl2,
                boxShadow:`0 18px 40px -18px ${rt.shadowRich}`, padding:SPACE.xl }}>
                <div style={{ fontSize:FONT.size.micro, color:rt.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                  textTransform:'uppercase', marginBottom:8 }}>
                  Ready to begin
                </div>
                <div style={{ fontSize:FONT.size.sm, color:rt.text2, lineHeight:1.6, marginBottom:SPACE.lg }}>
                  {sessionSummary}
                  {cardLimit !== 'all' && <> · up to {willReviewCount} cards</>}
                </div>
                <button className="mb-rq-cta-btn" onClick={()=>startNewSession()} style={{
                  width:'100%', background:rt.accent, color:isDark?'#1b1420':'#fff', border:'none',
                  borderRadius:RADIUS.md, padding:'15px 20px', fontSize:FONT.size.base, fontWeight:FONT.weight.bold,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontFamily:SANS }}>
                  <IconPlay size={14} />
                  {dueCount>0 ? 'Start Review' : 'Review New Cards'}
                  {cardLimit !== 'all' ? ` · ${willReviewCount}` : ''}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Paused / complete screens ─────────────────────────────────────────
  // `|| total === 0` closes a pre-existing gap (found during this redesign's
  // own testing, not introduced by it — the original code had the identical
  // unguarded `card.system`/`card.title` access below): starting a session
  // whose filter combination matches zero cards left `ended`/`done` both
  // false, so it fell through past this branch into the active-card return
  // with `card` undefined and crashed, instead of reaching the "Nothing
  // matches this filter" screen that already exists for exactly this case
  // a few lines down. Purely a render guard — no filtering/scheduling logic
  // changed.
  if (ended || done || total === 0) {
    if (total === 0) {
      // A filtered session that matched nothing — different message from
      // "literally nothing due anywhere" on the overview screen.
      return (
        <div className="mb-rq-fade" style={{ maxWidth:480, margin:'0 auto', textAlign:'center', paddingTop:'14vh', fontFamily:SANS }}>
          <style>{localCss}</style>
          <div style={{ fontFamily:SANS, fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:rt.text, marginBottom:8 }}>
            Nothing matches this filter
          </div>
          <button className="mb-rq-btn" onClick={backToOverview} style={{
            background:'transparent', color:rt.text2, border:`1px solid ${rt.borderRich}`, borderRadius:RADIUS.sm+1,
            padding:'10px 20px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
            marginTop:14, fontFamily:SANS }}>
            Back to Overview
          </button>
        </div>
      );
    }
    return (
      <div className="mb-rq-fade" style={{ maxWidth:480, margin:'0 auto', textAlign:'center', paddingTop:'12vh', fontFamily:SANS }}>
        <style>{localCss}</style>
        <div style={{ width:52, height:52, borderRadius:RADIUS.xl2,
          background: done ? rt.successBg : rt.surfaceQuiet,
          border:`1px solid ${done ? rt.successBorder : rt.border}`,
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          {done ? <IconCheck size={22} style={{ color:rt.success }} /> : <IconPause size={20} style={{ color:rt.text3 }} />}
        </div>
        <div style={{ fontFamily:SANS, fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:rt.text, marginBottom:8 }}>
          {done ? 'Session complete' : 'Paused'}
        </div>
        <div style={{ fontSize:FONT.size.base, color:rt.text3, marginBottom:6 }}>
          Reviewed <strong style={{ color:rt.text2 }}>{sessionDone}</strong> of <strong style={{ color:rt.text2 }}>{total}</strong> cards this session
          {elapsedSec > 0 && <> in <strong style={{ color:rt.text2 }}>{formatElapsed(elapsedSec)}</strong></>}.
        </div>
        {!done && (
          <div style={{ fontSize:FONT.size.xs, color:rt.text4, marginBottom:26 }}>
            {total - idx - 1} card{total-idx-1!==1?'s':''} remaining. They'll be here when you come back.
          </div>
        )}
        {done && <div style={{ fontSize:FONT.size.xs, color:rt.text4, marginBottom:26 }}>All cards reviewed!</div>}

        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          {!done && (
            <button className="mb-rq-btn" onClick={() => { setFlipped(false); setEnded(false); setTimerRunning(true); }} style={{
              background:rt.accent, color:isDark?'#1b1420':'#fff', border:'none', borderRadius:RADIUS.sm+1,
              padding:'11px 22px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
              display:'flex', alignItems:'center', gap:7, fontFamily:SANS }}>
              <IconPlay size={12} /> Resume
            </button>
          )}
          <button className="mb-rq-btn" onClick={()=>startNewSession()} style={{
            background: done ? rt.accent : 'transparent', color: done ? (isDark?'#1b1420':'#fff') : rt.text2,
            border: done ? 'none' : `1px solid ${rt.borderRich}`, borderRadius:RADIUS.sm+1,
            padding:'11px 22px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
            fontFamily:SANS }}>
            Start New Session
          </button>
          <button className="mb-rq-btn" onClick={backToOverview} style={{
            background:'none', color:rt.text4, border:`1px solid ${rt.border}`, borderRadius:RADIUS.sm+1,
            padding:'11px 18px', fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, cursor:'pointer',
            fontFamily:SANS }}>
            Back to Overview
          </button>
        </div>
      </div>
    );
  }

  // ── Active card review ────────────────────────────────────────────────
  const color = SYS_COLOR[card?.system] || rt.accent;
  // Real, per-card interval previews — computed from the same calcNext()
  // that actually persists, so these can never fabricate a number the
  // rating buttons don't back up.
  const previews = card ? RATINGS.reduce((acc, r) => {
    acc[r.key] = formatDays(calcNext(card, r.key).review_interval);
    return acc;
  }, {}) : {};
  const toneColor = {
    danger: rt.due, warn: rt.warn, accent: rt.accent, ok: rt.success,
  };
  const toneBg = {
    danger: rt.dueBg, warn: rt.warnBg, accent: rt.accentBg, ok: rt.successBg,
  };

  // A side column only appears once the answer is revealed AND there's
  // actually something to put in it (images or key points) — never an
  // empty panel reserving dead space.
  const showSide = flipped && (cardHasImages || cardHasKeyPoints);

  return (
    <div className="mb-rq-fade" style={{ maxWidth:1040, margin:'0 auto', width:'100%',
      fontFamily:SANS, height:'100%', display:'flex', flexDirection:'column' }}>
      <style>{localCss}</style>

      {lightboxIdx !== null && card?.images?.length > 0 && (
        <Lightbox images={card.images} start={lightboxIdx} onClose={()=>setLightboxIdx(null)} />
      )}

      {/* Prev/counter/pause — portaled into App.js's persistent header bar
          (see the headerSlot effect above) instead of a row drawn here, so
          this component contributes NOTHING to the top of the screen and
          the card gets the full height below the app's own header. */}
      {headerSlot && createPortal(
        <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto' }}>
          <button className="mb-headerbtn" onClick={goPrev} disabled={idx===0}
            title="Previous card" aria-label="Previous card" style={{
            background:'none', border:'none', color: idx===0 ? rt.text4 : rt.text3,
            opacity: idx===0 ? .45 : 1, padding:6, width:28, height:28, borderRadius:RADIUS.sm,
            cursor: idx===0 ? 'default' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <IconChevronLeft size={14} />
          </button>
          <span style={{ fontSize:FONT.size.sm, color:rt.text3, fontWeight:FONT.weight.medium, padding:'0 2px' }}>{idx + 1} / {total}</span>
          {/* Count-up session timer — ticks via timerRunning (see its own
              effect above), so it genuinely freezes while paused instead of
              just visually looking frozen. tabular-nums keeps the digits
              from jittering the whole cluster's width as seconds roll over. */}
          <span style={{ fontSize:FONT.size.xs, color:rt.text4, fontVariantNumeric:'tabular-nums', padding:'0 2px' }}
            title="Session time">
            {formatElapsed(elapsedSec)}
          </span>
          <button className="mb-headerbtn" onClick={pauseSession} title="Pause session" aria-label="Pause session" style={{
            background:'none', border:'none', color:rt.text3, padding:6, width:28, height:28,
            borderRadius:RADIUS.sm, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <IconPause size={13} />
          </button>
        </div>,
        headerSlot
      )}

      {/* Progress fill — portaled into App.js's header-bottom-border slot
          (see the progressSlot effect above), so the header's own bottom
          edge doubles as this session's progress bar instead of a static
          line drawn a second time inside this screen. */}
      {progressSlot && createPortal(
        <div style={{ position:'absolute', inset:0, background:rt.surfaceSunken }}>
          <div style={{ height:'100%', background:rt.accent,
            width:`${progress}%`, transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
        </div>,
        progressSlot
      )}

      {/* Scrollable study surface — the ONLY part of this screen that
          scrolls. minHeight:0 is load-bearing on a flex child sized by
          flex:1 — without it this would grow to fit its content instead of
          scrolling internally. The rating bar lives INSIDE this container
          as a sticky footer (see below) rather than a flex sibling pinned
          to the viewport's bottom edge unconditionally — pinning it
          unconditionally left a large dead gap under a short card; sticky
          only pulls it down to the bottom edge once there's enough content
          to scroll, and otherwise it just follows the card normally. */}
      <div className="mb-rq-scroll" style={{ flex:1, minHeight:0, overflowY:'auto' }}>
        {/* Card column + supporting info column — the column only appears
            once there's something real to put in it (images and/or AI key
            points, revealed state only); otherwise the card column alone
            takes a comfortably wide, centred measure instead of stretching
            edge to edge with nothing beside it. */}
        <div className={`mb-rq-content${showSide ? ' has-side' : ''}`} style={{ paddingTop:SPACE.lg, paddingBottom:SPACE.md }}>
          <div className="mb-rq-card-col" style={showSide ? undefined : { maxWidth:760, margin:'0 auto', width:'100%' }}>

            {/* Card — a soft colour-tinted wash fading into the surface plus
                a colour-matched glow shadow, plus a richer border than the
                quiet chrome around it — this is the one primary container
                the whole screen exists to show. */}
            <div key={idx} className="mb-rq-fade mb-rq-card" style={{
              background:`linear-gradient(180deg, ${color}14 0%, ${rt.surface} 220px)`,
              border:`1px solid ${rt.borderRich}`, borderRadius:RADIUS.xl2, padding:SPACE.xl2,
              boxShadow:`0 24px 48px -20px ${color}40, 0 1px 2px ${rt.shadow}`, minHeight:260 }}>

              {/* System + review count — a dot + small-caps label instead of
                  a boxed pill, lighter and quieter than another bordered
                  rectangle competing with the card's own border. */}
              <div style={{ display:'flex', gap:8, marginBottom:SPACE.lg, flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:color, flexShrink:0 }} />
                <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.bold, letterSpacing:.6,
                  textTransform:'uppercase', color }}>{card.system}</span>
                {card.review_count > 0 && (
                  <span style={{ fontSize:FONT.size.xs, color:rt.text4 }}>· Reviewed {card.review_count}×</span>
                )}
              </div>

              {/* Title — always visible. */}
              <div style={{ fontFamily:SANS, fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold,
                color:rt.text, lineHeight:1.4, marginBottom:SPACE.xl }}>
                {card.title}
              </div>

              {/* Answer */}
              {!flipped ? (
                <button className="mb-rq-btn" onClick={()=>setFlipped(true)} style={{
                  width:'100%', background:rt.surfaceSunken, border:`2px dashed ${rt.borderRich}`,
                  borderRadius:RADIUS.md, padding:16, fontSize:FONT.size.md, color:rt.text3,
                  cursor:'pointer', fontWeight:FONT.weight.semibold, fontFamily:SANS }}>
                  Tap to reveal <span style={{ opacity:.7, fontWeight:FONT.weight.regular }}>· Space</span>
                </button>
              ) : (
                <div className="mb-rq-fade">
                  <div style={{ height:1, background:rt.border, marginBottom:SPACE.lg }} />
                  {card.notes ? (
                    // No maxHeight/scroll clamp here — this card sits inside
                    // the shared study-surface scroll area above, so a long
                    // answer gets real room instead of a small inner
                    // scrollbox. maxWidth keeps the LINE LENGTH readable
                    // even though the card column itself can be wide.
                    <div style={{ fontSize:FONT.size.lg, color:rt.text2, lineHeight:1.75,
                      whiteSpace:'pre-wrap', marginBottom:SPACE.lg, maxWidth:700 }}>
                      <RenderedNotes text={card.notes} highlights={card.highlights} isDark={isDark} />
                    </div>
                  ) : (
                    <div style={{ fontSize:FONT.size.sm, color:rt.text4, marginBottom:SPACE.lg }}>No notes for this entry.</div>
                  )}
                  {/* Images move to the supporting column once there's room
                      for one (see below); on narrow screens where that
                      column stacks underneath instead, they still end up
                      directly below the answer. */}
                </div>
              )}
            </div>
          </div>

          {/* Supporting column — real images at a size worth looking at
              (replacing the old cramped horizontal-scroll thumbnail strip),
              then the entry's existing AI key points, if any. Reuses the
              recovered space beside the card rather than leaving it empty. */}
          {showSide && (
            <SideColumn rt={rt} images={card.images} aiSections={cardAiSections}
              hasKeyPoints={cardHasKeyPoints} onImageClick={setLightboxIdx} />
          )}
        </div>

        {/* Rating bar — sticky to the BOTTOM OF THIS SCROLL CONTAINER, not
            the viewport: with a short card it simply sits right after the
            content (no dead gap stretching it down to the screen's edge);
            with a long revealed answer it clings to the bottom of the
            visible area as you scroll, so it's always reachable without
            hunting for it. A top divider + upward shadow reads as an
            anchored action bar rather than content that happens to trail
            the card. */}
        {flipped ? (
          <div className="mb-rq-fade mb-rq-ratingbar" style={{ position:'sticky', bottom:0, background:rt.page }}>
            <div style={{ fontSize:FONT.size.xs, color:rt.text4, fontWeight:FONT.weight.semibold,
              textAlign:'center', marginBottom:SPACE.sm+2, letterSpacing:.4 }}>
              How well did you know this?
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
              {RATINGS.map(r => (
                <button key={r.key} className="mb-rq-rate mb-rq-btn" onClick={()=>rate(r.key)} style={{
                  background:toneBg[r.tone], border:`1px solid ${toneColor[r.tone]}33`,
                  borderRadius:RADIUS.lg, padding:'14px 4px', minHeight:64, cursor:'pointer',
                  fontFamily:SANS, display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center', gap:3 }}>
                  <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.bold, color:toneColor[r.tone] }}>{r.label}</div>
                  <div style={{ fontSize:FONT.size.micro, color:toneColor[r.tone], opacity:.8 }}>{previews[r.key]}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize:FONT.size.micro, color:rt.text4, textAlign:'center', marginTop:8 }}>
              a · h · g · enter
            </div>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'14px 0 2px' }}>
            <button className="mb-rq-btn" onClick={skip} style={{ background:'none', border:'none',
              color:rt.text4, fontSize:FONT.size.xs, cursor:'pointer',
              textDecoration:'underline', fontFamily:SANS }}>
              Skip this card
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
