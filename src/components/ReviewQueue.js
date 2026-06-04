import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR } from '../lib/constants';

function calcNext(entry, rating) {
  let interval = entry.review_interval || 1;
  let ef = entry.ease_factor || 2.5;
  if (rating === 'again')     { interval = 1; }
  else if (rating === 'hard') { interval = Math.max(1, Math.round(interval * 1.2)); ef = Math.max(1.3, ef - 0.15); }
  else if (rating === 'good') { interval = Math.max(1, Math.round(interval * ef)); }
  else if (rating === 'easy') { interval = Math.max(1, Math.round(interval * ef * 1.3)); ef += 0.1; }
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

const RATINGS = [
  { key: 'again', label: 'Again',  color: '#dc2626', bg: '#fef2f2', hint: '1 day'   },
  { key: 'hard',  label: 'Hard',   color: '#d97706', bg: '#fffbeb', hint: '~3 days'  },
  { key: 'good',  label: 'Good',   color: '#2563eb', bg: '#eff6ff', hint: '~7 days'  },
  { key: 'easy',  label: 'Easy',   color: '#16a34a', bg: '#f0fdf4', hint: '~14 days' },
];

export default function ReviewQueue({ allEntries, onReviewed }) {
  const now = new Date();

  const queue = useMemo(() => {
    const all = Object.values(allEntries).flat();
    const due  = all.filter(e => e.next_review && new Date(e.next_review) <= now)
                    .sort((a, b) => new Date(a.next_review) - new Date(b.next_review));
    const newE = all.filter(e => !e.next_review)
                    .sort((a, b) => DIFF_ORDER(b.difficulty) - DIFF_ORDER(a.difficulty));
    return [...due, ...newE];
  }, [allEntries]);

  const [idx, setIdx]         = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]       = useState(false);
  const [sessionDone, setSess] = useState(0);
  const [lightbox, setLightbox] = useState(null);

  const card = queue[idx];
  const total = queue.length;
  const progress = total > 0 ? (sessionDone / total) * 100 : 0;

  const rate = async (rating) => {
    if (!card) return;
    const updates = calcNext(card, rating);
    await supabase.from('entries').update(updates).eq('id', card.id);
    onReviewed({ ...card, ...updates });
    setSess(p => p + 1);
    if (idx + 1 >= total) { setDone(true); }
    else { setIdx(p => p + 1); setFlipped(false); }
  };

  if (total === 0) return (
    <div style={{ maxWidth: 580, margin: '0 auto', textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>All caught up!</div>
      <div style={{ fontSize: 14, color: '#6b7280' }}>No entries due for review. Add entries and review them to start building your queue.</div>
    </div>
  );

  if (done) return (
    <div style={{ maxWidth: 580, margin: '0 auto', textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Session complete!</div>
      <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>You reviewed {sessionDone} card{sessionDone !== 1 ? 's' : ''} today.</div>
      <button onClick={() => { setIdx(0); setFlipped(false); setDone(false); setSess(0); }}
        style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
          padding: '11px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        Review Again
      </button>
    </div>
  );

  const color = SYS_COLOR[card?.system] || '#2563eb';
  const dc = DIFF_COLOR[card?.difficulty] || '#6b7280';

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <img src={lightbox} alt="" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8 }} />
          <div style={{ position: 'absolute', top: 16, right: 20, color: '#fff', fontSize: 26, cursor: 'pointer' }}>✕</div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>Review Queue</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>{idx + 1} / {total}</div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: '#e5e7eb', borderRadius: 4, marginBottom: 20 }}>
        <div style={{ height: '100%', background: '#2563eb', borderRadius: 4,
          width: `${progress}%`, transition: 'width .3s' }} />
      </div>

      {/* Card */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
        borderTop: `4px solid ${color}`, padding: 24, marginBottom: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', minHeight: 240
      }}>
        {/* System + difficulty */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, background: `${color}12`, color,
            border: `1px solid ${color}25`, borderRadius: 4, padding: '2px 8px' }}>
            {card.system}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, background: `${dc}12`, color: dc,
            border: `1px solid ${dc}25`, borderRadius: 4, padding: '2px 8px' }}>
            {card.difficulty}
          </span>
          {card.review_count > 0 && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>Reviewed {card.review_count}×</span>
          )}
        </div>

        {/* Title */}
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', lineHeight: 1.4, marginBottom: 20 }}>
          {card.title}
        </div>

        {/* Answer */}
        {!flipped ? (
          <button onClick={() => setFlipped(true)} style={{
            width: '100%', background: '#f9fafb', border: '2px dashed #d1d5db',
            borderRadius: 10, padding: '16px', fontSize: 14, color: '#6b7280',
            cursor: 'pointer', fontWeight: 600
          }}>Tap to reveal answer</button>
        ) : (
          <div>
            <div style={{ height: 1, background: '#e5e7eb', marginBottom: 16 }} />
            {card.notes ? (
              <div style={{ fontSize: 14, color: '#1f2937', lineHeight: 1.8,
                whiteSpace: 'pre-wrap', marginBottom: 16, maxHeight: 300, overflowY: 'auto' }}>
                {card.notes}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>No notes for this entry.</div>
            )}
            {card.images?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto',
                WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
                {card.images.map((url, i) => (
                  <img key={i} src={url} alt="" onClick={() => setLightbox(url)}
                    style={{ height: 80, width: 'auto', borderRadius: 6,
                      border: '1px solid #e5e7eb', cursor: 'zoom-in', flexShrink: 0 }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rating buttons */}
      {flipped && (
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600,
            textAlign: 'center', marginBottom: 10, letterSpacing: 0.5 }}>
            HOW WELL DID YOU KNOW THIS?
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {RATINGS.map(r => (
              <button key={r.key} onClick={() => rate(r.key)} style={{
                background: r.bg, border: `1px solid ${r.color}30`, borderRadius: 10,
                padding: '12px 6px', cursor: 'pointer', textAlign: 'center'
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: r.color }}>{r.label}</div>
                <div style={{ fontSize: 10, color: r.color, opacity: 0.8, marginTop: 2 }}>{r.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!flipped && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={() => { setSess(p=>p+1); if(idx+1>=total) setDone(true); else { setIdx(p=>p+1); setFlipped(false); }}}
            style={{ background: 'none', border: 'none', color: '#9ca3af',
              fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
            Skip this card
          </button>
        </div>
      )}
    </div>
  );
}

function DIFF_ORDER(d) {
  return { Flagged: 4, Hard: 3, Medium: 2, Easy: 1 }[d] || 0;
}
