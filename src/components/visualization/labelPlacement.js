// components/visualization/labelPlacement.js
//
// Greedy edge-label culling: keeps a label only if its pill would not land
// on a node or on an already-kept label. Dropped labels aren't lost — the
// selected node's links always show them, and the detail panel lists every
// relationship.

/** Typography of relationship/edge label pills (matches EdgeLabelPill). */
export const EDGE_LABEL_SPEC = { fontSize: 10.5, weight: 600, lineHeight: 1.3, padX: 7, padY: 2, minWidth: 0, maxWidth: 170, extraX: 2, extraY: 2 };

export const humanizeRelationship = (r) => String(r || '').replace(/_/g, ' ').trim();

const hit = (a, b, pad) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;

/**
 * @param {Array<{key:any, cx:number, cy:number, width:number, height:number}>} labels — in priority order
 * @param {Array<{x:number,y:number,width:number,height:number}>} obstacles — node rects
 * @returns {Set<any>} keys of labels that fit
 */
export function placeLabels(labels, obstacles, pad = 4) {
  const kept = [];
  const keys = new Set();
  for (const l of labels) {
    const box = { x: l.cx - l.width / 2, y: l.cy - l.height / 2, width: l.width, height: l.height };
    if (obstacles.some(o => hit(box, o, pad)) || kept.some(k => hit(box, k, pad))) continue;
    kept.push(box);
    keys.add(l.key);
  }
  return keys;
}
