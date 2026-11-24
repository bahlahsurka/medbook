// components/visualization/viewport.js
//
// Pure viewport math for the graph renderers (no React Flow, no DOM).
//
// The old behaviour was React Flow's fitView with maxZoom 2 everywhere:
// a 3-node diagram was blown up to ~2x (overlapping toolbar, cramped), and
// a 30-node diagram was shrunk to ~0.25x (3px text). Instead:
//  - never zoom past 1x initially — small diagrams sit at natural size;
//  - if everything fits at a readable zoom, show everything, centred;
//  - otherwise start at a readable zoom anchored on the diagram's entry
//    point (start node / central topic / first cause / hub) and let the
//    user pan — "Fit" still shows the whole thing on demand.
// Insets keep content clear of the floating toolbar and legend.

export const MAX_INITIAL_ZOOM = 1;
export const ABSOLUTE_MIN_ZOOM = 0.12;

/** Readable lower bound for the initial zoom (smallest node text is 12px). */
export function readableMinZoom(containerWidth) {
  return containerWidth && containerWidth < 560 ? 0.7 : 0.75;
}

/** Bounding box of React Flow nodes using their layout sizes. */
export function boundsOf(flowNodes) {
  if (!flowNodes?.length) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of flowNodes) {
    const w = n.data?.width || n.measured?.width || 150;
    const h = n.data?.height || n.measured?.height || 40;
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function placeAxis({ start, size, contentStart, contentSize, zoom, focus, align }) {
  const scaled = contentSize * zoom;
  if (scaled <= size) return start + (size - scaled) / 2 - contentStart * zoom; // fits: centre it
  const min = start + size - (contentStart + contentSize) * zoom; // content's far edge at the far inset
  const max = start - contentStart * zoom;                         // content's near edge at the near inset
  let v;
  if (align === 'start') v = max;
  else v = start + size / 2 - (focus ?? contentStart + contentSize / 2) * zoom;
  return Math.min(max, Math.max(min, v));
}

/**
 * @param {{
 *   bounds:{x,y,width,height}, width:number, height:number,
 *   insets?:{top,right,bottom,left}, mode?:'initial'|'all',
 *   focus?:{x:number,y:number}, alignX?:'center'|'start', alignY?:'center'|'start',
 *   minZoom?:number, maxZoom?:number,
 * }} p
 * @returns {{x:number, y:number, zoom:number, fitsAll:boolean}}
 */
export function computeViewport({ bounds, width, height, insets = {}, mode = 'initial', focus, alignX = 'center', alignY = 'center', minZoom, maxZoom = MAX_INITIAL_ZOOM }) {
  const top = insets.top ?? 16, right = insets.right ?? 16, bottom = insets.bottom ?? 16, left = insets.left ?? 16;
  const availW = Math.max(40, width - left - right);
  const availH = Math.max(40, height - top - bottom);
  const fitZoom = Math.min(availW / bounds.width, availH / bounds.height);
  const floor = mode === 'all' ? ABSOLUTE_MIN_ZOOM : (minZoom ?? readableMinZoom(width));
  const zoom = Math.max(Math.min(maxZoom, floor), Math.min(maxZoom, fitZoom));
  const x = placeAxis({ start: left, size: availW, contentStart: bounds.x, contentSize: bounds.width, zoom, focus: focus?.x, align: alignX });
  const y = placeAxis({ start: top, size: availH, contentStart: bounds.y, contentSize: bounds.height, zoom, focus: focus?.y, align: alignY });
  const fitsAll = bounds.width * zoom <= availW + 0.5 && bounds.height * zoom <= availH + 0.5;
  return { x, y, zoom, fitsAll };
}

/** Tallest an inline (non-fullscreen) canvas gets. */
export function maxCanvasHeight(viewportHeight) {
  return Math.min(Math.round((viewportHeight || 900) * 0.72), 680);
}

/** Zoom at which `bounds` would fit the container (capped at 1x) — used to pick between candidate layouts. */
export function fitZoomFor(bounds, { width, height, insets = {} }) {
  const availW = Math.max(40, width - (insets.left ?? 16) - (insets.right ?? 16));
  const availH = Math.max(40, height - (insets.top ?? 16) - (insets.bottom ?? 16));
  return Math.min(MAX_INITIAL_ZOOM, availW / bounds.width, availH / bounds.height);
}

/** Bounds of plain top-left rects ({x,y,width,height}). */
export function boundsOfRects(rects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Picks the candidate whose bounds read best in the container. A later
 * candidate only wins if it allows a meaningfully larger zoom (`margin`),
 * so each type keeps its conventional orientation unless another is
 * clearly better for this screen.
 * @param {Array<{key:string, bounds:object}>} candidates — in preference order
 */
export function pickBestFit(candidates, container, margin = 1.12) {
  let best = null;
  for (const c of candidates) {
    const zoom = fitZoomFor(c.bounds, container);
    if (!best || zoom > best.zoom * margin) best = { ...c, zoom };
  }
  return best;
}

/**
 * Canvas height that suits the diagram at its initial zoom: short for small
 * diagrams (no dead space), taller for tall ones, within sensible limits.
 */
export function preferredCanvasHeight({ bounds, width, insets, viewportHeight }) {
  const top = insets.top ?? 16, bottom = insets.bottom ?? 16, left = insets.left ?? 16, right = insets.right ?? 16;
  const availW = Math.max(40, width - left - right);
  const zoom = Math.max(Math.min(MAX_INITIAL_ZOOM, readableMinZoom(width)), Math.min(MAX_INITIAL_ZOOM, availW / bounds.width));
  const wanted = bounds.height * zoom + top + bottom;
  const min = width < 560 ? 300 : 260;
  return Math.round(Math.min(maxCanvasHeight(viewportHeight), Math.max(min, wanted)));
}
