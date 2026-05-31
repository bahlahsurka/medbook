import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR, DIFFICULTY } from '../lib/constants';

// ── Highlight colors ───────────────────────────────────────────────────────
const HL_COLORS = [
  { name: 'Yellow',  bg: '#fef08a', text: '#713f12' },
  { name: 'Green',   bg: '#bbf7d0', text: '#14532d' },
  { name: 'Blue',    bg: '#bfdbfe', text: '#1e3a8a' },
  { name: 'Pink',    bg: '#fbcfe8', text: '#831843' },
  { name: 'Orange',  bg: '#fed7aa', text: '#7c2d12' },
];

// ── Render notes with highlights ───────────────────────────────────────────
// highlights: [{ start, end, color }]
function renderHighlighted(text, highlights) {
  if (!highlights || highlights.length === 0) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
  }
  // Sort and merge overlapping
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  sorted.forEach((h, i) => {
    if (h.start > cursor) parts.push({ text: text.slice(cursor, h.start), hl: null });
    parts.push({ text: text.slice(h.start, h.end), hl: h.color });
    cursor = h.end;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hl: null });
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) =>
        p.hl
          ? <mark key={i} style={{ background: p.hl.bg, color: p.hl.text,
              borderRadius: 2, padding: '0 1px' }}>{p.text}</mark>
          : <span key={i}>{p.text}</span>
      )}
    </span>
  );
}

// ── Lightbox with swipe ────────────────────────────────────────────────────
function Lightbox({ images, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  const touchStart = useRef(null);

  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  const onTouchStart = e => { touchStart.current = e.touches[0].clientX; };
  const onTouchEnd = e => {
    if (touchStart.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    if (dx < -50) next();
    else if (dx > 50) prev();
    touchStart.current = null;
  };

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      onClick={onClose}>

      {/* Close */}
      <div style={{ position: 'absolute', top: 16, right: 20,
        color: '#fff', fontSize: 28, cursor: 'pointer', zIndex: 10,
        lineHeight: 1, fontWeight: 300 }}
        onClick={onClose}>✕</div>

      {/* Counter */}
      {images.length > 1 && (
        <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)',
          color: '#fff', fontSize: 13, fontWeight: 500,
          background: 'rgba(0,0,0,0.4)', padding: '4px 12px', borderRadius: 20 }}>
          {idx + 1} / {images.length}
        </div>
      )}

      {/* Prev arrow */}
      {images.length > 1 && (
        <div onClick={e => { e.stopPropagation(); prev(); }} style={{
          position: 'absolute', left: 12, color: '#fff', fontSize: 32,
          cursor: 'pointer', padding: '8px 14px',
          background: 'rgba(0,0,0,0.3)', borderRadius: 8, userSelect: 'none'
        }}>‹</div>
      )}

      <img src={images[idx]} alt=""
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain' }} />

      {/* Next arrow */}
      {images.length > 1 && (
        <div onClick={e => { e.stopPropagation(); next(); }} style={{
          position: 'absolute', right: 12, color: '#fff', fontSize: 32,
          cursor: 'pointer', padding: '8px 14px',
          background: 'rgba(0,0,0,0.3)', borderRadius: 8, userSelect: 'none'
        }}>›</div>
      )}
    </div>
  );
}

// ── Highlight toolbar ──────────────────────────────────────────────────────
function HighlightToolbar({ onHighlight, onRemove }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      marginBottom: 10
    }}>
      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>HIGHLIGHT:</span>
      {HL_COLORS.map(c => (
        <button key={c.name} onClick={() => onHighlight(c)}
          title={c.name}
          style={{
            width: 22, height: 22, borderRadius: 4, border: '1px solid #e5e7eb',
            background: c.bg, cursor: 'pointer', flexShrink: 0
          }} />
      ))}
      <button onClick={onRemove}
        style={{ fontSize: 11, background: '#f3f4f6', border: '1px solid #e5e7eb',
          borderRadius: 5, padding: '3px 10px', cursor: 'pointer',
          color: '#6b7280', fontWeight: 600 }}>Remove</button>
    </div>
  );
}

