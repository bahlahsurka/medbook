// components/visualization/mindMapLayout.js
//
// Mind Map layout: a balanced TWO-SIDED TREE — the central topic in the
// middle, depth-1 branches split between the right and left sides (by
// subtree height, keeping the model's order), and each deeper level in its
// own aligned column further out. This replaced a radial layout that had
// no knowledge of node size: wide text labels competed for arc length, so
// small maps overlapped and large maps sprawled. Stacking nodes vertically
// spends their HEIGHT (~40px) instead of their width (~200px), which is
// why it's both overlap-free by construction and far more compact.
//
// Positions are node CENTRES; mindMapGraph.js converts to React Flow's
// top-left anchor. Never mutates the diagram.
import { sizeForNode } from './nodeTheme';

export const MIND_MAP_NODE_SPEC = {
  central_topic: { variant: 'root', tone: 'root' },
  branch: { variant: 'primary', tone: 'accent' },
  red_flag: { variant: 'standard', tone: 'danger', icon: '🚩' },
  high_yield: { variant: 'standard', tone: 'warn', icon: '⭐' },
  subtopic: { variant: 'secondary', tone: 'neutral' },
};

const COLUMN_GAP = 60;   // horizontal gap between a parent column and its children's column
const SIBLING_GAP = 10;  // vertical gap between siblings
const BRANCH_GAP = 22;   // vertical gap between depth-1 branches (separates groups)

export function defaultMindMapSize(node) {
  const spec = MIND_MAP_NODE_SPEC[node?.category] || MIND_MAP_NODE_SPEC.subtopic;
  return sizeForNode({ label: node?.label, ...spec });
}

const OUTLINE_INDENT = 30;      // per-depth indent in outline mode
const OUTLINE_ROOT_INDENT = 40; // children of the (pill-shaped) root sit a little further in
const OUTLINE_GAP = 8;
const OUTLINE_GROUP_GAP = 16;

/**
 * @param {{nodes:Array, edges:Array}} diagram — validated Mind Map shape.
 * @param {(node)=>{width:number,height:number}} [sizeOf]
 * @param {{mode?:'balanced'|'right'|'outline'}} [options]
 *   'balanced': branches split left/right around the centre (default);
 *   'right': every branch to the right (narrower, taller);
 *   'outline': a vertical indented tree for narrow (phone) screens.
 * @returns {Map<string,{x:number,y:number,depth:number,side:number}>} centres; side is +1 right, -1 left, 0 centre.
 */
