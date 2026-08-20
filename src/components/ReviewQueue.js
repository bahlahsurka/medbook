import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR } from '../lib/constants';
import { buildHighlightParts, resolveHL } from '../lib/highlights';
import { useTheme, SPACE, RADIUS, FONT, MOTION, Z, elevation } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { buildCycledQueue } from '../lib/reviewQueue';
import { computeSystemStats } from '../lib/systemStats';
import { IconPlay, IconPause, IconCheck, IconChevronLeft, IconChevronRight,
  IconX, IconZap } from '../lib/icons';

// Renders notes with the same highlight colours the entry has in its system view
function RenderedNotes({ text, highlights, isDark }) {
  const parts = buildHighlightParts(text, highlights);
  return (
    <span style={{whiteSpace:'pre-wrap'}}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}>{p.t}</span>;
        const c = resolveHL(p.hl, isDark);
        return <mark key={i} style={{background:c.bg,color:c.text,borderRadius:2,padding:'0 2px'}}>{p.t}</mark>;
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

  const [queue, setQueue] = useState([]);
  const [idx, setIdx]  = useState(0);
  const [flipped, setFlipped]   = useState(false);
  const [sessionDone, setSess]  = useState(0);
  const [done, setDone]         = useState(false);
  const [ended, setEnded]       = useState(false); // user paused midway
  const [lightboxIdx, setLightboxIdx] = useState(null); // index into card.images, or null

  // Same due/fresh definitions used everywhere else in the app (Dashboard,
  // reviewQueue.js's own buildCycledQueue) — filtering just chooses which
  // entries feed the UNCHANGED queue builder, it doesn't reimplement it.
  const filterEntries = useCallback((mode, system) => {
    let list = Object.values(entriesRef.current).flat();
    if (system) list = list.filter(e => e.system === system);
    const now = new Date();
    if (mode === 'due') list = list.filter(e => e.next_review && new Date(e.next_review) <= now);
    else if (mode === 'new') list = list.filter(e => !e.next_review);
    return list;
  }, []);

  const startNewSession = useCallback((mode = filterMode, system = filterSystem) => {
    setQueue(buildCycledQueue(filterEntries(mode, system)));
    setIdx(0); setFlipped(false); setDone(false); setEnded(false); setSess(0);
    setSessionStarted(true);
  }, [filterMode, filterSystem, filterEntries]);

  const backToOverview = () => setSessionStarted(false);

  // Arriving from Insights' "Needs attention" — jump straight into a due
  // session for that system, exactly like clicking a priority row on this
  // screen's own overview already does.
  //
  // Inlines startNewSession's body instead of calling it directly: calling
  // setFilterSystem below changes startNewSession's own identity (it's a
  // useCallback that depends on filterSystem), which would make an
  // [initialFilterSystem, startNewSession] dependency array fire this
  // effect a second time right after the first — reshuffling the queue
  // twice on landing. Depending on `filterEntries` instead (stable —  it's
  // a useCallback with no deps) keeps this effect genuinely single-fire per
  // navigation without needing an exhaustive-deps suppression.
  useEffect(() => {
    if (!initialFilterSystem) return;
    setFilterSystem(initialFilterSystem);
    setQueue(buildCycledQueue(filterEntries('due', initialFilterSystem)));
    setIdx(0); setFlipped(false); setDone(false); setEnded(false); setSess(0);
    setSessionStarted(true);
  }, [initialFilterSystem, filterEntries]);

  const card = queue[idx];
  const total = queue.length;

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
  const dueCount = useMemo(() => {
    const now = new Date();
    return Object.values(allEntries).flat()
      .filter(e => e.next_review && new Date(e.next_review) <= now).length;
  }, [allEntries]);

  const newCount = useMemo(() =>
    Object.values(allEntries).flat().filter(e => !e.next_review).length,
  [allEntries]);

  const nextDue = useMemo(() => {
    const now = new Date();
    const upcoming = Object.values(allEntries).flat()
      .filter(e => e.next_review && new Date(e.next_review) > now)
      .map(e => new Date(e.next_review))
      .sort((a, b) => a - b);
    return upcoming[0] || null;
  }, [allEntries]);

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
    setSess(p => p + 1);
    if (idx + 1 >= total) setDone(true);
    else { setIdx(p => p + 1); setFlipped(false); }
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

  const pauseSession = () => setEnded(true);

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
  `;

  // ── Overview / landing screen ────────────────────────────────────────
  if (!sessionStarted) {
    const nothingAtAll = dueCount === 0 && newCount === 0;
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
              {nextDue
                ? <>No reviews are due right now. Next card is scheduled for{' '}
                    <strong style={{ color:t.text2 }}>
                      {nextDue.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
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
                    <button key={s.name} className="mb-rq-row" onClick={() => { setFilterSystem(s.name); startNewSession('due', s.name); }}
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
            </div>

            <button className="mb-rq-btn" onClick={()=>startNewSession()} style={{
              width:'100%', background:t.accent, color:'#fff', border:'none', borderRadius:RADIUS.md,
              padding:'14px 20px', fontSize:FONT.size.base, fontWeight:FONT.weight.bold, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontFamily:'Inter,sans-serif' }}>
              <IconPlay size={14} /> {dueCount>0 ? 'Start Review' : 'Review New Cards'}
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
          Reviewed <strong style={{ color:t.text2 }}>{sessionDone}</strong> of <strong style={{ color:t.text2 }}>{total}</strong> cards this session.
        </div>
        {!done && (
          <div style={{ fontSize:FONT.size.xs, color:t.text4, marginBottom:26 }}>
            {total - idx - 1} card{total-idx-1!==1?'s':''} remaining — they'll be here when you come back.
          </div>
        )}
        {done && <div style={{ fontSize:FONT.size.xs, color:t.text4, marginBottom:26 }}>All cards reviewed!</div>}

        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          {!done && (
            <button className="mb-rq-btn" onClick={() => { setFlipped(false); setEnded(false); }} style={{
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

  return (
    <div className="mb-rq-fade" style={{ maxWidth:620, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <style>{localCss}</style>

      {lightboxIdx !== null && card?.images?.length > 0 && (
        <Lightbox images={card.images} start={lightboxIdx} onClose={()=>setLightboxIdx(null)} />
      )}

      {/* Header — deliberately lean: title, a prev/counter/pause cluster,
          and the progress bar below carry all the state that used to be
          spread across a title row PLUS a separate 3-pill stats row
          (due/reviewed/%done, redundant with the bar and the counter here). */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:SPACE.md }}>
        <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.text }}>Review Queue</div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <button className="mb-rq-btn" onClick={goPrev} disabled={idx===0}
            title="Previous card" aria-label="Previous card" style={{
            fontSize:FONT.size.xs, background:t.surface2, border:`1px solid ${t.border}`,
            color: idx===0 ? t.text4 : t.text3, opacity: idx===0 ? .45 : 1,
            borderRadius:RADIUS.sm, width:30, height:30, cursor: idx===0 ? 'default' : 'pointer',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <IconChevronLeft size={13} />
          </button>
          <span style={{ fontSize:FONT.size.sm, color:t.text3, fontWeight:FONT.weight.medium, padding:'0 2px' }}>{idx + 1} / {total}</span>
          <button className="mb-rq-btn" onClick={pauseSession} title="Pause session" aria-label="Pause session" style={{
            fontSize:FONT.size.xs, background:t.surface2, border:`1px solid ${t.border}`, color:t.text3,
            borderRadius:RADIUS.sm, width:30, height:30, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <IconPause size={12} />
          </button>
        </div>
      </div>

      {/* Progress bar — the single source of "how far am I", instead of a
          bar plus a "%done" pill saying the same thing two ways. */}
      <div style={{ height:5, background:t.surface3, borderRadius:RADIUS.sm, marginBottom:SPACE.xl }}>
        <div style={{ height:'100%', background:t.accent, borderRadius:RADIUS.sm,
          width:`${progress}%`, transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
      </div>

      {/* Card — the visual focus, minimal chrome around it */}
      <div key={idx} className="mb-rq-fade" style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
        borderTop:`4px solid ${color}`, padding:SPACE.xl2, marginBottom:SPACE.md,
        boxShadow:elevation(t,'sm'), minHeight:220 }}>

        {/* System + review count — difficulty tag intentionally omitted,
            same call made for entries throughout the app (DetailView/
            EntryCard). */}
        <div style={{ display:'flex', gap:8, marginBottom:SPACE.lg, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.medium, background:`${color}12`, color,
            borderRadius:RADIUS.sm-2, padding:'2px 8px', border:`1px solid ${color}25` }}>
            {card.system}
          </span>
          {card.review_count > 0 && (
            <span style={{ fontSize:FONT.size.xs, color:t.text4 }}>Reviewed {card.review_count}×</span>
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
              <div style={{ fontSize:FONT.size.md, color:t.text2, lineHeight:1.8,
                whiteSpace:'pre-wrap', marginBottom:SPACE.lg, maxHeight:260, overflowY:'auto' }}>
                <RenderedNotes text={card.notes} highlights={card.highlights} isDark={isDark} />
              </div>
            ) : (
              <div style={{ fontSize:FONT.size.sm, color:t.text4, marginBottom:SPACE.lg }}>No notes for this entry.</div>
            )}
            {card.images?.length > 0 && (
              <div style={{ display:'flex', gap:8, overflowX:'auto',
                WebkitOverflowScrolling:'touch', paddingBottom:4, scrollSnapType:'x mandatory' }}>
                {card.images.map((url, i) => (
                  <img key={i} src={url} alt="" onClick={()=>setLightboxIdx(i)}
                    style={{ height:80, width:'auto', borderRadius:RADIUS.sm,
                      border:`1px solid ${t.border}`, cursor:'zoom-in', flexShrink:0,
                      scrollSnapAlign:'start' }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rating buttons — large, touch-friendly, real interval previews */}
      {flipped && (
        <div className="mb-rq-fade">
          <div style={{ fontSize:FONT.size.xs, color:t.text4, fontWeight:FONT.weight.semibold,
            textAlign:'center', marginBottom:SPACE.sm+2, letterSpacing:.4 }}>
            How well did you know this?
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
            {RATINGS.map(r => (
              <button key={r.key} className="mb-rq-rate mb-rq-btn" onClick={()=>rate(r.key)} style={{
                background:toneBg[r.tone], border:`1px solid ${toneColor[r.tone]}40`,
                borderRadius:RADIUS.md, padding:'14px 4px', minHeight:64, cursor:'pointer',
                fontFamily:'Inter,sans-serif', display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center', gap:3 }}>
                <div style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.bold, color:toneColor[r.tone] }}>{r.label}</div>
                <div style={{ fontSize:FONT.size.micro, color:toneColor[r.tone], opacity:.8 }}>{previews[r.key]}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize:FONT.size.micro, color:t.text4, textAlign:'center', marginTop:8 }}>
            a · h · g · enter
          </div>
        </div>
      )}

      {/* Skip */}
      {!flipped && (
        <div style={{ textAlign:'center', marginTop:SPACE.md }}>
          <button className="mb-rq-btn" onClick={skip} style={{ background:'none', border:'none',
            color:t.text4, fontSize:FONT.size.xs, cursor:'pointer',
            textDecoration:'underline', fontFamily:'Inter,sans-serif' }}>
            Skip this card
          </button>
        </div>
      )}
    </div>
  );
}

