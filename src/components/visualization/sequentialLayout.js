// components/visualization/sequentialLayout.js
//
// Mechanism Diagram layout: a staged cause -> mechanism -> consequence
// chain (possibly branching/converging), laid out in LAYERS by the longest
// causal path from a root cause. Hand-rolled (no ELK) because a staged
// chain doesn't need a general graph engine.
//
// Size-aware: each layer is as wide as its widest node, nodes within a
// layer stack by their real heights, sibling order is chosen by barycenter
// sweeps to reduce crossings, and each node is pulled toward the centre of
// its causes so a chain reads as a straight line rather than a zig-zag.
// `direction: 'DOWN'` lays the same chain top-to-bottom for narrow screens.

const LAYER_GAP = { RIGHT: 76, DOWN: 52 };   // room for arrows (+ an occasional label)
const SIBLING_GAP = { RIGHT: 18, DOWN: 22 };
const DEFAULT_SIZE = { width: 150, height: 44 };
const WAYPOINT_LANE = 14;

/**
 * @param {Array<{id:string}>} nodes
 * @param {Array<{source:string, target:string}>} edges
 * @param {{sizeOf?:(id:string)=>{width:number,height:number}, direction?:'RIGHT'|'DOWN'}} [options]
 * @returns {{positions:Map<string,{x:number,y:number}>, routes:Map<number,Array<{x:number,y:number}>>}}
 *   top-left node positions, and waypoints (by edge index) for links that skip layers
 */
