// components/visualization/overlapRemoval.js
//
// Deterministic rectangle overlap removal: repeatedly pushes each
// overlapping pair apart along the axis needing the smaller move, until no
// pair (padded by `margin`) overlaps. Keeps a force/stress layout's overall
// shape while guaranteeing readable, non-colliding nodes. O(n^2) per pass —
// trivial for diagram sizes (tens of nodes).

/**
 * Mutates and returns `rects` ({x, y, w, h}, top-left).
 * @param {Array<{x:number,y:number,w:number,h:number}>} rects
 * @param {{margin?:number, maxPasses?:number}} [options]
 */
export function removeOverlaps(rects, { margin = 16, maxPasses = 300 } = {}) {
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) + margin - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) + margin - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const acx = a.x + a.w / 2, bcx = b.x + b.w / 2, acy = a.y + a.h / 2, bcy = b.y + b.h / 2;
        // Tie-break by index so identical positions still separate deterministically.
        if (ox / (a.w + b.w) < oy / (a.h + b.h)) {
          const dir = bcx > acx || (bcx === acx && j > i) ? 1 : -1;
          a.x -= (dir * ox) / 2; b.x += (dir * ox) / 2;
        } else {
          const dir = bcy > acy || (bcy === acy && j > i) ? 1 : -1;
          a.y -= (dir * oy) / 2; b.y += (dir * oy) / 2;
        }
      }
    }
    if (!moved) break;
  }
  return rects;
}

/** True if any two rects (padded by `margin`) overlap. */
export function hasOverlap(rects, margin = 0) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin) return true;
    }
  }
  return false;
}
