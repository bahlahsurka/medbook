// components/visualization/sequentialLayout.js
//
// Pure positioning math for Mechanism Diagram — a staged cause -> mechanism
// -> consequence CHAIN (possibly branching/converging, e.g. one cause
// feeding two parallel downstream mechanisms), but never a general tangled
// network the way Knowledge Network can be. That's exactly the case this
// phase's own brief says does NOT need ELK.js: a longest-path-from-root
// layering is simple to hand-roll correctly and gives the same "staged
// left-to-right flow" read a mechanism diagram needs — see elkLayout.js's
// own header comment for where ELK IS used instead, and why.
//
// `stage` (cause/mechanism/consequence) drives colour in
// mechanismDiagramGraph.js, not position — position comes purely from
// graph structure (how far a node is from a root cause), so a mechanism
// diagram with several intermediate steps lays out correctly regardless
// of how many "mechanism"-stage nodes sit between the cause and the
// consequence.

const COLUMN_SPACING = 230;
const ROW_SPACING = 100;

/**
 * @param {Array<{id:string}>} nodes
 * @param {Array<{source:string, target:string}>} edges
 * @returns {Map<string,{x:number,y:number}>}
 */
export function computeSequentialLayout(nodes, edges) {
  const positions = new Map();
  if (nodes.length === 0) return positions;

  const idSet = new Set(nodes.map(n => n.id));
  const incoming = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      incoming.get(e.target).push(e.source);
    }
  }

  // Layer = length of the longest path reaching this node from any root
  // (a node with no incoming edges — a "cause"). `visiting` guards against
  // a cycle looping forever; a real mechanism diagram shouldn't have one,
  // but this never hangs even if the model produces one.
  const layer = new Map();
  function computeLayer(id, visiting) {
    if (layer.has(id)) return layer.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id) || [];
    const l = preds.length === 0 ? 0 : 1 + Math.max(...preds.map(p => computeLayer(p, visiting)));
    layer.set(id, l);
    return l;
  }
  for (const n of nodes) computeLayer(n.id, new Set());

  const byLayer = new Map();
  for (const n of nodes) {
    const l = layer.get(n.id);
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l).push(n.id);
  }

  for (const [l, ids] of byLayer) {
    ids.forEach((id, i) => {
      const yOffset = (i - (ids.length - 1) / 2) * ROW_SPACING;
      positions.set(id, { x: l * COLUMN_SPACING, y: yOffset });
    });
  }

  return positions;
}
