export const HL_COLORS = [
  { bg:'#fef08a', text:'#713f12', label:'Yellow' },
  { bg:'#bbf7d0', text:'#14532d', label:'Green'  },
  { bg:'#bfdbfe', text:'#1e3a8a', label:'Blue'   },
  { bg:'#fbcfe8', text:'#831843', label:'Pink'   },
  { bg:'#fed7aa', text:'#7c2d12', label:'Orange' },
];

export function buildHighlightParts(text, highlights) {
  if (!text) return [];
  if (!highlights || highlights.length === 0) return [{ t: text, hl: null }];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  sorted.forEach(h => {
    if (h.start >= h.end) return;
    const start = Math.max(h.start, cursor);
    if (start > cursor) parts.push({ t: text.slice(cursor, start), hl: null });
    if (start < h.end) {
      parts.push({ t: text.slice(start, h.end), hl: h.color });
      cursor = h.end;
    }
  });
  if (cursor < text.length) parts.push({ t: text.slice(cursor), hl: null });
  return parts;
}

export function adjustHighlights(oldText, newText, highlights) {
  if (!highlights || highlights.length === 0) return [];
  if (oldText === newText) return highlights;
  return highlights.filter(h => {
    if (h.end > newText.length) return false;
    return newText.slice(h.start, h.end) === oldText.slice(h.start, h.end);
  });
}

// Get selection offsets from a textarea — works on all platforms
export function getTextareaSelection(ta) {
  if (!ta) return null;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  if (start === end) return null;
  return { start, end };
}