export function computeMindMapLayout(diagram, sizeOf = defaultMindMapSize, { mode = 'balanced' } = {}) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const positions = new Map();
  if (nodes.length === 0) return positions;

  const size =new Map(nodes.map(n => [n.id, sizeOf(n)]));
  const central = nodes.find(n => n.category === 'central_topic') || nodes[0];

  const adjacency = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (adjacency.has(e.source) && adjacency.has(e.target) && e.source !== e.target) {
      adjacency.get(e.source).push(e.target);
      adjacency.get(e.target).push(e.source);
    }
  }

  // BFS spanning tree: each node gets exactly one parent (first edge to reach it).
  const depth = new Map([[central.id, 0]]);
  const children = new Map(nodes.map(n => [n.id, []]));
  const queue = [central.id];
  while (queue.length) {
    const id = queue.shift();
    for (const nb of adjacency.get(id)) {
      if (depth.has(nb)) continue;
      depth.set(nb, depth.get(id) + 1);
      children.get(id).push(nb);
      queue.push(nb);
    }
  }
  // Unreachable nodes hang directly off the centre rather than being dropped.
  for (const n of nodes) {
    if (!depth.has(n.id)) { depth.set(n.id, 1); children.get(central.id).push(n.id); }
  }

  if (mode === 'outline') {
    // Depth-first, top to bottom; each level indented under its parent.
    let y = 0;
    const walk = (id, left, d) => {
      const { width, height } = size.get(id);
      positions.set(id, { x: left + width / 2, y: y + height / 2, depth: d, side: d === 0 ? 0 : 1 });
      y += height + OUTLINE_GAP;
      const kids = children.get(id);
      kids.forEach((k, i) => {
        walk(k, left + (d === 0 ? OUTLINE_ROOT_INDENT : OUTLINE_INDENT), d + 1);
        if (d === 0 && i < kids.length - 1) y += OUTLINE_GROUP_GAP - OUTLINE_GAP;
      });
    };
    walk(central.id, 0, 0);
    return positions;
  }

  const subtreeHeight = new Map();
  function measure(id) {
    const kids = children.get(id);
    const own = size.get(id).height;
    if (!kids.length) { subtreeHeight.set(id, own); return own; }
    const gap = id === central.id ? BRANCH_GAP : SIBLING_GAP;
    const stacked = kids.reduce((s, k) => s + measure(k), 0) + gap * (kids.length - 1);
    const h = Math.max(own, stacked);
    subtreeHeight.set(id, h);
    return h;
  }
  measure(central.id);

  // Split depth-1 branches between sides, in order, balancing total height.
  const top = children.get(central.id);
  const total = top.reduce((s, k) => s + subtreeHeight.get(k), 0);
  const right = [], left = [];
  let rightH = 0;
  for (const k of top) {
    const h = subtreeHeight.get(k);
    if (mode === 'right' || right.length === 0 || rightH + h / 2 <= total / 2) { right.push(k); rightH += h; } else left.push(k);
  }

  // Column x per (side, depth): aligned columns, each as wide as its widest node.
  const sideOf = new Map();
  const markSide = (list, s) => {
    const stack = [...list];
    while (stack.length) { const id = stack.pop(); sideOf.set(id, s); stack.push(...children.get(id)); }
  };
  markSide(right, 1);
  markSide(left, -1);

  const colWidth = new Map(); // key `${side}:${depth}`
  for (const n of nodes) {
    if (n.id === central.id) continue;
    const key = `${sideOf.get(n.id)}:${depth.get(n.id)}`;
    colWidth.set(key, Math.max(colWidth.get(key) || 0, size.get(n.id).width));
  }
  const colStart = new Map(); // distance from centre to the column's inner edge
  for (const s of [1, -1]) {
    let edge = size.get(central.id).width / 2;
    for (let d = 1; colWidth.has(`${s}:${d}`); d++) {
      colStart.set(`${s}:${d}`, edge + COLUMN_GAP);
      edge = edge + COLUMN_GAP + colWidth.get(`${s}:${d}`);
    }
  }

  positions.set(central.id, { x: 0, y: 0, depth: 0, side: 0 });
  function place(id, centreY) {
    const kids = children.get(id);
    if (!kids.length) return;
    const gap = id === central.id ? BRANCH_GAP : SIBLING_GAP;
    const stacked = kids.reduce((s, k) => s + subtreeHeight.get(k), 0) + gap * (kids.length - 1);
    let cursor = centreY - stacked / 2;
    for (const k of kids) {
      const h = subtreeHeight.get(k);
      const s = sideOf.get(k), d = depth.get(k);
      const x = s * (colStart.get(`${s}:${d}`) + size.get(k).width / 2);
      const y = cursor + h / 2;
      positions.set(k, { x, y, depth: d, side: s });
      place(k, y);
      cursor += h + gap;
    }
  }
  // Each side is stacked independently around the centre line.
  for (const [list] of [[right], [left]]) {
    if (!list.length) continue;
    const stacked = list.reduce((s, k) => s + subtreeHeight.get(k), 0) + BRANCH_GAP * (list.length - 1);
    let cursor = -stacked / 2;
    for (const k of list) {
      const h = subtreeHeight.get(k);
      const s = sideOf.get(k);
      const x = s * (colStart.get(`${s}:1`) + size.get(k).width / 2);
      const y = cursor + h / 2;
      positions.set(k, { x, y, depth: 1, side: s });
      place(k, y);
      cursor += h + BRANCH_GAP;
    }
  }
  return positions;
}
