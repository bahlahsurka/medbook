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

  // Defensive clamp — never let a stale/out-of-range highlight crash the render
  const sorted = highlights
    .filter(h => h && Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start)
    .map(h => ({ ...h, start: Math.max(0, h.start), end: Math.min(text.length, h.end) }))
    .filter(h => h.end > h.start)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [{ t: text, hl: null }];

  const parts = [];
  let cursor = 0;
  sorted.forEach(h => {
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

/**
 * Diff-based highlight adjustment.
 * Finds the single edited region (common prefix / common suffix trick — correct
 * for normal typing/deleting/pasting) and shifts, grows, trims, or drops each
 * highlight relative to that edit — instead of discarding every highlight whose
 * exact old offsets no longer match verbatim.
 */
export function adjustHighlights(oldText, newText, highlights) {
  if (!highlights || highlights.length === 0) return [];
  if (oldText === newText) return highlights;

  const oldLen = oldText.length, newLen = newText.length;

  let prefix = 0;
  const maxPrefix = Math.min(oldLen, newLen);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(oldLen, newLen) - prefix;
  while (suffix < maxSuffix &&
         oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]) suffix++;

  const oldEditStart = prefix;
  const oldEditEnd   = oldLen - suffix;
  const delta        = newLen - oldLen;

  const result = [];
  for (const h of highlights) {
    if (!h || !Number.isFinite(h.start) || !Number.isFinite(h.end) || h.end <= h.start) continue;

    if (h.end <= oldEditStart) {
      // Entirely before the edit — untouched
      result.push(h);
    } else if (h.start >= oldEditEnd) {
      // Entirely after the edit — shift with it
      const ns = h.start + delta, ne = h.end + delta;
      if (ne > ns) result.push({ ...h, start: ns, end: ne });
    } else if (h.start <= oldEditStart && h.end >= oldEditEnd) {
      // Edit happened inside the highlighted range — grow/shrink with it
      // (typing inside a highlight keeps extending the highlight, which matches
      // what most people expect while actively highlighting-and-typing)
      const ne = h.end + delta;
      if (ne > h.start) result.push({ ...h, end: ne });
    } else if (h.start < oldEditStart) {
      // Overlaps the edit on its right edge only — trim to before the edit
      if (oldEditStart > h.start) result.push({ ...h, end: oldEditStart });
    } else {
      // Overlaps the edit on its left edge only — trim to after the edit, then shift
      const ns = oldEditEnd + delta, ne = h.end + delta;
      if (ne > ns) result.push({ ...h, start: ns, end: ne });
    }
  }

  // Final safety clamp — guarantees nothing downstream ever sees an
  // out-of-range or inverted highlight, even if an edge case slipped through.
  return result
    .map(h => ({ ...h, start: Math.max(0, h.start), end: Math.min(newLen, h.end) }))
    .filter(h => h.end > h.start);
}

// Get selection offsets from a textarea — works on all platforms
export function getTextareaSelection(ta) {
  if (!ta) return null;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  if (start === end) return null;
  return { start, end };
}
