// components/visualization/mindMapLayout.js
//
// Pure positioning math for a Mind Map — deliberately NOT ELK.js. Per the
// architecture audit and this phase's own brief ("do not introduce ELK.js
// yet unless genuinely necessary"): a Mind Map radiating from one central
// topic is exactly the case a simple radial-tree layout already handles
// well, and ELK's weight only earns its keep for a genuinely hierarchical,
// directional diagram (a flowchart) — a later phase's problem, not this
// one's.
//
// Algorithm: BFS from the central_topic node over the diagram's edges
// (treated as undirected for layout purposes — a Mind Map's visual
// structure is "what's near what", not the semantic direction of a
// relationship) builds a spanning tree. Each node then gets an angular
// SLICE of the circle around its parent, sized proportionally to how many
// descendants it has (a branch with many subtopics gets more angular room
// than one with few) — this is what keeps dense branches from cramming
// into each other without needing an iterative force-directed solver.
// Radius grows per depth, and is widened further whenever a depth level
// is crowded enough that the base radius wouldn't give nodes room to
// avoid overlapping along their own arc.
//
// Returns ONLY {x, y} per node id — never mutates the validated diagram
// object itself, so the same {centralTopic, nodes, edges} this module
// receives is exactly what a caller can still send back to the API
// unmodified (e.g. to re-render after a theme change, no re-fetch needed).

const BASE_RADIUS_PER_DEPTH = 240; // px between successive depth rings
const MIN_ARC_SPACING = 90;        // px of arc length to reserve per sibling at a ring

/**
 * @param {{ nodes: Array, edges: Array }} diagram — already validated
 *   (VisualizationValidator.js) shape: nodes have {id, category, ...},
 *   edges have {source, target, ...}.
 * @returns {Map<string, {x:number, y:number, depth:number}>} keyed by node id.
 */
export function computeMindMapLayout(diagram) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const positions = new Map();
  if (nodes.length === 0) return positions;

  const central = nodes.find(n => n.category === 'central_topic') || nodes[0];

  // Undirected adjacency.
  const adjacency = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (adjacency.has(e.source) && adjacency.has(e.target)) {
      adjacency.get(e.source).push(e.target);
      adjacency.get(e.target).push(e.source);
    }
  }

  // BFS spanning tree from the central node — each node gets exactly ONE
  // parent (whichever edge reaches it first), so a node reachable via
  // multiple paths still gets exactly one position instead of a conflict.
  const parent = new Map([[central.id, null]]);
  const depth = new Map([[central.id, 0]]);
  const children = new Map(nodes.map(n => [n.id, []]));
  const queue = [central.id];
  while (queue.length) {
    const id = queue.shift();
    for (const neighbor of adjacency.get(id) || []) {
      if (parent.has(neighbor)) continue; // already placed
      parent.set(neighbor, id);
      depth.set(neighbor, depth.get(id) + 1);
      children.get(id).push(neighbor);
      queue.push(neighbor);
    }
  }
  // Any node the central topic can't reach at all (shouldn't happen —
  // VisualizationValidator.js rejects a multi-node diagram with zero
  // edges — but a disconnected sub-graph among 3+ nodes is still
  // structurally possible) gets depth 1 directly off the center, rather
  // than being silently dropped from the layout.
  for (const n of nodes) {
    if (!parent.has(n.id)) {
      parent.set(n.id, central.id);
      depth.set(n.id, 1);
      children.get(central.id).push(n.id);
    }
  }

  // Descendant (leaf) counts, for proportional angular allocation — a
  // leaf node counts as 1 of itself.
  const leafCount = new Map();
  function countLeaves(id) {
    const kids = children.get(id);
    if (kids.length === 0) { leafCount.set(id, 1); return 1; }
    const total = kids.reduce((sum, k) => sum + countLeaves(k), 0);
    leafCount.set(id, total);
    return total;
  }
  countLeaves(central.id);

  // How many nodes share each depth ring — used to widen that ring's
  // radius when it's crowded, independent of how many depths exist.
  const countsByDepth = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id);
    countsByDepth.set(d, (countsByDepth.get(d) || 0) + 1);
  }
  function radiusForDepth(d) {
    if (d === 0) return 0;
    const base = BASE_RADIUS_PER_DEPTH * d;
    const countAtRing = countsByDepth.get(d) || 1;
    const circumferenceNeeded = countAtRing * MIN_ARC_SPACING;
    const radiusNeeded = circumferenceNeeded / (2 * Math.PI);
    return Math.max(base, radiusNeeded);
  }

  positions.set(central.id, { x: 0, y: 0, depth: 0 });

  // Recursively assign each node an angle within its parent's own slice,
  // proportional to its own leaf-weight among its siblings.
  function assign(id, angleStart, angleEnd) {
    const angle = (angleStart + angleEnd) / 2;
    const d = depth.get(id);
    const r = radiusForDepth(d);
    if (d > 0) {
      positions.set(id, { x: r * Math.cos(angle), y: r * Math.sin(angle), depth: d });
    }

    const kids = children.get(id);
    if (kids.length === 0) return;
    const totalWeight = kids.reduce((sum, k) => sum + leafCount.get(k), 0);
    let cursor = angleStart;
    for (const k of kids) {
      const share = (angleEnd - angleStart) * (leafCount.get(k) / totalWeight);
      assign(k, cursor, cursor + share);
      cursor += share;
    }
  }
  assign(central.id, 0, 2 * Math.PI);

  return positions;
}
