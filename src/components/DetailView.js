import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR } from '../lib/constants';

export default function DetailView({ entry, onBack, onDeleted, onUpdated }) {
  const [lightbox, setLightbox] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const color = SYS_COLOR[entry.system] || '#3498db';
  const dc = DIFF_COLOR[entry.difficulty] || '#5a6580';

  const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const markReviewed = async () => {
    const updated = {
      review_count: (entry.review_count || 0) + 1,
      last_reviewed: new Date().toISOString()
    };
    const { data, error } = await supabase.from('entries')
      .update(updated).eq('id', entry.id).select().single();
    if (!error) onUpdated(data);
  };

  const deleteEntry = async () => {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    setDeleting(true);
    await supabase.from('entries').delete().eq('id', entry.id);
    onDeleted(entry.id, entry.system);
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', fontFamily: "'Syne', sans-serif" }}>

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <img src={lightbox} alt="" style={{ maxWidth: '92vw', maxHeight: '90vh', borderRadius: 10 }} />
          <div style={{ position: 'absolute', top: 18, right: 24, color: '#fff', fontSize: 28, cursor: 'pointer' }}>✕</div>
        </div>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: '#4a5070',
            cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 12,
            fontFamily: "'Syne', sans-serif", display: 'flex', alignItems: 'center', gap: 4
          }}>← {entry.system}</button>

          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>
            {entry.title}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
            {entry.topic && (
              <Tag label={entry.topic} color={color} />
            )}
            <Tag label={entry.difficulty} color={dc} />
            <span style={{ fontSize: 11, color: '#3a4060' }}>{fmtDate(entry.created_at)}</span>
            {entry.review_count > 0 && (
              <span style={{ fontSize: 11, color: '#27ae60', fontWeight: 700 }}>
                ✓ Reviewed {entry.review_count}× {entry.last_reviewed && `· Last: ${fmtDate(entry.last_reviewed)}`}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={markReviewed} style={{
            background: '#0d2016', border: '1px solid #27ae6050', color: '#27ae60',
            borderRadius: 8, padding: '8px 14px', fontSize: 12, cursor: 'pointer',
            fontWeight: 700, fontFamily: "'Syne', sans-serif"
          }}>✓ Reviewed</button>
          <button onClick={deleteEntry} disabled={deleting} style={{
            background: '#2a0d0d', border: '1px solid #e74c3c30', color: '#e74c3c',
            borderRadius: 8, padding: '8px 14px', fontSize: 12,
            cursor: deleting ? 'not-allowed' : 'pointer',
            fontFamily: "'Syne', sans-serif"
          }}>{deleting ? '…' : 'Delete'}</button>
        </div>
      </div>

      {/* Notes */}
      {entry.notes && (
        <div style={{
          background: '#10121a', border: '1px solid #1c1f2e', borderRadius: 12,
          padding: '18px 22px', marginBottom: 22, lineHeight: 1.85,
          fontSize: 14, color: '#c8cce0', whiteSpace: 'pre-wrap',
          fontFamily: "'Literata', serif"
        }}>{entry.notes}</div>
      )}

      {/* Images */}
      {entry.images?.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1.5, fontWeight: 800, marginBottom: 12 }}>
            IMAGES ({entry.images.length}) — tap to expand
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {entry.images.map((url, i) => (
              <img key={i} src={url} alt=""
                onClick={() => setLightbox(url)}
                style={{ width: '100%', borderRadius: 10, border: '1px solid #1c1f2e', cursor: 'zoom-in' }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, background: `${color}20`, color,
      borderRadius: 6, padding: '3px 10px', letterSpacing: 0.3
    }}>{label}</span>
  );
}
