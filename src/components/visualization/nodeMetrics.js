// components/visualization/nodeMetrics.js
//
// Text measurement for diagram nodes, so every layout positions nodes from
// their real rendered size instead of a fixed guess (a fixed 48px-tall
// estimate was why ELK packed wrapped flowchart nodes into each other, and
// why the radial Mind Map overlapped long labels). Node components render
// at exactly the width computed here and never shorter than the height, so
// layout and DOM agree.
//
// Uses a canvas 2D context's measureText (cheap, synchronous, no DOM
// reflow). jsdom has no canvas, so tests fall back to a per-weight average
// character width — slightly conservative, which only ever over-reserves
// space.
const FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
const AVG_CHAR_EM = { 400: 0.53, 500: 0.55, 600: 0.57, 700: 0.59 };

let ctx; // undefined = not yet probed; null = unavailable
function context() {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
    if (!isJsdom && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d') || null;
  } catch { ctx = null; }
  return ctx;
}

const widthCache = new Map();
// Widths measured before Inter finished loading were measured in a fallback
// font — drop them once real fonts arrive.
try { document.fonts?.addEventListener?.('loadingdone', () => widthCache.clear()); } catch { /* no FontFaceSet */ }
export function measureTextWidth(text, fontSize, weight = 500) {
  const key = `${weight}|${fontSize}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const c = context();
  let w;
  if (c) {
    c.font = `${weight} ${fontSize}px ${FONT_FAMILY}`;
    w = c.measureText(text).width;
  } else {
    w = text.length * fontSize * (AVG_CHAR_EM[weight] || 0.55);
  }
  if (widthCache.size > 4000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/**
 * Greedy word wrap matching CSS `overflow-wrap: anywhere` closely enough
 * for layout: words wider than the line are split by character.
 * @returns {{lines:number, width:number}} widest line's width in px
 */
export function wrapText(text, { fontSize, weight, maxWidth }) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: 1, width: 0 };
  const space = measureTextWidth(' ', fontSize, weight);
  let lines = 1, line = 0, widest = 0;
  for (const word of words) {
    let w = measureTextWidth(word, fontSize, weight);
    if (w > maxWidth) {
      // Break an over-long word (a long drug or eponym name) across lines.
      const perChar = w / word.length;
      const fits = Math.max(1, Math.floor(maxWidth / perChar));
      let rest = word.length;
      if (line > 0) { widest = Math.max(widest, line); lines++; line = 0; }
      while (rest > fits) { widest = Math.max(widest, fits * perChar); lines++; rest -= fits; }
      line = rest * perChar;
      continue;
    }
    const next = line === 0 ? w : line + space + w;
    if (next <= maxWidth) line = next;
    else { widest = Math.max(widest, line); lines++; line = w; }
  }
  widest = Math.max(widest, line);
  return { lines, width: widest };
}

/**
 * Box size for a node with the given text and typography spec.
 * @param {string} text
 * @param {{fontSize:number, weight:number, lineHeight:number, padX:number, padY:number,
 *   minWidth:number, maxWidth:number, extraX?:number, extraY?:number}} spec
 *   extraX/extraY: non-text horizontal/vertical room (icon, border, shape insets).
 */
export function measureNode(text, spec) {
  const extraX = spec.extraX || 0;
  const chrome = spec.padX * 2 + extraX;
  const { lines, width } = wrapText(text, { fontSize: spec.fontSize, weight: spec.weight, maxWidth: spec.maxWidth - chrome });
  const w = Math.ceil(Math.min(spec.maxWidth, Math.max(spec.minWidth, width + chrome + 2)));
  const h = Math.ceil(lines * spec.fontSize * spec.lineHeight + spec.padY * 2 + (spec.extraY || 0));
  return { width: w, height: h, lines };
}
