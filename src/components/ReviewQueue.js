import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR } from '../lib/constants';
import { buildHighlightParts, resolveHL } from '../lib/highlights';
import { useTheme, SPACE, RADIUS, FONT, MOTION, Z, elevation } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { buildCycledQueue } from '../lib/reviewQueue';
import { computeSystemStats } from '../lib/systemStats';
import { normalizeSections } from '../services/ai';
import ReviewKeyPoints, { hasKeyPoints } from './ReviewKeyPoints';
import { IconPlay, IconPause, IconCheck, IconChevronLeft, IconChevronRight,
  IconX, IconZap } from '../lib/icons';
import RichRuns from '../lib/RichRuns';

// Renders notes with the same highlight colours the entry has in its system view
function RenderedNotes({ text, highlights, isDark }) {
  const parts = buildHighlightParts(text, highlights);
  return (
    <span style={{whiteSpace:'pre-wrap'}}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}><RichRuns text={p.t} /></span>;
        const c = resolveHL(p.hl, isDark);
        return <mark key={i} style={{background:c.bg,color:c.text,borderRadius:2,padding:'0 2px'}}><RichRuns text={p.t} /></mark>;
      })}
    </span>
  );
}

function LbBtn({ onClick, title, style, children }) {
  return (
    <button className="mb-rq-btn" onClick={onClick} title={title} aria-label={title} style={{
      background:'rgba(255,255,255,.15)', border:'none', color:'#fff', cursor:'pointer',
      display:'flex', alignItems:'center', justifyContent:'center', ...style }}>
      {children}
    </button>
  );
}

// Swipeable / arrow-navigable lightbox — matches DetailView.js's, restyled
// in the same pass (batch 6) this file wasn't part of at the time.
function Lightbox({ images, start, onClose }) {
  const [idx, setIdx] = useState(start);
  const tx = useRef(null);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:Z.lightbox,
      display:'flex', alignItems:'center', justifyContent:'center', animation:'medbook-scrim-in 180ms ease' }}
      onTouchStart={e => { tx.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (!tx.current) return;
        const dx = e.changedTouches[0].clientX - tx.current;
        if (dx < -50) next(); else if (dx > 50) prev();
        tx.current = null;
      }}>
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
          animation:'medbook-pop-in 200ms cubic-bezier(0.4,0,0.2,1)' }}
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

function StatPill({ t, value, label, tone='neutral' }) {
  const map = {
    danger:  { color:t.danger, bg:t.dangerBg, border:t.dangerBorder },
    accent:  { color:t.accent, bg:t.navActiveBg, border:t.navActiveBorder },
    neutral: { color:t.text2,  bg:t.surface2,  border:t.border },
  };
  const c = map[tone] || map.neutral;
  return (
    <div style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:RADIUS.md,
      padding:'10px 16px', flex:'1 1 120px', minWidth:100 }}>
      <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:c.color, lineHeight:1.1 }}>{value}</div>
      <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:3, fontWeight:FONT.weight.medium }}>{label}</div>
    </div>
  );
}

