import { useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DIFF_COLOR } from '../lib/constants';
import { buildHighlightParts, resolveHL } from '../lib/highlights';
import { useTheme } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { buildCycledQueue, buildCycledQueueWithScheduled } from '../lib/reviewQueue';

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

// Swipeable / arrow-navigable lightbox — matches the one in DetailView.js
function Lightbox({ images, start, onClose }) {
  const [idx, setIdx] = useState(start);
  const tx = useRef(null);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.92)', zIndex:400,
      display:'flex', alignItems:'center', justifyContent:'center' }}
      onTouchStart={e => { tx.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (!tx.current) return;
        const dx = e.changedTouches[0].clientX - tx.current;
        if (dx < -50) next(); else if (dx > 50) prev();
        tx.current = null;
      }}>
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

const RATINGS = [
  { key:'again', label:'Again',  color:'#dc2626', bg:'#fef2f2', hint:'<1 day'  },
  { key:'hard',  label:'Hard',   color:'#d97706', bg:'#fffbeb', hint:'~3 days' },
  { key:'good',  label:'Good',   color:'#2563eb', bg:'#eff6ff', hint:'~1 week' },
  { key:'easy',  label:'Easy',   color:'#16a34a', bg:'#f0fdf4', hint:'2 weeks' },
];

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