// ── Highlightable textarea ─────────────────────────────────────────────────
function HighlightableTextarea({ value, onChange, highlights, onHighlightsChange }) {
  const textareaRef = useRef();

  const applyHighlight = (color) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const newHl = [...(highlights || []), { start, end, color }];
    onHighlightsChange(newHl);
  };

  const removeHighlight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) { onHighlightsChange([]); return; }
    const filtered = (highlights || []).filter(h => !(h.start < end && h.end > start));
    onHighlightsChange(filtered);
  };

  return (
    <div>
      <HighlightToolbar onHighlight={applyHighlight} onRemove={removeHighlight} />
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => {
            onChange(e.target.value);
            onHighlightsChange([]); // clear highlights when text changes significantly
          }}
          rows={8}
          style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }}
        />
      </div>
      {(highlights || []).length > 0 && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          {highlights.length} highlight{highlights.length !== 1 ? 's' : ''} applied
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function DetailView({ entry, onBack, onDeleted, onUpdated, userId }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [editing, setEditing]         = useState(false);

  const [editTitle, setEditTitle]     = useState(entry.title);
  const [editNotes, setEditNotes]     = useState(entry.notes || '');
  const [editDiff, setEditDiff]       = useState(entry.difficulty || 'Medium');
  const [editImages, setEditImages]   = useState(entry.images || []);
  const [editHighlights, setEditHighlights] = useState(entry.highlights || []);
  const [newImages, setNewImages]     = useState([]);
  const [saving, setSaving]           = useState(false);
  const [editErr, setEditErr]         = useState(null);

  // View-mode highlight selection
  const notesRef = useRef();
  const [viewHighlights, setViewHighlights] = useState(entry.highlights || []);
  const [showViewHL, setShowViewHL]   = useState(false);

  const color = SYS_COLOR[entry.system] || '#2563eb';
  const dc    = DIFF_COLOR[entry.difficulty] || '#6b7280';

  const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const markReviewed = async () => {
    const { data, error } = await supabase.from('entries').update({
      review_count: (entry.review_count || 0) + 1,
      last_reviewed: new Date().toISOString()
    }).eq('id', entry.id).select().single();
    if (!error) onUpdated(data);
  };

  const deleteEntry = async () => {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    setDeleting(true);
    await supabase.from('entries').delete().eq('id', entry.id);
    onDeleted(entry.id, entry.system);
  };

  const loadNewImages = (files) => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => setNewImages(prev => [...prev, { preview: e.target.result, file: f }]);
      reader.readAsDataURL(f);
    });
  };

  const uploadImage = async (imgObj) => {
    const ext = imgObj.file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from('entry-images').upload(path, imgObj.file, { contentType: imgObj.file.type });
    if (error) throw error;
    const { data } = supabase.storage.from('entry-images').getPublicUrl(path);
    return data.publicUrl;
  };

  // Apply highlight in view mode
  const applyViewHighlight = (color) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const container = notesRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    // Calculate char offsets
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;

    const newHl = [...viewHighlights, { start, end, color }];
    setViewHighlights(newHl);
    sel.removeAllRanges();

    // Save to DB
    supabase.from('entries').update({ highlights: newHl }).eq('id', entry.id).then(() => {});
    onUpdated({ ...entry, highlights: newHl });
  };

  const removeViewHighlight = () => {
    const sel = window.getSelection();
    let newHl;
    if (sel && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const container = notesRef.current;
      if (container && container.contains(range.commonAncestorContainer)) {
        const preRange = document.createRange();
        preRange.selectNodeContents(container);
        preRange.setEnd(range.startContainer, range.startOffset);
        const start = preRange.toString().length;
        const end = start + range.toString().length;
        newHl = viewHighlights.filter(h => !(h.start < end && h.end > start));
      }
    } else {
      newHl = [];
    }
    if (!newHl) newHl = [];
    setViewHighlights(newHl);
    supabase.from('entries').update({ highlights: newHl }).eq('id', entry.id).then(() => {});
    onUpdated({ ...entry, highlights: newHl });
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) { setEditErr('Title is required'); return; }
    setSaving(true); setEditErr(null);
    try {
      const uploadedUrls = await Promise.all(newImages.map(uploadImage));
      const allImages = [...editImages, ...uploadedUrls];
      const { data, error } = await supabase.from('entries').update({
        title: editTitle.trim(),
        notes: editNotes.trim(),
        difficulty: editDiff,
        images: allImages,
        highlights: editHighlights,
      }).eq('id', entry.id).select().single();
      if (error) throw error;
      setViewHighlights(editHighlights);
      onUpdated(data);
      setEditing(false);
      setNewImages([]);
    } catch (e) { setEditErr(e.message); }
    setSaving(false);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditTitle(entry.title);
    setEditNotes(entry.notes || '');
    setEditDiff(entry.difficulty || 'Medium');
    setEditImages(entry.images || []);
    setEditHighlights(entry.highlights || []);
    setNewImages([]);
    setEditErr(null);
  };

  // ── EDIT MODE ──────────────────────────────────────────────────────────────
  if (editing) return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 20 }}>
        Editing — <span style={{ color }}>{entry.system}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <Field label="TITLE *">
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={inp} autoFocus />
        </Field>

        <Field label="DIFFICULTY">
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={() => setEditDiff(d)} style={{
                padding: '7px 16px', borderRadius: 6,
                border: `1px solid ${editDiff === d ? DIFF_COLOR[d] : '#e5e7eb'}`,
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: editDiff === d ? `${DIFF_COLOR[d]}12` : '#fff',
                color: editDiff === d ? DIFF_COLOR[d] : '#6b7280',
              }}>{d}</button>
            ))}
          </div>
        </Field>

        <Field label="REVIEW NOTES">
          <HighlightableTextarea
            value={editNotes}
            onChange={setEditNotes}
            highlights={editHighlights}
            onHighlightsChange={setEditHighlights}
          />
        </Field>

        {editImages.length > 0 && (
          <Field label="EXISTING IMAGES — tap ✕ to remove">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
              {editImages.map((url, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={url} alt="" style={{ width: 100, height: 76, objectFit: 'cover',
                    borderRadius: 7, border: '1px solid #e5e7eb' }} />
                  <button onClick={() => setEditImages(p => p.filter((_, j) => j !== i))} style={{
                    position: 'absolute', top: -7, right: -7, background: '#dc2626',
                    border: 'none', borderRadius: '50%', width: 20, height: 20,
                    fontSize: 10, color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>✕</button>
                </div>
              ))}
            </div>
          </Field>
        )}

        <Field label="ADD MORE IMAGES">
          <label style={{
            display: 'inline-block', marginTop: 8, background: '#f3f4f6',
            border: '1px solid #e5e7eb', borderRadius: 7,
            padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500, color: '#374151'
          }}>
            📷 Choose images
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={e => loadNewImages(e.target.files)} />
          </label>
          {newImages.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
              {newImages.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img.preview} alt="" style={{ width: 100, height: 76, objectFit: 'cover',
                    borderRadius: 7, border: '1px solid #e5e7eb' }} />
                  <button onClick={() => setNewImages(p => p.filter((_, j) => j !== i))} style={{
                    position: 'absolute', top: -7, right: -7, background: '#dc2626',
                    border: 'none', borderRadius: '50%', width: 20, height: 20,
                    fontSize: 10, color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Field>

        {editErr && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{editErr}</div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={saveEdit} disabled={saving} style={{
            background: color, color: '#fff', border: 'none', borderRadius: 8,
            padding: '11px 24px', fontSize: 14, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1
          }}>{saving ? 'Saving…' : '✓ Save Changes'}</button>
          <button onClick={cancelEdit} style={{
            background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
            borderRadius: 8, padding: '11px 20px', fontSize: 14, cursor: 'pointer'
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── VIEW MODE ──────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>

      {lightboxIdx !== null && (
        <Lightbox
          images={entry.images}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}

      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer',
        fontSize: 13, padding: 0, marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500
      }}>← Back to {entry.system}</button>

      {/* Title card */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '20px', marginBottom: 14, borderTop: `3px solid ${color}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', lineHeight: 1.4, marginBottom: 12 }}>
          {entry.title}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <Tag label={entry.difficulty} color={dc} />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{fmtDate(entry.created_at)}</span>
          {entry.review_count > 0 && (
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
              ✓ Reviewed {entry.review_count}×{entry.last_reviewed && ` · Last: ${fmtDate(entry.last_reviewed)}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={markReviewed} style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a',
            borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600
          }}>✓ Mark Reviewed</button>
          <button onClick={() => setEditing(true)} style={{
            background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb',
            borderRadius: 7, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600
          }}>✎ Edit</button>
          <button onClick={deleteEntry} disabled={deleting} style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
            borderRadius: 7, padding: '8px 16px', fontSize: 13,
            cursor: deleting ? 'not-allowed' : 'pointer', fontWeight: 600
          }}>{deleting ? '…' : 'Delete'}</button>
        </div>
      </div>

      {/* Notes with highlighting */}
      {entry.notes && (
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '18px 20px', marginBottom: 14,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.8,
              fontWeight: 600, textTransform: 'uppercase' }}>Review Notes</div>
            <button onClick={() => setShowViewHL(p => !p)} style={{
              fontSize: 11, background: showViewHL ? '#fef9c3' : '#f3f4f6',
              border: `1px solid ${showViewHL ? '#fde68a' : '#e5e7eb'}`,
              borderRadius: 5, padding: '3px 10px', cursor: 'pointer',
              color: showViewHL ? '#92400e' : '#6b7280', fontWeight: 600
            }}>🖊 {showViewHL ? 'Done highlighting' : 'Highlight'}</button>
          </div>

          {showViewHL && (
            <HighlightToolbar onHighlight={applyViewHighlight} onRemove={removeViewHighlight} />
          )}

          <div ref={notesRef} style={{ lineHeight: 1.85, fontSize: 14, color: '#1f2937',
            userSelect: showViewHL ? 'text' : 'auto' }}>
            {renderHighlighted(entry.notes, viewHighlights)}
          </div>

          {showViewHL && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 10 }}>
              Select text then tap a colour to highlight. Highlights save automatically.
            </div>
          )}
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
            Images ({entry.images.length}) — tap to expand & swipe
          </div>
          <div style={{
            display: 'flex', gap: 10, overflowX: 'auto',
            WebkitOverflowScrolling: 'touch', paddingBottom: 8,
            scrollSnapType: 'x mandatory'
          }}>
            {entry.images.map((url, i) => (
              <img key={i} src={url} alt=""
                onClick={() => setLightboxIdx(i)}
                style={{
                  height: 180, width: 'auto', maxWidth: '80vw',
                  flexShrink: 0, borderRadius: 8, border: '1px solid #e5e7eb',
                  cursor: 'pointer', objectFit: 'contain', background: '#f9fafb',
                  scrollSnapAlign: 'start'
                }} />
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

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.8,
        fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  );
}

const inp = {
  display: 'block', width: '100%', marginTop: 8,
  background: '#fff', border: '1px solid #d1d5db',
  borderRadius: 8, color: '#111827', padding: '10px 12px',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
