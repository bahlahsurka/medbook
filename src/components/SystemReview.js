import { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR } from '../lib/constants';

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
  const now = new Date();

  // Shuffle entries
  const queue = useMemo(() => {
    const shuffle = arr => [...arr].sort(()=>Math.random()-0.5);
    const due  = shuffle(entries.filter(e => e.next_review && new Date(e.next_review)<=now));
    const newE = shuffle(entries.filter(e => !e.next_review));
    const rest = shuffle(entries.filter(e => e.next_review && new Date(e.next_review)>now));
    return [...due, ...newE, ...rest];
  }, [entries]);

  const [idx, setIdx]       = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]     = useState(false);
  const [ended, setEnded]   = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [lightbox, setLightbox] = useState(null);

  const card  = queue[idx];
  const total = queue.length;
  const progress = total > 0 ? Math.round((reviewed/total)*100) : 0;
  const dc = DIFF_COLOR[card?.difficulty] || '#6b7280';

  const rate = async (rating) => {
    if (!card) return;
    const updates = calcNext(card, rating);
    await supabase.from('entries').update(updates).eq('id', card.id);
    onReviewed({ ...card, ...updates });
    setReviewed(p => p+1);
    if (idx+1 >= total) setDone(true);
    else { setIdx(p=>p+1); setFlipped(false); }
  };

  const skip = () => {
    if (idx+1 >= total) setDone(true);
    else { setIdx(p=>p+1); setFlipped(false); }
  };

  if (total === 0) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>📋</div>
        <div style={{fontSize:16,fontWeight:700,color:'#111827',marginBottom:8}}>No entries in {system}</div>
        <div style={{fontSize:14,color:'#6b7280',marginBottom:20}}>Add some entries first.</div>
        <button onClick={onClose} style={B('#f3f4f6','#374151')}>Close</button>
      </div>
    </div>
  );

  if (done || ended) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:14,padding:32,maxWidth:440,width:'100%',textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>{done?'✅':'⏸️'}</div>
        <div style={{fontSize:16,fontWeight:700,color:'#111827',marginBottom:8}}>
          {done?'Session complete!':'Session ended'}
        </div>
        <div style={{fontSize:14,color:'#6b7280',marginBottom:20}}>
          Reviewed <strong>{reviewed}</strong> of <strong>{total}</strong> {system} cards.
        </div>
        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          {!done && (
            <button onClick={()=>setEnded(false)} style={B('#2563eb')}>Resume</button>
          )}
          <button onClick={onClose} style={B('#f3f4f6','#374151')}>Back to {system}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:300,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:'Inter,sans-serif'}}>

      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{position:'fixed',inset:0,
          background:'rgba(0,0,0,.9)',zIndex:400,display:'flex',
          alignItems:'center',justifyContent:'center'}}>
          <img src={lightbox} alt="" style={{maxWidth:'90vw',maxHeight:'88vh',borderRadius:8}} />
          <div onClick={()=>setLightbox(null)} style={{position:'absolute',top:16,right:20,
            color:'#fff',fontSize:26,cursor:'pointer'}}>✕</div>
        </div>
      )}

      <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:580,
        maxHeight:'92vh',display:'flex',flexDirection:'column',
        boxShadow:'0 8px 32px rgba(0,0,0,.2)'}}>

        {/* Header */}
        <div style={{padding:'16px 20px',borderBottom:'1px solid #e5e7eb',
          display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'#111827'}}>
              Reviewing — <span style={{color}}>{system}</span>
            </div>
            <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>
              {idx+1} / {total} · {reviewed} reviewed · {progress}% done
            </div>
          </div>
          <button onClick={()=>setEnded(true)} style={{fontSize:12,background:'#fef2f2',
            border:'1px solid #fecaca',color:'#dc2626',borderRadius:6,
            padding:'5px 12px',cursor:'pointer',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
            End
          </button>
        </div>

        {/* Progress bar */}
        <div style={{height:3,background:'#e5e7eb',flexShrink:0}}>
          <div style={{height:'100%',background:color,width:`${progress}%`,transition:'width .3s'}} />
        </div>

        {/* Card */}
        <div style={{flex:1,overflowY:'auto',padding:20}}>
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            <span style={{fontSize:11,fontWeight:600,background:`${dc}12`,color:dc,
              border:`1px solid ${dc}25`,borderRadius:4,padding:'2px 8px'}}>
              {card.difficulty}
            </span>
            {card.review_count>0 && (
              <span style={{fontSize:11,color:'#9ca3af'}}>Reviewed {card.review_count}×</span>
            )}
            {card.next_review && new Date(card.next_review)<=now && (
              <span style={{fontSize:11,color:'#dc2626',fontWeight:600}}>Due</span>
            )}
            {!card.next_review && (
              <span style={{fontSize:11,color:'#2563eb',fontWeight:600}}>New</span>
            )}
          </div>

          <div style={{fontSize:17,fontWeight:700,color:'#111827',lineHeight:1.4,marginBottom:20}}>
            {card.title}
          </div>

          {!flipped ? (
            <button onClick={()=>setFlipped(true)} style={{width:'100%',
              background:'#f9fafb',border:'2px dashed #d1d5db',borderRadius:10,
              padding:16,fontSize:14,color:'#6b7280',cursor:'pointer',
              fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              Tap to reveal notes
            </button>
          ) : (
            <div>
              <div style={{height:1,background:'#e5e7eb',marginBottom:16}} />
              {card.notes ? (
                <div style={{fontSize:14,color:'#1f2937',lineHeight:1.8,
                  whiteSpace:'pre-wrap',marginBottom:16}}>
                  {card.notes}
                </div>
              ) : (
                <div style={{fontSize:13,color:'#9ca3af',marginBottom:16}}>No notes.</div>
              )}
              {card.images?.length>0 && (
                <div style={{display:'flex',gap:8,overflowX:'auto',
                  WebkitOverflowScrolling:'touch',paddingBottom:4}}>
                  {card.images.map((url,i)=>(
                    <img key={i} src={url} alt="" onClick={()=>setLightbox(url)}
                      style={{height:80,width:'auto',borderRadius:6,
                        border:'1px solid #e5e7eb',cursor:'zoom-in',flexShrink:0}} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rating */}
        <div style={{padding:'14px 20px 20px',borderTop:'1px solid #e5e7eb',flexShrink:0}}>
          {flipped ? (
            <>
              <div style={{fontSize:11,color:'#9ca3af',fontWeight:600,
                textAlign:'center',marginBottom:10,letterSpacing:.5}}>
                HOW WELL DID YOU KNOW THIS?
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {RATINGS.map(r=>(
                  <button key={r.key} onClick={()=>rate(r.key)} style={{
                    background:r.bg,border:`1px solid ${r.color}30`,
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
                color:'#9ca3af',fontSize:12,cursor:'pointer',
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
