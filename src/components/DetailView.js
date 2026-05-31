import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR } from '../lib/constants';

export default function DetailView({ entry, onBack, onDeleted, onUpdated }) {
  const [lightbox, setLightbox] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const color = SYS_COLOR[entry.system] || '#2563eb';
  const dc = DIFF_COLOR[entry.difficulty] || '#6b7280';

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
    <div style={{ maxWidth: 680, margin: '0 auto' }}>

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <img src={lightbox} alt=""
            style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8 }} />
          <div style={{ position: 'absolute', top: 16, right: 20,
            color: '#fff', fontSize: 26, cursor: 'pointer', fontWeight: 300 }}>✕</div>
        </div>
      )}

      {/* Back */}
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: '#6b7280',
        cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500
      }}>← Back to {entry.system}</button>

      {/* Title card */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '20px', marginBottom: 16,
        borderTop: `3px solid ${color}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', lineHeight: 1.4, marginBottom: 12 }}>
          {entry.title}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          {entry.topic && <Tag label={entry.topic} color={color} />}
          <Tag label={entry.difficulty} color={dc} />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{fmtDate(entry.created_at)}</span>
          {entry.review_count > 0 && (
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
              ✓ Reviewed {entry.review_count}× {entry.last_reviewed && `· Last: ${fmtDate(entry.last_reviewed)}`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={markReviewed} style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a',
            borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600
          }}>✓ Mark Reviewed</button>
          <button onClick={deleteEntry} disabled={deleting} style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
            borderRadius: 7, padding: '8px 16px', fontSize: 13,
            cursor: deleting ? 'not-allowed' : 'pointer', fontWeight: 600
          }}>{deleting ? '…' : 'Delete'}</button>
        </div>
      </div>

      {/* Notes */}
      {entry.notes && (
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '18px 20px', marginBottom: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
          <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.8,
            fontWeight: 600, textTransform: 'uppercase', marginBottom: 12 }}>Review Notes</div>
          <div style={{ lineHeight: 1.85, fontSize: 14, color: '#1f2937', whiteSpace: 'pre-wrap' }}>
            {entry.notes}
          </div>
        </div>
      )}

      {/* Images */}
      {entry.images?.length > 0 && (
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
          <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.8,
            fontWeight: 600, textTransform: 'uppercase', marginBottom: 14 }}>
            Images ({entry.images.length}) — tap to expand
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entry.images.map((url, i) => (
              <img key={i} src={url} alt=""
                onClick={() => setLightbox(url)}
                style={{ width: '100%', borderRadius: 8, border: '1px solid #e5e7eb',
                  cursor: 'zoom-in', display: 'block' }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, background: `${color}12`, color,
      borderRadius: 4, padding: '2px 8px', border: `1px solid ${color}25`
    }}>{label}</span>
  );
}