export function computeSequentialLayoutWithRoutes(nodes, edges, { sizeOf = () => DEFAULT_SIZE, direction = 'RIGHT', layerGap, groupRank } = {}) {
  const positions = new Map();
  if (nodes.length === 0) return { positions, routes: new Map() };
  const horizontal = direction !== 'DOWN';

  const ids = nodes.map(n => n.id);
  const idSet = new Set(ids);
  const preds = new Map(ids.map(id => [id, []]));
  const succs = new Map(ids.map(id => [id, []]));
  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target) {
      preds.get(e.target).push(e.source);
      succs.get(e.source).push(e.target);
    }
  }

  // Layer = longest path from any root; `visiting` stops cycles looping.
  const layer = new Map();
  const computeLayer = (id, visiting) => {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const p = preds.get(id);
    const l = p.length === 0 ? 0 : 1 + Math.max(...p.map(x => computeLayer(x, visiting)));
    visiting.delete(id);
    layer.set(id, l);
    return l;
  };
  ids.forEach(id => computeLayer(id, new Set()));

  const size = new Map(ids.map(id => [id, sizeOf(id) || DEFAULT_SIZE]));

  // A link that skips layers gets a chain of thin virtual waypoints, one per
  // skipped layer. They take part in ordering and spacing like real nodes,
  // so the long link gets its own lane instead of running under unrelated
  // nodes, and the renderer draws it through those waypoints.
  const chains = new Map(); // edge index -> waypoint ids
  edges.forEach((e, i) => {
    if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) return;
    const ls = layer.get(e.source), lt = layer.get(e.target);
    if (lt - ls <= 1) return;
    const chain = [];
    let prev = e.source;
    for (let l = ls + 1; l < lt; l++) {
      const d = `\u0000wp${i}:${l}`;
      layer.set(d, l);
      size.set(d, horizontal ? { width: 0, height: WAYPOINT_LANE } : { width: WAYPOINT_LANE, height: 0 });
      preds.set(d, [prev]);
      succs.set(d, []);
      succs.get(prev).push(d);
      chain.push(d);
      prev = d;
    }
    // Re-point the direct link through the chain (ordering only).
    succs.set(e.source, succs.get(e.source).filter((x, k, arr) => x !== e.target || arr.indexOf(x) !== k));
    succs.get(prev).push(e.target);
    preds.set(e.target, preds.get(e.target).map(x => (x === e.source ? prev : x)));
    chains.set(i, chain);
  });

  const layers = [];
  const pushTo = (id) => { const l = layer.get(id); (layers[l] = layers[l] || []).push(id); };
  ids.forEach(pushTo);
  chains.forEach(chain => chain.forEach(pushTo));
  for (let l = 0; l < layers.length; l++) layers[l] = layers[l] || [];

  // Optional grouping: within a stage, siblings tied on position keep a
  // group order (e.g. continuing chains first, clinical features last).
  const rankOf = (id) => (groupRank && idSet.has(id) ? groupRank(id) || 0 : 0);
  if (groupRank) layers.forEach(L => L.sort((a, b) => rankOf(a) - rankOf(b)));

  // Barycenter ordering sweeps (down then up) to reduce edge crossings.
  const index = new Map();
  const reindex = () => layers.forEach(L => L.forEach((id, i) => index.set(id, i)));
  reindex();
  const bary = (id, nbrs) => {
    const ns = nbrs.get(id).filter(n => index.has(n));
    return ns.length ? ns.reduce((s, n) => s + index.get(n), 0) / ns.length : index.get(id);
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < layers.length; l++) { layers[l].sort((a, b) => (bary(a, preds) - bary(b, preds)) || (rankOf(a) - rankOf(b))); reindex(); }
    for (let l = layers.length - 2; l >= 0; l--) { layers[l].sort((a, b) => (bary(a, succs) - bary(b, succs)) || (rankOf(a) - rankOf(b))); reindex(); }
  }

  const along = (id) => (horizontal ? size.get(id).width : size.get(id).height);   // extent in flow direction
  const across = (id) => (horizontal ? size.get(id).height : size.get(id).width);  // extent across it
  const gapAcross = SIBLING_GAP[horizontal ? 'RIGHT' : 'DOWN'];

  // Flow-direction coordinate of each layer's start.
  const layerStart = [];
  let cursor = 0;
  layers.forEach((L, l) => {
    layerStart[l] = cursor;
    cursor += Math.max(0, ...L.map(along)) + Math.max(layerGap || 0, LAYER_GAP[horizontal ? 'RIGHT' : 'DOWN']);
  });

  // Cross-direction centres: each node wants to sit at the mean of its
  // causes' centres; siblings are then pushed apart to their real sizes
  // while keeping their order, and the layer is re-centred on its targets.
  const centre = new Map();
  layers.forEach((L, l) => {
    const desired = L.map((id, i) => {
      const p = preds.get(id).filter(x => centre.has(x));
      if (l > 0 && p.length) return p.reduce((s, x) => s + centre.get(x), 0) / p.length;
      return null;
    });
    // Nodes without placed causes stack in order around 0.
    const stackTotal = L.reduce((s, id) => s + across(id), 0) + gapAcross * (L.length - 1);
    let c = -stackTotal / 2;
    const pos = L.map((id, i) => { const v = desired[i] ?? (c + across(id) / 2); c += across(id) + gapAcross; return v; });
    for (let i = 1; i < L.length; i++) {
      const min = pos[i - 1] + (across(L[i - 1]) + across(L[i])) / 2 + gapAcross;
      if (pos[i] < min) pos[i] = min;
    }
    const want = L.map((_, i) => desired[i] ?? pos[i]);
    const shift = L.length ? L.reduce((s, _, i) => s + (want[i] - pos[i]), 0) / L.length : 0;
    L.forEach((id, i) => centre.set(id, pos[i] + shift));
  });

  const waypointAt = new Map();
  layers.forEach((L, l) => {
    const width = Math.max(0, ...L.map(along));
    L.forEach(id => {
      if (!idSet.has(id)) {
        const a = layerStart[l] + width / 2, c = centre.get(id);
        waypointAt.set(id, horizontal ? { x: a, y: c } : { x: c, y: a });
        return;
      }
      const a = layerStart[l] + (width - along(id)) / 2;     // centred within its layer
      const c = centre.get(id) - across(id) / 2;
      positions.set(id, horizontal ? { x: a, y: c } : { x: c, y: a });
    });
  });
  const routes = new Map([...chains].map(([i, chain]) => [i, chain.map(d => waypointAt.get(d))]));
  return { positions, routes };
}

/**
 * @returns {Map<string,{x:number,y:number}>} top-left positions (see computeSequentialLayoutWithRoutes)
 */
export function computeSequentialLayout(nodes, edges, options) {
  return computeSequentialLayoutWithRoutes(nodes, edges, options).positions;
}