export default function SystemReview({ system, entries, color, onReviewed, onClose }) {
  const { t, isDark } = useTheme();

  // Latest entries available WITHOUT rebuilding the queue on every rating.
  // Rebuilding mid-session made the list shift under the index and SKIP cards.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Queue is snapshotted at session start — stable while you work through it.
  const [queue, setQueue] = useState(() => buildCycledQueue(entries));
  const [idx, setIdx]       = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]     = useState(false);
  const [ended, setEnded]   = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [lightboxIdx, setLightboxIdx] = useState(null); // index into card.images, or null

  // Explicit rebuild — from the latest data — so a new session reflects what you
  // just rated instead of replaying it.
  const startNewSession = useCallback((includeScheduled = false) => {
    setQueue(includeScheduled
      ? buildCycledQueueWithScheduled(entriesRef.current)
      : buildCycledQueue(entriesRef.current));
    setIdx(0); setFlipped(false); setDone(false); setEnded(false); setReviewed(0);
  }, []);

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

  const card  = queue[idx];
  const total = queue.length;

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
    setReviewed(p => p+1);
    if (idx+1 >= total) setDone(true);
    else { setIdx(p=>p+1); setFlipped(false); }
  };

  const skip = () => {
    if (idx+1 >= total) setDone(true);
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

  // Entries exist but none are due right now — scheduling is working as intended.
  if (total === 0) return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:t.surface,borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center',boxShadow:`0 8px 32px ${t.shadowStrong}`}}>
        <div style={{fontSize:40,marginBottom:12}}>✅</div>
        <div style={{fontSize:16,fontWeight:700,color:t.text,marginBottom:8}}>All caught up in {system}</div>
        <div style={{fontSize:14,color:t.text3,marginBottom:6}}>
          Nothing due right now — {upcoming.length} card{upcoming.length!==1?'s':''} scheduled for later.
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

  return (
    <div style={{position:'fixed',inset:0,background:t.overlay,zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>

      {lightboxIdx !== null && card?.images?.length > 0 && (
        <Lightbox images={card.images} start={lightboxIdx} onClose={()=>setLightboxIdx(null)} />
      )}

      <div style={{background:t.surface,borderRadius:14,width:'100%',maxWidth:580,
        maxHeight:'92vh',display:'flex',flexDirection:'column',
        boxShadow:`0 8px 32px ${t.shadowStrong}`}}>

        {/* Header */}
        <div style={{padding:'16px 20px',borderBottom:`1px solid ${t.border}`,
          display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:t.text}}>
              Reviewing — <span style={{color}}>{system}</span>
            </div>
            <div style={{fontSize:11,color:t.text4,marginTop:2}}>
              {idx+1} / {total} · {reviewed} reviewed · {progress}% done
            </div>
          </div>
          <button onClick={()=>setEnded(true)} style={{fontSize:12,background:t.dangerBg,
            border:`1px solid ${t.dangerBorder}`,color:t.danger,borderRadius:6,
            padding:'5px 12px',cursor:'pointer',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
            End
          </button>
        </div>

        {/* Progress bar */}
        <div style={{height:3,background:t.surface3,flexShrink:0}}>
          <div style={{height:'100%',background:color,width:`${progress}%`,transition:'width .3s'}} />
        </div>

        {/* Card */}
        <div style={{flex:1,overflowY:'auto',padding:20}}>
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            <span style={{fontSize:11,fontWeight:600,background:`${dc}1f`,color:dc,
              border:`1px solid ${dc}44`,borderRadius:4,padding:'2px 8px'}}>
              {card.difficulty}
            </span>
            {card.review_count>0 && (
              <span style={{fontSize:11,color:t.text4}}>Reviewed {card.review_count}×</span>
            )}
            {card.next_review && new Date(card.next_review)<=new Date() && (
              <span style={{fontSize:11,color:'#dc2626',fontWeight:600}}>Due</span>
            )}
            {!card.next_review && (
              <span style={{fontSize:11,color:t.accent,fontWeight:600}}>New</span>
            )}
          </div>

          <div style={{fontSize:17,fontWeight:700,color:t.text,lineHeight:1.4,marginBottom:20}}>
            {card.title}
          </div>

          {!flipped ? (
            <button onClick={()=>setFlipped(true)} style={{width:'100%',
              background:t.surface2,border:`2px dashed ${t.borderStrong}`,borderRadius:10,
              padding:16,fontSize:14,color:t.text3,cursor:'pointer',
              fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              Tap to reveal · Space
            </button>
          ) : (
            <div>
              <div style={{height:1,background:t.border,marginBottom:16}} />
              {card.notes ? (
                <div style={{fontSize:14,color:t.text2,lineHeight:1.8,
                  whiteSpace:'pre-wrap',marginBottom:16}}>
                  <RenderedNotes text={card.notes} highlights={card.highlights} isDark={isDark} />
                </div>
              ) : (
                <div style={{fontSize:13,color:t.text4,marginBottom:16}}>No notes.</div>
              )}
              {card.images?.length>0 && (
                <div style={{display:'flex',gap:8,overflowX:'auto',
                  WebkitOverflowScrolling:'touch',paddingBottom:4,scrollSnapType:'x mandatory'}}>
                  {card.images.map((url,i)=>(
                    <img key={i} src={url} alt="" onClick={()=>setLightboxIdx(i)}
                      style={{height:80,width:'auto',borderRadius:6,
                        border:`1px solid ${t.border}`,cursor:'zoom-in',flexShrink:0,
                        scrollSnapAlign:'start'}} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rating */}
        <div style={{padding:'14px 20px 20px',borderTop:`1px solid ${t.border}`,flexShrink:0}}>
          {flipped ? (
            <>
              <div style={{fontSize:11,color:t.text4,fontWeight:600,
                textAlign:'center',marginBottom:10,letterSpacing:.5}}>
                HOW WELL DID YOU KNOW THIS?  ·  a / h / g / enter
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {RATINGS.map(r=>(
                  <button key={r.key} onClick={()=>rate(r.key)} style={{
                    background:isDark?`${r.color}1f`:r.bg,border:`1px solid ${r.color}40`,
                    borderRadius:10,padding:'12px 6px',cursor:'pointer',
                    fontFamily:'Inter,sans-serif'}}>
                    <div style={{fontSize:13,fontWeight:700,color:r.color}}>{r.label}</div>
                    <div style={{fontSize:10,color:r.color,opacity:.8,marginTop:2}}>{r.hint}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{textAlign:'center'}}>
              <button onClick={skip} style={{background:'none',border:'none',
                color:t.text4,fontSize:12,cursor:'pointer',
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
