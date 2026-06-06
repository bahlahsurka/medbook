// Shared highlight utilities

export const HL_COLORS = [
  { bg: '#fef08a', text: '#713f12', label: 'Yellow' },
  { bg: '#bbf7d0', text: '#14532d', label: 'Green'  },
  { bg: '#bfdbfe', text: '#1e3a8a', label: 'Blue'   },
  { bg: '#fbcfe8', text: '#831843', label: 'Pink'   },
  { bg: '#fed7aa', text: '#7c2d12', label: 'Orange' },
];

// Render plain text with highlight spans
export function renderHighlighted(text, highlights) {
  if (!text) return null;
  if (!highlights || highlights.length === 0) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
  }
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  sorted.forEach(h => {
    if (h.start >= h.end) return;
    if (h.start > cursor) parts.push({ t: text.slice(cursor, h.start), hl: null });
    parts.push({ t: text.slice(h.start, h.end), hl: h.color });
    cursor = h.end;
  });
  if (cursor < text.length) parts.push({ t: text.slice(cursor), hl: null });
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => p.hl
        ? <mark key={i} style={{ background: p.hl.bg, color: p.hl.text, borderRadius: 2, padding: '0 1px' }}>{p.t}</mark>
        : <span key={i}>{p.t}</span>
      )}
    </span>
  );
}

// Adjust highlights when text changes (preserve non-overlapping ones)
export function adjustHighlights(oldText, newText, highlights) {
  if (!highlights || highlights.length === 0) return [];
  if (oldText === newText) return highlights;
  // Keep highlights whose text still matches exactly at the same position
  return highlights.filter(h => {
    if (h.end > newText.length) return false;
    return newText.slice(h.start, h.end) === oldText.slice(h.start, h.end);
  });
}

// Highlight toolbar component
export function HLToolbar({ onApply, onRemove, compact }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      marginBottom: compact ? 6 : 10 }}>
      {!compact && <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>HIGHLIGHT:</span>}
      {HL_COLORS.map((c, i) => (
        <button key={i} onClick={() => onApply(c)} title={c.label}
          style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #e5e7eb',
            background: c.bg, cursor: 'pointer', flexShrink: 0 }} />
      ))}
      <button onClick={onRemove} style={{ fontSize: 11, background: '#f3f4f6',
        border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 10px',
        cursor: 'pointer', color: '#6b7280', fontWeight: 600, fontFamily: 'Inter,sans-serif' }}>
        Remove
      </button>
    </div>
  );
}
