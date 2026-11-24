// components/visualization/edgeGeometry.js
//
// Pure geometry for diagram edges (no React, no DOM) — attaching edges to
// node borders, rounding orthogonal routes, and finding label anchors.

/** Point where the segment from the rect's centre toward `toward` crosses the rect border. */
export function rectBorderPoint(rect, toward, gap = 0) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : (rect.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (rect.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  const len = Math.hypot(dx, dy);
  const g = gap / len;
  return { x: cx + dx * (s + g), y: cy + dy * (s + g) };
}

/** Which side of `rect` a border point sits on: 'left'|'right'|'top'|'bottom'. */
export function sideOf(rect, p) {
  const d = [
    ['left', Math.abs(p.x - rect.x)], ['right', Math.abs(p.x - (rect.x + rect.w))],
    ['top', Math.abs(p.y - rect.y)], ['bottom', Math.abs(p.y - (rect.y + rect.h))],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}

/** SVG path through `points` with corners rounded by up to `radius`. */
export function roundedPolylinePath(points, radius = 8) {
  if (!points || points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p = points[i], p1 = points[i + 1];
    const l0 = Math.hypot(p.x - p0.x, p.y - p0.y), l1 = Math.hypot(p1.x - p.x, p1.y - p.y);
    const r = Math.min(radius, l0 / 2, l1 / 2);
    if (r < 0.5) { d += ` L ${p.x} ${p.y}`; continue; }
    const a = { x: p.x + ((p0.x - p.x) / l0) * r, y: p.y + ((p0.y - p.y) / l0) * r };
    const b = { x: p.x + ((p1.x - p.x) / l1) * r, y: p.y + ((p1.y - p.y) / l1) * r };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Smooth curve through every point (Catmull–Rom converted to cubic Béziers). */
export function smoothPath(points, tension = 0.5) {
  if (!points || points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2;
    const k = tension / 3;
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
    d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Point halfway along a polyline, by length. */
export function polylineMidpoint(points) {
  if (!points?.length) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let walk = total / 2;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (walk <= seg && seg > 0) {
      const f = walk / seg;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * f, y: points[i - 1].y + (points[i].y - points[i - 1].y) * f };
    }
    walk -= seg;
  }
  return points[points.length - 1];
}

const OUTWARD = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

/**
 * Cubic curve leaving each endpoint perpendicular to the side it sits on —
 * the natural "branch" curve for trees and causal chains.
 * @returns {{path:string, mid:{x,y}}}
 */
export function sideCurve(start, startSide, end, endSide) {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const k = Math.max(24, dist * 0.42);
  const o1 = OUTWARD[startSide], o2 = OUTWARD[endSide];
  const c1 = { x: start.x + o1.x * k, y: start.y + o1.y * k };
  const c2 = { x: end.x + o2.x * k, y: end.y + o2.y * k };
  const mid = {
    x: 0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y,
  };
  return { path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`, mid };
}

/** Side-centre anchor of a rect facing toward another rect (for tree/chain edges). */
export function facingAnchors(a, b, axis = 'auto') {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const horizontal = axis === 'x' || (axis === 'auto' && Math.abs(bcx - acx) - (a.w + b.w) / 4 >= Math.abs(bcy - acy) - (a.h + b.h) / 4);
  if (horizontal) {
    const right = bcx >= acx;
    return {
      start: { x: right ? a.x + a.w : a.x, y: acy }, startSide: right ? 'right' : 'left',
      end: { x: right ? b.x : b.x + b.w, y: bcy }, endSide: right ? 'left' : 'right',
    };
  }
  const down = bcy >= acy;
  return {
    start: { x: acx, y: down ? a.y + a.h : a.y }, startSide: down ? 'bottom' : 'top',
    end: { x: bcx, y: down ? b.y : b.y + b.h }, endSide: down ? 'top' : 'bottom',
  };
}
