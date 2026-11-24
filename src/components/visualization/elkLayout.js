// components/visualization/elkLayout.js
//
// Shared ELK.js wrapper for the two genuinely general graphs — Clinical
// Flowchart (directed, branching: 'layered') and Knowledge Network
// (cross-linked, no single hierarchy: 'stress'). Mind Map and Mechanism
// Diagram use their own cheaper layouts.
//
// Nodes are laid out at their REAL rendered sizes (nodeTheme.js), and
// flowchart edge labels are given to ELK as sized labels, so ELK reserves
// room for "Unstable (SBP < 90)" between layers and returns the
// orthogonal route + label position it chose. Those routes are drawn as-is
// by diagramEdges.js's RoutedEdge, which is what keeps branch labels from
// colliding.
//
// Lazy-loaded with its two callers' renderers. Imports elkjs's bundled
// browser build (the default entry requires a 'web-worker' polyfill that
// breaks the CRA build).
import ELK from 'elkjs/lib/elk.bundled.js';
import { removeOverlaps } from './overlapRemoval';

const elk = new ELK();

const LAYERED_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '46',
  'elk.spacing.edgeNode': '18',
  'elk.spacing.edgeEdge': '14',
  'elk.spacing.edgeLabel': '6',
  'elk.layered.spacing.edgeNodeBetweenLayers': '18',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.padding': '[top=0,left=0,bottom=0,right=0]',
};

/**
 * @param {Array<{id:string, width:number, height:number}>} nodes
 * @param {Array<{id:string, source:string, target:string, label?:{text:string,width:number,height:number}}>} edges
 * @param {{algorithm?:'layered'|'stress', direction?:string}} [options]
 * @returns {Promise<{positions:Map<string,{x,y,width,height}>, routes:Map<string,{points:Array<{x,y}>, labelBox?:{x,y,width,height}}>}>}
 *   Top-left coordinates, the same anchor React Flow uses.
 */
export async function computeElkLayout(nodes, edges, { algorithm = 'layered', direction = 'DOWN', edgeLength } = {}) {
  const positions = new Map();
  const routes = new Map();
  if (!nodes.length) return { positions, routes };
  const ids = new Set(nodes.map(n => n.id));
  const validEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);

  if (algorithm === 'stress') {
    const avgW = nodes.reduce((s, n) => s + n.width, 0) / nodes.length;
    const result = await elk.layout({
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': String(Math.round(edgeLength || avgW * 0.6 + 90)) },
      children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
      edges: validEdges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    });
    const rects = (result.children || []).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.width, h: c.height }));
    removeOverlaps(rects, { margin: 22 });
    for (const r of rects) positions.set(r.id, { x: r.x, y: r.y, width: r.w, height: r.h });
    return { positions, routes };
  }

  const result = await elk.layout({
    id: 'root',
    layoutOptions: { ...LAYERED_OPTIONS, 'elk.direction': direction },
    children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: validEdges.map(e => ({
      id: e.id, sources: [e.source], targets: [e.target],
      labels: e.label ? [{ id: `${e.id}-label`, text: e.label.text, width: e.label.width, height: e.label.height }] : undefined,
    })),
  });
  for (const c of result.children || []) positions.set(c.id, { x: c.x, y: c.y, width: c.width, height: c.height });
  for (const e of result.edges || []) {
    const sec = e.sections?.[0];
    if (!sec) continue;
    const points = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map(p => ({ x: p.x, y: p.y }));
    const l = e.labels?.[0];
    routes.set(e.id, { points, labelBox: l && Number.isFinite(l.x) ? { x: l.x, y: l.y, width: l.width, height: l.height } : undefined });
  }
  return { positions, routes };
}