export default function ReviewQueue({ allEntries, onReviewed, userSystems, initialFilterSystem, userId }) {
  const { t, isDark } = useTheme();

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
  const [filterSystem, setFilterSystem] = useState('');       // '' = every system
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
    setQueue(builtQueue);
    setIdx(0); setFlipped(false); setDone(false); setEnded(false); setSess(0);
    setSessionStarted(true);
    setElapsedSec(0); setTimerRunning(true);
    loggedRef.current = false;
    sessionMetaRef.current = meta;
  };

  // Same due/fresh definitions used everywhere else in the app (Dashboard,
  // reviewQueue.js's own buildCycledQueue) — filtering just chooses which
  // entries feed the UNCHANGED queue builder, it doesn't reimplement it.
  const filterEntries = useCallback((mode, system, difficulty = 'All') => {
    let list = Object.values(entriesRef.current).flat();
    if (system) list = list.filter(e => e.system === system);
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
    beginSession(built, { system: system || null, targetCount: limit === 'all' ? null : limit });
  };

  const backToOverview = () => { flushSessionLog(); setSessionStarted(false); };

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
    setFilterSystem(initialFilterSystem);
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
    if (filterSystem) list = list.filter(e => e.system === filterSystem);
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
    return computeSystemStats(allEntries, userSystems, t.accent)
      .filter(s => s.dueCount > 0)
      .sort((a, b) => b.dueCount - a.dueCount)
      .slice(0, 6);
  }, [allEntries, userSystems, t.accent]);

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
    } else { setIdx(p => p + 1); setFlipped(false); }
  };

  const skip = () => {
    if (idx + 1 >= total) setDone(true);
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

  const localCss = `
    .mb-rq-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-rq-btn:hover:not(:disabled) { filter: brightness(0.97); }
    body.medbook-dark .mb-rq-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .mb-rq-btn:active:not(:disabled) { transform: scale(0.96); }
    .mb-rq-rate:active { transform: scale(0.95); }
    .mb-rq-row:hover { background: ${t.surface2}; }
    .mb-rq-row:active { transform: scale(0.99); }
    .mb-rq-filter:active { transform: scale(0.95); }
    .mb-rq-fade { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }

    /* Card column + supporting column — single column (card alone, or
       card then supporting info stacked) until there's real width to work
       with, matching every other responsive grid in this app (Dashboard). */
    .mb-rq-content { display:grid; grid-template-columns:minmax(0,1fr); gap:${SPACE.xl}px; align-items:start; }
    @media (min-width:900px) {
      .mb-rq-content.has-side { grid-template-columns:minmax(0,1fr) 320px; gap:${SPACE.xl2+4}px; }
    }

    /* Scrollable study surface — the only part of the active-review screen
       that scrolls. A visible but unobtrusive scrollbar so it doesn't read
       as a cramped inner box. */
    .mb-rq-scroll { scrollbar-width:thin; scrollbar-color:${t.borderStrong} transparent; }
    .mb-rq-scroll::-webkit-scrollbar { width:8px; }
    .mb-rq-scroll::-webkit-scrollbar-thumb { background:${t.borderStrong}; border-radius:8px; }

    .mb-rq-img { transition:transform ${MOTION.fast} ${MOTION.ease}, box-shadow ${MOTION.fast} ${MOTION.ease}; }
    .mb-rq-img:hover { transform:translateY(-2px); }

    /* Anchored rating footer — a top divider plus an upward-cast shadow so
       it reads as a surface sitting above the study area, not just content
       that happens to trail the card. */
    .mb-rq-ratingbar {
      padding:${SPACE.lg}px 2px ${SPACE.xs}px; border-top:1px solid ${t.border};
      box-shadow:0 -16px 28px -20px ${isDark?'rgba(0,0,0,.6)':'rgba(15,23,42,.14)'};
    }
  `;

  // ── Overview / landing screen ────────────────────────────────────────
  if (!sessionStarted) {
    const nothingAtAll = globalDueCount === 0 && globalNewCount === 0;
    return (
      <div className="mb-rq-fade" style={{ maxWidth:640, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
        <style>{localCss}</style>

        <div style={{ marginBottom:SPACE.xl }}>
          <div style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold, color:t.text }}>Review Queue</div>
          <div style={{ fontSize:FONT.size.sm, color:t.text3, marginTop:3 }}>What should you review right now?</div>
        </div>

        {nothingAtAll ? (
          // Rewarding, intentional — not "No data."
          <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
            padding:'48px 24px', textAlign:'center', boxShadow:elevation(t,'sm') }}>
            <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background:t.okBg,
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <IconCheck size={22} style={{ color:t.ok }} />
            </div>
            <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text, marginBottom:6 }}>
              You're caught up
            </div>
            <div style={{ fontSize:FONT.size.sm, color:t.text3, lineHeight:1.6 }}>
              {globalNextDue
                ? <>No reviews are due right now. Next card is scheduled for{' '}
                    <strong style={{ color:t.text2 }}>
                      {globalNextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
                    </strong>.</>
                : 'No cards due. Rate entries here as you review them to start scheduling.'}
            </div>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:SPACE.xl }}>
              <StatPill t={t} value={dueCount} label="Due Today" tone={dueCount>0?'danger':'neutral'} />
              <StatPill t={t} value={newCount} label="New" tone={newCount>0?'accent':'neutral'} />
              {priority.length > 0 && <StatPill t={t} value={priority.length} label="Systems Need Review" tone="neutral" />}
            </div>

            {/* Priority breakdown — the biggest few due systems, real counts. */}
            {priority.length > 0 && (
              <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
                padding:SPACE.lg, boxShadow:elevation(t,'sm'), marginBottom:SPACE.xl }}>
                <div style={{ fontSize:FONT.size.xs, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                  textTransform:'uppercase', marginBottom:SPACE.sm+2, display:'flex', alignItems:'center', gap:6 }}>
                  <IconZap size={11} /> High Priority
                </div>
                <div style={{ display:'flex', flexDirection:'column' }}>
                  {priority.map((s, i) => (
                    <button key={s.name} className="mb-rq-row" onClick={() => { setFilterSystem(s.name); setFilterDifficulty('All'); startNewSession('due', s.name, 'All'); }}
                      style={{ display:'flex', alignItems:'center', gap:SPACE.sm, padding:'9px 8px',
                        borderRadius:RADIUS.sm, cursor:'pointer', background:'none', border:'none', textAlign:'left',
                        transition:`background ${MOTION.fast} ${MOTION.ease}` }}>
                      <div style={{ width:7, height:7, borderRadius:RADIUS.circle, background:s.color, flexShrink:0 }} />
                      <div style={{ flex:1, fontSize:FONT.size.sm, color:t.text2, fontWeight:FONT.weight.medium,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                      {i === 0 && <IconZap size={11} style={{ color:t.danger, flexShrink:0 }} />}
                      <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, color:t.danger,
                        background:t.dangerBg, borderRadius:RADIUS.pill, padding:'2px 8px', flexShrink:0 }}>
                        {s.dueCount}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Filters — narrow the SESSION about to start, not the summary above. */}
            <div style={{ marginBottom:SPACE.lg }}>
              <div style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                textTransform:'uppercase', marginBottom:SPACE.sm }}>Session</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {[
                  { key:'all', label:'All' },
                  { key:'due', label:`Due (${dueCount})` },
                  { key:'new', label:`New (${newCount})` },
                ].map(f => (
                  <button key={f.key} className="mb-rq-filter" onClick={()=>setFilterMode(f.key)} style={{
                    fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif',
                    background: filterMode===f.key ? t.navActiveBg : t.surface2,
                    color: filterMode===f.key ? t.navActiveText : t.text3,
                    border:`1px solid ${filterMode===f.key ? t.navActiveBorder : t.border}`,
                    borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer',
                    transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
                    {f.label}
                  </button>
                ))}
                {userSystems?.length > 0 && (
                  <select value={filterSystem} onChange={e=>setFilterSystem(e.target.value)} style={{
                    fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, fontFamily:'Inter,sans-serif',
                    background:t.surface2, color:t.text2, border:`1px solid ${t.border}`,
                    borderRadius:RADIUS.pill, padding:'8px 14px', cursor:'pointer' }}>
                    <option value="">All systems</option>
                    {userSystems.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                )}
              </div>

              {/* Difficulty — narrows the same session, same scoped counts
                  above update the moment this changes, same as the system
                  dropdown. */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>
                {['All', ...REVIEW_DIFFICULTIES].map(d => {
                  const active = filterDifficulty === d;
                  const c = d === 'All' ? t.text3 : (DIFF_COLOR[d] || t.text3);
                  return (
                    <button key={d} className="mb-rq-filter" onClick={()=>setFilterDifficulty(d)} style={{
                      fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif',
                      background: active ? `${c}1f` : t.surface2, color: active ? c : t.text3,
                      border:`1px solid ${active ? `${c}44` : t.border}`,
                      borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer',
                      transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
                      {d}
                    </button>
                  );
                })}
              </div>

              {/* Card Count — an exact block size for the session about to
                  start, not a filter (unlike mode/system/difficulty above,
                  it doesn't change dueCount/newCount). 'All' (default)
                  reproduces the exact previous behaviour: cycle through
                  everything due+new. Picking a number just slices the same
                  built queue to that length — buildCycledQueue's own
                  due/new composition and shuffling is untouched. */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginTop:8 }}>
                <button className="mb-rq-filter" onClick={()=>setCardLimit('all')} style={{
                  fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif',
                  background: cardLimit==='all' ? t.navActiveBg : t.surface2,
                  color: cardLimit==='all' ? t.navActiveText : t.text3,
                  border:`1px solid ${cardLimit==='all' ? t.navActiveBorder : t.border}`,
                  borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer',
                  transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
                  All
                </button>
                {CARD_COUNT_PRESETS.map(n => (
                  <button key={n} className="mb-rq-filter" onClick={()=>setCardLimit(n)} style={{
                    fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif',
                    background: cardLimit===n ? t.navActiveBg : t.surface2,
                    color: cardLimit===n ? t.navActiveText : t.text3,
                    border:`1px solid ${cardLimit===n ? t.navActiveBorder : t.border}`,
                    borderRadius:RADIUS.pill, padding:'8px 16px', cursor:'pointer',
                    transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
                    {n}
                  </button>
                ))}
                <input type="number" min="1" placeholder="Custom"
                  value={typeof cardLimit === 'number' && !CARD_COUNT_PRESETS.includes(cardLimit) ? cardLimit : ''}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    setCardLimit(v > 0 ? v : 'all');
                  }}
                  style={{ width:88, fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, fontFamily:'Inter,sans-serif',
                    background:t.surface2, color:t.text2, border:`1px solid ${t.border}`,
                    borderRadius:RADIUS.pill, padding:'8px 12px', outline:'none' }} />
              </div>
            </div>

            <button className="mb-rq-btn" onClick={()=>startNewSession()} style={{
              width:'100%', background:t.accent, color:'#fff', border:'none', borderRadius:RADIUS.md,
              padding:'14px 20px', fontSize:FONT.size.base, fontWeight:FONT.weight.bold, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontFamily:'Inter,sans-serif' }}>
              <IconPlay size={14} />
              {dueCount>0 ? 'Start Review' : 'Review New Cards'}
              {cardLimit !== 'all' ? ` · ${Math.min(cardLimit, dueCount+newCount)} cards` : ''}
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Paused / complete screens ─────────────────────────────────────────
  if (ended || done) {
    if (total === 0) {
      // A filtered session that matched nothing — different message from
      // "literally nothing due anywhere" on the overview screen.
      return (
        <div className="mb-rq-fade" style={{ maxWidth:480, margin:'0 auto', textAlign:'center', paddingTop:'14vh', fontFamily:'Inter,sans-serif' }}>
          <style>{localCss}</style>
          <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text, marginBottom:8 }}>
            Nothing matches this filter
          </div>
          <button className="mb-rq-btn" onClick={backToOverview} style={{
            background:t.surface3, color:t.text2, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm+1,
            padding:'10px 20px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
            marginTop:14, fontFamily:'Inter,sans-serif' }}>
            Back to Overview
          </button>
        </div>
      );
    }
    return (
      <div className="mb-rq-fade" style={{ maxWidth:480, margin:'0 auto', textAlign:'center', paddingTop:'12vh', fontFamily:'Inter,sans-serif' }}>
        <style>{localCss}</style>
        <div style={{ width:52, height:52, borderRadius:RADIUS.xl2, background: done ? t.okBg : t.surface3,
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
          {done ? <IconCheck size={22} style={{ color:t.ok }} /> : <IconPause size={20} style={{ color:t.text3 }} />}
        </div>
        <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text, marginBottom:8 }}>
          {done ? 'Session complete' : 'Paused'}
        </div>
        <div style={{ fontSize:FONT.size.base, color:t.text3, marginBottom:6 }}>
          Reviewed <strong style={{ color:t.text2 }}>{sessionDone}</strong> of <strong style={{ color:t.text2 }}>{total}</strong> cards this session
          {elapsedSec > 0 && <> in <strong style={{ color:t.text2 }}>{formatElapsed(elapsedSec)}</strong></>}.
        </div>
        {!done && (
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginBottom:26 }}>
            {total - idx - 1} card{total-idx-1!==1?'s':''} remaining. They'll be here when you come back.
          </div>
        )}
        {done && <div style={{ fontSize:FONT.size.xs, color:t.text4, marginBottom:26 }}>All cards reviewed!</div>}

        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          {!done && (
            <button className="mb-rq-btn" onClick={() => { setFlipped(false); setEnded(false); setTimerRunning(true); }} style={{
              background:t.accent, color:'#fff', border:'none', borderRadius:RADIUS.sm+1,
              padding:'11px 22px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
              display:'flex', alignItems:'center', gap:7, fontFamily:'Inter,sans-serif' }}>
              <IconPlay size={12} /> Resume
            </button>
          )}
          <button className="mb-rq-btn" onClick={()=>startNewSession()} style={{
            background: done ? t.accent : t.surface3, color: done ? '#fff' : t.text2,
            border: done ? 'none' : `1px solid ${t.border}`, borderRadius:RADIUS.sm+1,
            padding:'11px 22px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, cursor:'pointer',
            fontFamily:'Inter,sans-serif' }}>
            Start New Session
          </button>
          <button className="mb-rq-btn" onClick={backToOverview} style={{
            background:'none', color:t.text4, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm+1,
            padding:'11px 18px', fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, cursor:'pointer',
            fontFamily:'Inter,sans-serif' }}>
            Back to Overview
          </button>
        </div>
      </div>
    );
  }

  // ── Active card review ────────────────────────────────────────────────
  const color = SYS_COLOR[card?.system] || t.accent;
  // Real, per-card interval previews — computed from the same calcNext()
  // that actually persists, so these can never fabricate a number the
  // rating buttons don't back up.
  const previews = card ? RATINGS.reduce((acc, r) => {
    acc[r.key] = formatDays(calcNext(card, r.key).review_interval);
    return acc;
  }, {}) : {};
  const toneColor = {
    danger: t.danger, warn: t.warn, accent: t.accent, ok: t.ok,
  };
  const toneBg = {
    danger: isDark ? `${t.danger}22` : t.dangerBg,
    warn:   isDark ? `${t.warn}22`   : t.warnBg,
    accent: isDark ? `${t.accent}22` : t.navActiveBg,
    ok:     isDark ? `${t.ok}22`     : t.okBg,
  };

  // A side column only appears once the answer is revealed AND there's
  // actually something to put in it (images or key points) — never an
  // empty panel reserving dead space.
  const showSide = flipped && (cardHasImages || cardHasKeyPoints);

  return (
    <div className="mb-rq-fade" style={{ maxWidth:1040, margin:'0 auto', width:'100%',
      fontFamily:'Inter,sans-serif', height:'100%', display:'flex', flexDirection:'column' }}>
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
            background:'none', border:'none', color: idx===0 ? t.text4 : t.text3,
            opacity: idx===0 ? .45 : 1, padding:6, width:28, height:28, borderRadius:RADIUS.sm,
            cursor: idx===0 ? 'default' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <IconChevronLeft size={14} />
          </button>
          <span style={{ fontSize:FONT.size.sm, color:t.text3, fontWeight:FONT.weight.medium, padding:'0 2px' }}>{idx + 1} / {total}</span>
          {/* Count-up session timer — ticks via timerRunning (see its own
              effect above), so it genuinely freezes while paused instead of
              just visually looking frozen. tabular-nums keeps the digits
              from jittering the whole cluster's width as seconds roll over. */}
          <span style={{ fontSize:FONT.size.xs, color:t.text4, fontVariantNumeric:'tabular-nums', padding:'0 2px' }}
            title="Session time">
            {formatElapsed(elapsedSec)}
          </span>
          <button className="mb-headerbtn" onClick={pauseSession} title="Pause session" aria-label="Pause session" style={{
            background:'none', border:'none', color:t.text3, padding:6, width:28, height:28,
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
        <div style={{ position:'absolute', inset:0, background:t.surface3 }}>
          <div style={{ height:'100%', background:t.accent,
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
                a colour-matched glow shadow (the same "coloured glow"
                language the Add Entry CTA elsewhere in the app uses) reads
                as a lifted, deliberate surface instead of a flat bordered
                rectangle. */}
            <div key={idx} className="mb-rq-fade mb-rq-card" style={{
              background:`linear-gradient(180deg, ${color}12 0%, ${t.surface} 220px)`,
              border:`1px solid ${t.border}`, borderRadius:RADIUS.xl2, padding:SPACE.xl2,
              boxShadow:`0 24px 48px -20px ${color}45, ${elevation(t,'sm')}`, minHeight:260 }}>

              {/* System + review count — a dot + small-caps label instead of
                  a boxed pill, lighter and quieter than another bordered
                  rectangle competing with the card's own border. */}
              <div style={{ display:'flex', gap:8, marginBottom:SPACE.lg, flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:color, flexShrink:0 }} />
                <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.bold, letterSpacing:.6,
                  textTransform:'uppercase', color }}>{card.system}</span>
                {card.review_count > 0 && (
                  <span style={{ fontSize:FONT.size.xs, color:t.text4 }}>· Reviewed {card.review_count}×</span>
                )}
              </div>

              {/* Title — always visible */}
              <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text, lineHeight:1.4, marginBottom:SPACE.xl }}>
                {card.title}
              </div>

              {/* Answer */}
              {!flipped ? (
                <button className="mb-rq-btn" onClick={()=>setFlipped(true)} style={{
                  width:'100%', background:t.surface2, border:`2px dashed ${t.borderStrong}`,
                  borderRadius:RADIUS.md, padding:16, fontSize:FONT.size.md, color:t.text3,
                  cursor:'pointer', fontWeight:FONT.weight.semibold, fontFamily:'Inter,sans-serif' }}>
                  Tap to reveal <span style={{ opacity:.7, fontWeight:FONT.weight.regular }}>· Space</span>
                </button>
              ) : (
                <div className="mb-rq-fade">
                  <div style={{ height:1, background:t.border, marginBottom:SPACE.lg }} />
                  {card.notes ? (
                    // No maxHeight/scroll clamp here — this card sits inside
                    // the shared study-surface scroll area above, so a long
                    // answer gets real room instead of a small inner
                    // scrollbox. maxWidth keeps the LINE LENGTH readable
                    // even though the card column itself can be wide.
                    <div style={{ fontSize:FONT.size.lg, color:t.text2, lineHeight:1.75,
                      whiteSpace:'pre-wrap', marginBottom:SPACE.lg, maxWidth:700 }}>
                      <RenderedNotes text={card.notes} highlights={card.highlights} isDark={isDark} />
                    </div>
                  ) : (
                    <div style={{ fontSize:FONT.size.sm, color:t.text4, marginBottom:SPACE.lg }}>No notes for this entry.</div>
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
            <div className="mb-rq-side-col mb-rq-fade">
              {cardHasImages && (
                <div style={{ marginBottom: cardHasKeyPoints ? SPACE.xl : 0 }}>
                  <div style={{ fontSize:FONT.size.xs, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.bold,
                    textTransform:'uppercase', marginBottom:10 }}>
                    Images
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {card.images.map((url, i) => (
                      <img key={i} src={url} alt="" onClick={()=>setLightboxIdx(i)} className="mb-rq-img"
                        style={{ width:'100%', maxHeight:280, objectFit:'contain', borderRadius:RADIUS.xl,
                          cursor:'zoom-in', background:t.surface2, display:'block', boxShadow:elevation(t,'sm') }} />
                    ))}
                  </div>
                </div>
              )}
              {cardHasKeyPoints && <ReviewKeyPoints sections={cardAiSections} />}
            </div>
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
          <div className="mb-rq-fade mb-rq-ratingbar" style={{ position:'sticky', bottom:0, background:t.bg }}>
            <div style={{ fontSize:FONT.size.xs, color:t.text4, fontWeight:FONT.weight.semibold,
              textAlign:'center', marginBottom:SPACE.sm+2, letterSpacing:.4 }}>
              How well did you know this?
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
              {RATINGS.map(r => (
                <button key={r.key} className="mb-rq-rate mb-rq-btn" onClick={()=>rate(r.key)} style={{
                  background:toneBg[r.tone], border:'none',
                  borderRadius:RADIUS.lg, padding:'14px 4px', minHeight:64, cursor:'pointer',
                  fontFamily:'Inter,sans-serif', display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center', gap:3,
                  boxShadow:`0 2px 10px -4px ${toneColor[r.tone]}50` }}>
                  <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.bold, color:toneColor[r.tone] }}>{r.label}</div>
                  <div style={{ fontSize:FONT.size.micro, color:toneColor[r.tone], opacity:.8 }}>{previews[r.key]}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize:FONT.size.micro, color:t.text4, textAlign:'center', marginTop:8 }}>
              a · h · g · enter
            </div>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'14px 0 2px' }}>
            <button className="mb-rq-btn" onClick={skip} style={{ background:'none', border:'none',
              color:t.text4, fontSize:FONT.size.xs, cursor:'pointer',
              textDecoration:'underline', fontFamily:'Inter,sans-serif' }}>
              Skip this card
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

