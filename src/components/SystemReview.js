import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DIFF_COLOR } from '../lib/constants';
import { buildHighlightParts, resolveHL } from '../lib/highlights';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { buildCycledQueue, buildCycledQueueWithScheduled } from '../lib/reviewQueue';
import { normalizeSections } from '../services/ai';
import { loadSession, saveSession, clearSession, newSessionId } from '../lib/reviewSessionStore';
import ReviewKeyPoints, { hasKeyPoints } from './ReviewKeyPoints';
import { IconX } from '../lib/icons';
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

// Arrow-navigable lightbox — matches the one in DetailView.js. Swipe-to-
// navigate is deliberately NOT wired up here (unlike DetailView.js's): in
// review mode people routinely pinch-zoom into an image and then pan
// around it, and a horizontal pan of more than 50px was being read as a
// swipe and yanking them to the next/previous image mid-pan. Prev/Next
// stay available via the on-screen buttons.
function Lightbox({ images, start, onClose }) {
  const [idx, setIdx] = useState(start);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:400,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <button onClick={onClose} style={{ position:'absolute', top:16, right:20,
        background:'rgba(255,255,255,.15)', border:'none', color:'#fff', fontSize:20,
        cursor:'pointer', width:40, height:40, borderRadius:'50%',
        display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
      {images.length > 1 && <>
        <div style={{ position:'absolute', top:20, left:'50%', transform:'translateX(-50%)',
          color:'#fff', fontSize:13, background:'rgba(0,0,0,.5)', padding:'4px 14px', borderRadius:20 }}>
          {idx + 1}/{images.length}
        </div>
        <button onClick={prev} style={{ position:'absolute', left:12, background:'rgba(255,255,255,.15)',
          border:'none', color:'#fff', fontSize:28, cursor:'pointer', width:44, height:44,
          borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>‹</button>
        <button onClick={next} style={{ position:'absolute', right:12, background:'rgba(255,255,255,.15)',
          border:'none', color:'#fff', fontSize:28, cursor:'pointer', width:44, height:44,
          borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>›</button>
      </>}
      <img src={images[idx]} alt=""
        style={{ maxWidth:'90vw', maxHeight:'88vh', borderRadius:8, objectFit:'contain', display:'block' }}
        onClick={e => e.stopPropagation()} />
      <div onClick={onClose} style={{ position:'absolute', inset:0, zIndex:-1 }} />
    </div>
  );
}

// Same four ratings ReviewQueue.js uses, by tone rather than a literal
// hardcoded colour/hint per rating — toneColor/toneBg below resolve each
// tone against the current theme, and the hint under each button is a REAL
// per-card interval preview (formatDays(calcNext(...))), not a generic
// "~1 week" that doesn't reflect this card's actual scheduling state.
const RATINGS = [
  { key:'again', label:'Again', tone:'danger' },
  { key:'hard',  label:'Hard',  tone:'warn'   },
  { key:'good',  label:'Good',  tone:'accent' },
  { key:'easy',  label:'Easy',  tone:'ok'     },
];

// Presentation-only — reads calcNext's OWN output, same as ReviewQueue.js's
// identical helper, so the label can never drift from what actually saves.
function formatDays(d) {
  if (d < 1) return `${Math.round(d * 24)}h`;
  if (d < 30) return `${d}d`;
  if (d < 365) return `${(d / 30).toFixed(1)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

function calcNext(entry, rating) {
  let interval = entry.review_interval || 1;
  let ef = entry.ease_factor || 2.5;
  if      (rating==='again') { interval=1; }
  else if (rating==='hard')  { interval=Math.max(1,Math.round(interval*1.2)); ef=Math.max(1.3,ef-0.15); }
  else if (rating==='good')  { interval=Math.max(1,Math.round(interval*ef)); }
  else if (rating==='easy')  { interval=Math.max(1,Math.round(interval*ef*1.3)); ef=Math.min(4,ef+0.1); }
  const next = new Date();
  next.setDate(next.getDate() + interval);
  return {
    review_interval: interval,
    ease_factor: parseFloat(ef.toFixed(2)),
    next_review: next.toISOString(),
    review_count: (entry.review_count||0)+1,
    last_reviewed: new Date().toISOString()
  };
}

export default function SystemReview({ system, entries, color, onReviewed, onClose, userId }) {
  const { t, isDark } = useTheme();

  // Latest entries available WITHOUT rebuilding the queue on every rating.
  // Rebuilding mid-session made the list shift under the index and SKIP cards.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Resumable sessions — see reviewSessionStore.js's own header comment.
  // One independent saved session per system (this modal can be opened for
  // any system at any time), keyed off the `system` prop, which is stable
  // for this component's whole mount.
  const sessionScope = `system:${system}`;
  // Read once, at mount, via a lazy useState initializer — this component
  // fully unmounts when the modal closes (unlike Review Queue's own
  // overview screen, which stays mounted), so a fresh mount is always
  // exactly "just opened this system's review", making a one-time read
  // correct here (no later re-entry into the same mount to keep in sync
  // with, unlike Review Queue's `pendingResume`).
  const [pendingResume] = useState(() => loadSession(userId, sessionScope));
  // No prompt unless there's actual progress worth asking about — a saved
  // session that never got past card 1 is just silently reused/extended.
  const [resumeChoice, setResumeChoice] = useState(() => (
    pendingResume && (pendingResume.reviewed > 0 || pendingResume.idx > 0)
      && Array.isArray(pendingResume.entryIds) && pendingResume.entryIds.length
      ? null
      : 'new'
  ));
  const sessionIdRef = useRef(null);
  const createdAtRef = useRef(null);

  // Queue is snapshotted at session start — stable while you work through
  // it. Starts `null` ("not yet decided") until resumeChoice resolves, via
  // the effect below — unlike the old unconditional lazy-init, which never
  // left room for a resume path to supply it instead.
  const [queue, setQueue] = useState(null);
  const [idx, setIdx]       = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]     = useState(false);
  const [ended, setEnded]   = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [lightboxIdx, setLightboxIdx] = useState(null); // index into card.images, or null

  // Explicit rebuild — from the latest data — so a new session reflects what you
  // just rated instead of replaying it. Always obsoletes any saved session.
  const startNewSession = useCallback((includeScheduled = false) => {
    clearSession(userId, sessionScope);
    sessionIdRef.current = newSessionId();
    createdAtRef.current = new Date().toISOString();
    setQueue(includeScheduled
      ? buildCycledQueueWithScheduled(entriesRef.current)
      : buildCycledQueue(entriesRef.current));
    setIdx(0); setFlipped(false); setDone(false); setEnded(false); setReviewed(0);
  }, [userId, sessionScope]);

  // Resolve resumeChoice into an actual queue — resume re-maps the saved,
  // frozen entry-id order onto the CURRENT entries (never a second fetch,
  // see reviewSessionStore.js's own header comment), dropping any id
  // that's since been deleted. Guards against the same race
  // studySessionStore's imported-deck resume does: if the app was
  // interrupted while a rating's Supabase write was in flight, the write
  // can still have reached the server even though `idx` never advanced
  // locally — detected by comparing the resumed card's own `last_reviewed`
  // against this session's last confirmed activity, stepping one card
  // forward instead of replaying an already-saved rating.
  useEffect(() => {
    if (resumeChoice === null) return; // waiting on the user's resume/start-new choice
    if (resumeChoice !== 'resume' || !pendingResume) { startNewSession(false); return; }
    const byId = new Map(entriesRef.current.map(e => [e.id, e]));
    const ordered = (pendingResume.entryIds || []).map(id => byId.get(id)).filter(Boolean);
    if (ordered.length === 0) {
      startNewSession(false);
      return;
    }
    let restoredIdx = Math.min(pendingResume.idx || 0, ordered.length - 1);
    const atSavedIdx = ordered[restoredIdx];
    if (atSavedIdx?.last_reviewed && pendingResume.lastActiveAt
        && new Date(atSavedIdx.last_reviewed) > new Date(pendingResume.lastActiveAt)) {
      restoredIdx = Math.min(restoredIdx + 1, ordered.length - 1);
    }
    sessionIdRef.current = pendingResume.sessionId || newSessionId();
    createdAtRef.current = pendingResume.createdAt || pendingResume.lastActiveAt || new Date().toISOString();
    setQueue(ordered);
    setIdx(restoredIdx);
    setReviewed(pendingResume.reviewed || 0);
    // `pendingResume`/`startNewSession` are intentionally not listed as
    // dependencies — `pendingResume` is a mount-stable lazy-init value (see
    // above), same reasoning StudySession.js's own equivalent effect uses.
  }, [resumeChoice]);

  // Persist proactively on every meaningful change, same reasoning as
  // Review Queue's own identical effect (see its own comment) — mobile
  // browsers don't reliably fire a single "leaving" event, so this can't
  // be the only mechanism.
  const sessionSnapshotRef = useRef(null);
  useEffect(() => {
    if (!queue || !queue.length || done || !sessionIdRef.current) {
      sessionSnapshotRef.current = null;
      return;
    }
    const snapshot = {
      sessionId: sessionIdRef.current,
      entryIds: queue.map(e => e.id),
      idx, reviewed,
      status: 'active',
      createdAt: createdAtRef.current || new Date().toISOString(),
    };
    sessionSnapshotRef.current = snapshot;
    saveSession(userId, sessionScope, snapshot);
  }, [userId, sessionScope, queue, idx, reviewed, done]);

  // Belt-and-suspenders flush for exactly the mobile lifecycle events this
  // exists for — see Review Queue's identical effect for the full reasoning.
  useEffect(() => {
    const flush = () => { if (sessionSnapshotRef.current) saveSession(userId, sessionScope, sessionSnapshotRef.current); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [userId, sessionScope]);

  // Live counts from current data (not the frozen queue).
  const upcoming = useMemo(() => {
    const now = new Date();
    return entries.filter(e => e.next_review && new Date(e.next_review) > now);
  }, [entries]);
  const nextDue = useMemo(() => {
    if (upcoming.length === 0) return null;
    return upcoming
      .map(e => new Date(e.next_review))
      .sort((a,b) => a - b)[0];
  }, [upcoming]);

  const card  = queue ? queue[idx] : undefined;
  const total = queue ? queue.length : 0;

  // The existing AI Analysis output for this card, if any — never generated
  // here, only read back (same normalizeSections ReviewQueue.js/DetailView.js
  // use), so an old/partial row can't crash this.
  const cardAiSections = useMemo(() => normalizeSections(card?.ai_sections), [card]);
  const cardHasKeyPoints = hasKeyPoints(cardAiSections);
  const cardHasImages = card?.images?.length > 0;

  // Keyboard: Space=reveal, Enter=Easy, g=Good, h=Hard, a=Again.
  useReviewKeyboard(!done && !ended && !!card && lightboxIdx===null, {
    flipped, onFlip: () => setFlipped(true),
    onAgain: () => rate('again'), onHard: () => rate('hard'),
    onGood: () => rate('good'),   onEasy: () => rate('easy'),
  });
  const progress = total > 0 ? Math.round((reviewed/total)*100) : 0;
  const dc = DIFF_COLOR[card?.difficulty] || '#6b7280';

  const rate = async (rating) => {
    if (!card) return;
    const updates = calcNext(card, rating);
    const { error } = await supabase.from('entries').update(updates).eq('id', card.id);
    if (error) {
      // Surface the failure instead of silently losing the review (e.g. missing DB columns).
      alert(`Couldn't save this review: ${error.message}\n\nIf this mentions a missing column, run the SM-2 migration in Supabase.`);
      return; // don't advance — let the user retry after fixing
    }
    onReviewed({ ...card, ...updates });
    // Same fire-and-forget analytics write ReviewQueue.js's rate() makes —
    // keeps review_log complete across both review screens so Dashboard's
    // "reviewed today" count doesn't undercount reviews done from here.
    if (userId) {
      supabase.from('review_log').insert({
        user_id: userId, entry_id: card.id, system: card.system, rating,
      }).then(({ error: logError }) => {
        if (logError && process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[SystemReview] review_log insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', logError.message);
        }
      });
    }
    setReviewed(p => p+1);
    if (idx+1 >= total) { setDone(true); clearSession(userId, sessionScope); }
    else { setIdx(p=>p+1); setFlipped(false); }
  };

  const skip = () => {
    if (idx+1 >= total) { setDone(true); clearSession(userId, sessionScope); }
    else { setIdx(p=>p+1); setFlipped(false); }
  };

  // No entries at all in this system
  if (entries.length === 0) return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:t.surface,borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center',boxShadow:`0 8px 32px ${t.shadowStrong}`}}>
        <div style={{fontSize:40,marginBottom:12}}>📋</div>
        <div style={{fontSize:16,fontWeight:700,color:t.text,marginBottom:8}}>No entries in {system}</div>
        <div style={{fontSize:14,color:t.text3,marginBottom:20}}>Add some entries first.</div>
        <button onClick={onClose} style={B(t.surface3,t.text2)}>Close</button>
      </div>
    </div>
  );

  // A saved session exists with real progress — ask before silently either
  // resuming OR discarding it. No separate overview screen exists here
  // (unlike Review Queue) for a banner to live on, so this mirrors
  // StudySession.js's own blocking resume-or-new prompt instead.
  if (resumeChoice === null) return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:t.surface,borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center',boxShadow:`0 8px 32px ${t.shadowStrong}`}}>
        <div style={{fontSize:40,marginBottom:12}}>↩️</div>
        <div style={{fontSize:16,fontWeight:700,color:t.text,marginBottom:8}}>Resume your last session?</div>
        <div style={{fontSize:14,color:t.text3,marginBottom:20}}>
          You reviewed <strong>{pendingResume.reviewed || 0}</strong> of <strong>{pendingResume.entryIds.length}</strong> {system} cards last time.
        </div>
        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          <button onClick={()=>setResumeChoice('resume')} style={B(t.accent)}>▶ Resume</button>
          <button onClick={()=>{ clearSession(userId, sessionScope); setResumeChoice('new'); }} style={B(t.surface3,t.text2)}>
            Start New
          </button>
        </div>
      </div>
    </div>
  );

  // resumeChoice is resolved but the effect above hasn't set a queue yet —
  // a one-frame guard, not a real loading state.
  if (queue === null) return null;

  // Entries exist but none are due right now — scheduling is working as intended.
  if (total === 0) return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:t.surface,borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center',boxShadow:`0 8px 32px ${t.shadowStrong}`}}>
        <div style={{fontSize:40,marginBottom:12}}>✅</div>
        <div style={{fontSize:16,fontWeight:700,color:t.text,marginBottom:8}}>All caught up in {system}</div>
        <div style={{fontSize:14,color:t.text3,marginBottom:6}}>
          Nothing due right now. {upcoming.length} card{upcoming.length!==1?'s':''} scheduled for later.
        </div>
        {nextDue && (
          <div style={{fontSize:12,color:t.text4,marginBottom:20}}>
            Next due {nextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
          </div>
        )}
        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          <button onClick={()=>startNewSession(true)} style={B(t.accent)}>Review all anyway</button>
          <button onClick={onClose} style={B(t.surface3,t.text2)}>Close</button>
        </div>
      </div>
    </div>
  );

  if (done || ended) return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:t.surface,borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center',boxShadow:`0 8px 32px ${t.shadowStrong}`}}>
        <div style={{fontSize:40,marginBottom:12}}>{done?'✅':'⏸️'}</div>
        <div style={{fontSize:16,fontWeight:700,color:t.text,marginBottom:8}}>
          {done?'Session complete!':'Session ended'}
        </div>
        <div style={{fontSize:14,color:t.text3,marginBottom:20}}>
          Reviewed <strong>{reviewed}</strong> of <strong>{total}</strong> {system} cards.
        </div>
        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          {!done && (
            <button onClick={()=>setEnded(false)} style={B(t.accent)}>Resume</button>
          )}
          <button onClick={()=>startNewSession(false)} style={B(done?t.accent:t.surface3, done?'#fff':t.text2)}>
            Start New Session
          </button>
          <button onClick={onClose} style={B(t.surface3,t.text2)}>Back to {system}</button>
        </div>
      </div>
    </div>
  );

  // Real, per-card interval previews — computed from the same calcNext()
  // that actually persists, so these can never fabricate a number the
  // rating buttons don't back up. Same approach ReviewQueue.js's rating
  // row uses.
  const previews = card ? RATINGS.reduce((acc, r) => {
    acc[r.key] = formatDays(calcNext(card, r.key).review_interval);
    return acc;
  }, {}) : {};
  const toneColor = { danger:t.danger, warn:t.warn, accent:t.accent, ok:t.ok };
  const toneBg = {
    danger: isDark ? `${t.danger}22` : t.dangerBg,
    warn:   isDark ? `${t.warn}22`   : t.warnBg,
    accent: isDark ? `${t.accent}22` : t.navActiveBg,
    ok:     isDark ? `${t.ok}22`     : t.okBg,
  };

  // A side column only appears once the answer is revealed AND there's
  // actually something to put in it (images or key points) — same rule
  // ReviewQueue.js uses, never an empty panel reserving dead space.
  const showSide = flipped && (cardHasImages || cardHasKeyPoints);

  const localCss = `
    .mb-sr-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-sr-btn:hover:not(:disabled) { filter: brightness(0.97); }
    body.medbook-dark .mb-sr-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .mb-sr-btn:active:not(:disabled) { transform: scale(0.96); }
    .mb-sr-rate:active { transform: scale(0.95); }
    .mb-sr-content { display:grid; grid-template-columns:minmax(0,1fr); gap:${SPACE.xl}px; align-items:start; }
    @media (min-width:760px) {
      .mb-sr-content.has-side { grid-template-columns:minmax(0,1fr) 280px; gap:${SPACE.xl2}px; }
    }
    .mb-sr-scroll { scrollbar-width:thin; scrollbar-color:${t.borderStrong} transparent; }
    .mb-sr-scroll::-webkit-scrollbar { width:8px; }
    .mb-sr-scroll::-webkit-scrollbar-thumb { background:${t.borderStrong}; border-radius:8px; }
    .mb-sr-img { transition:transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-sr-img:hover { transform:translateY(-2px); }
    .mb-sr-ratingbar {
      padding:${SPACE.lg}px 2px ${SPACE.xs}px; border-top:1px solid ${t.border};
      box-shadow:0 -16px 28px -20px ${isDark?'rgba(0,0,0,.6)':'rgba(15,23,42,.14)'};
    }
  `;

  return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <style>{localCss}</style>

      {lightboxIdx !== null && card?.images?.length > 0 && (
        <Lightbox images={card.images} start={lightboxIdx} onClose={()=>setLightboxIdx(null)} />
      )}

      {/* Wider than before (900 vs the old 580) — room for the card +
          supporting column, same two-column study surface ReviewQueue.js
          uses, just presented as a focused modal instead of a full page. */}
      <div style={{background:t.surface,borderRadius:RADIUS.xl2,width:'100%',maxWidth:900,
        maxHeight:'92vh',display:'flex',flexDirection:'column',
        boxShadow:`0 8px 32px ${t.shadowStrong}`}}>

        {/* Header — lean: title + a simple counter, trusting the progress
            bar below for "how far am I" rather than restating it in text. */}
        <div style={{padding:`${SPACE.lg}px ${SPACE.xl}px ${SPACE.md}px`,
          display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontSize:FONT.size.md,fontWeight:FONT.weight.bold,color:t.text}}>
              Reviewing: <span style={{color}}>{system}</span>
            </div>
            <div style={{fontSize:FONT.size.xs,color:t.text4,marginTop:2}}>
              {idx+1} / {total}
            </div>
          </div>
          <button className="mb-sr-btn" onClick={()=>setEnded(true)} title="End session" aria-label="End session"
            style={{background:t.surface2,border:'none',color:t.text3,borderRadius:RADIUS.sm,
            width:30,height:30,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <IconX size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{height:4,background:t.surface3,flexShrink:0,margin:`0 ${SPACE.xl}px`,
          borderRadius:RADIUS.sm,overflow:'hidden',width:`calc(100% - ${SPACE.xl*2}px)`}}>
          <div style={{height:'100%',background:color,width:`${progress}%`,
            transition:`width ${MOTION.slow} ${MOTION.ease}`}} />
        </div>

        {/* Scrollable study surface — same sticky-rating-footer-inside-
            scroll-container pattern as ReviewQueue.js: sits right after a
            short card (no dead gap), clings to the bottom of the visible
            area once a long answer actually needs scrolling. */}
        <div className="mb-sr-scroll" style={{flex:1,minHeight:0,overflowY:'auto',padding:`${SPACE.lg}px ${SPACE.xl}px`}}>
          <div className={`mb-sr-content${showSide?' has-side':''}`}>
            <div className="mb-sr-card-col" style={showSide?undefined:{maxWidth:620,margin:'0 auto',width:'100%'}}>

              {/* Card — the same colour-tinted wash + colour-matched glow
                  shadow treatment as ReviewQueue.js's card, instead of a
                  flat bordered rectangle. */}
              <div key={idx} style={{
                background:`linear-gradient(180deg, ${color}12 0%, ${t.surface} 180px)`,
                border:`1px solid ${t.border}`, borderRadius:RADIUS.xl2, padding:SPACE.xl,
                boxShadow:`0 20px 40px -18px ${color}45, ${elevation(t,'sm')}`, marginBottom:SPACE.md }}>

                <div style={{display:'flex',gap:8,marginBottom:SPACE.lg,flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{width:7,height:7,borderRadius:RADIUS.circle,background:dc,flexShrink:0}} />
                  <span style={{fontSize:FONT.size.xs,fontWeight:FONT.weight.bold,letterSpacing:.6,
                    textTransform:'uppercase',color:dc}}>{card.difficulty}</span>
                  {card.review_count>0 && (
                    <span style={{fontSize:FONT.size.xs,color:t.text4}}>· Reviewed {card.review_count}×</span>
                  )}
                  {card.next_review && new Date(card.next_review)<=new Date() && (
                    <span style={{fontSize:FONT.size.xs,color:t.danger,fontWeight:FONT.weight.semibold}}>· Due</span>
                  )}
                  {!card.next_review && (
                    <span style={{fontSize:FONT.size.xs,color:t.accent,fontWeight:FONT.weight.semibold}}>· New</span>
                  )}
                </div>

                <div style={{fontSize:FONT.size.xl,fontWeight:FONT.weight.bold,color:t.text,lineHeight:1.4,marginBottom:SPACE.xl}}>
                  {card.title}
                </div>

                {!flipped ? (
                  <button className="mb-sr-btn" onClick={()=>setFlipped(true)} style={{width:'100%',
                    background:t.surface2,border:`2px dashed ${t.borderStrong}`,borderRadius:RADIUS.md,
                    padding:16,fontSize:FONT.size.md,color:t.text3,cursor:'pointer',
                    fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'}}>
                    Tap to reveal <span style={{opacity:.7,fontWeight:FONT.weight.regular}}>· Space</span>
                  </button>
                ) : (
                  <div>
                    <div style={{height:1,background:t.border,marginBottom:SPACE.lg}} />
                    {card.notes ? (
                      <div style={{fontSize:FONT.size.lg,color:t.text2,lineHeight:1.75,
                        whiteSpace:'pre-wrap',marginBottom:SPACE.lg,maxWidth:620}}>
                        <RenderedNotes text={card.notes} highlights={card.highlights} isDark={isDark} />
                      </div>
                    ) : (
                      <div style={{fontSize:FONT.size.sm,color:t.text4,marginBottom:SPACE.lg}}>No notes.</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Supporting column — real images at a size worth looking at,
                then this entry's existing AI key points, if any. Reuses the
                recovered space beside the card rather than leaving it empty. */}
            {showSide && (
              <div className="mb-sr-side-col">
                {cardHasImages && (
                  <div style={{marginBottom: cardHasKeyPoints ? SPACE.xl : 0}}>
                    <div style={{fontSize:FONT.size.xs,color:t.text4,letterSpacing:.8,fontWeight:FONT.weight.bold,
                      textTransform:'uppercase',marginBottom:10}}>
                      Images
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:12}}>
                      {card.images.map((url,i)=>(
                        <img key={i} src={url} alt="" onClick={()=>setLightboxIdx(i)} className="mb-sr-img"
                          style={{width:'100%',maxHeight:240,objectFit:'contain',borderRadius:RADIUS.xl,
                            cursor:'zoom-in',background:t.surface2,display:'block',boxShadow:elevation(t,'sm')}} />
                      ))}
                    </div>
                  </div>
                )}
                {cardHasKeyPoints && <ReviewKeyPoints sections={cardAiSections} />}
              </div>
            )}
          </div>

          {/* Rating bar — sticky to the bottom of this scroll container
              (not the viewport), so a short card doesn't leave a dead gap
              and a long one keeps the buttons reachable without hunting. */}
          {flipped ? (
            <div className="mb-sr-ratingbar" style={{position:'sticky',bottom:0,background:t.surface,marginTop:SPACE.lg}}>
              <div style={{fontSize:FONT.size.xs,color:t.text4,fontWeight:FONT.weight.semibold,
                textAlign:'center',marginBottom:SPACE.sm+2,letterSpacing:.4}}>
                How well did you know this?
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                {RATINGS.map(r=>(
                  <button key={r.key} className="mb-sr-rate mb-sr-btn" onClick={()=>rate(r.key)} style={{
                    background:toneBg[r.tone], border:'none',
                    borderRadius:RADIUS.lg, padding:'14px 4px', minHeight:64, cursor:'pointer',
                    fontFamily:'Inter,sans-serif', display:'flex', flexDirection:'column',
                    alignItems:'center', justifyContent:'center', gap:3,
                    boxShadow:`0 2px 10px -4px ${toneColor[r.tone]}50`}}>
                    <div style={{fontSize:FONT.size.sm,fontWeight:FONT.weight.bold,color:toneColor[r.tone]}}>{r.label}</div>
                    <div style={{fontSize:FONT.size.micro,color:toneColor[r.tone],opacity:.8}}>{previews[r.key]}</div>
                  </button>
                ))}
              </div>
              <div style={{fontSize:FONT.size.micro,color:t.text4,textAlign:'center',marginTop:8}}>
                a · h · g · enter
              </div>
            </div>
          ) : (
            <div style={{textAlign:'center',marginTop:SPACE.md}}>
              <button className="mb-sr-btn" onClick={skip} style={{background:'none',border:'none',
                color:t.text4,fontSize:FONT.size.xs,cursor:'pointer',
                textDecoration:'underline',fontFamily:'Inter,sans-serif'}}>
                Skip this card
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function B(bg, color='#fff') {
  return {background:bg,color,border:'none',borderRadius:8,padding:'10px 20px',
    fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'Inter,sans-serif'};
}
