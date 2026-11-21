// components/visualization/elkLayout.js
//
// Shared ELK.js wrapper for the two visualization types that are genuinely
// general/complex graphs — Knowledge Network (many interconnections, no
// single tree-like hierarchy, can have cycles) and Clinical Flowchart (a
// true directed, branching flow with Yes/No decisions) — per this phase's
// own brief: "Use ELK.js... only where genuinely necessary, especially for
// complex flowcharts or networks." Mind Map (a tree radiating from one
// center) keeps its own much cheaper radial layout (mindMapLayout.js,
// unchanged from Phase 2) and Mechanism Diagram (a simple linear stage
// chain) gets its own purpose-built one (sequentialLayout.js) — neither
// is a "complex flowchart or network", so bringing ELK's weight to them
// would be exactly the unnecessary-dependency-use this phase warns against.
//
// Lazy-loaded alongside its two callers' own renderers (KnowledgeNetwork
// Renderer.js / ClinicalFlowchartRenderer.js), which are themselves
// React.lazy-loaded from VisualLearningPanel.js — elkjs never reaches the
// browser until a user actually opens one of those two diagram types.
//
// Imports elkjs's own browser-safe BUNDLED entry point, not the package's
// default 'elkjs' export — the default entry conditionally requires the
// 'web-worker' Node polyfill package for non-browser environments, and
// webpack's static analysis tries to resolve that require() even though
// it's inside a runtime typeof-check branch that never actually executes
// in a browser, which breaks a CRA/webpack production build ("Module not
// found: Error: Can't resolve 'web-worker'"). elk.bundled.js has the
// layout algorithms inlined with no worker/Node dependency at all — a
// well-documented elkjs+webpack compatibility issue, not something to fix
// by adding a 'web-worker' dependency this app never otherwise needs.
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

// ELK needs SOME box size per node to lay out against — this is a rough
// estimate from the label's own length, not a promise of the exact
// rendered DOM size (GraphNode.js can still wrap/grow slightly within
// this). Good enough for spacing decisions; it doesn't need to be exact.
function estimateSize(label) {
  const width = Math.min(220, Math.max(110, (label || '').length * 7 + 40));
  return { width, height: 48 };
}

/**
 * @param {Array<{id:string, label?:string}>} nodes
 * @param {Array<{source:string, target:string}>} edges
 * @param {{algorithm?:string, direction?:string}} [options] — 'layered'/
 *   'DOWN' for a flowchart's top-to-bottom decision flow; 'force' (no
 *   direction) for a general, non-hierarchical network.
 * @returns {Promise<Map<string,{x:number,y:number,width:number,height:number}>>}
 *   Positions are ELK's own top-left-origin coordinates — GraphNode/React
 *   Flow treat `position` as a top-left anchor too, so no conversion is
 *   needed between the two.
 */
export async function computeElkLayout(nodes, edges, { algorithm = 'layered', direction = 'DOWN' } = {}) {
  if (!nodes.length) return new Map();

  const layoutOptions = {
    'elk.algorithm': algorithm,
    'elk.spacing.nodeNode': '36',
  };
  if (algorithm === 'layered') {
    layoutOptions['elk.direction'] = direction;
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = '70';
  }

  const graph = {
    id: 'root',
    layoutOptions,
    children: nodes.map(n => ({ id: n.id, ...estimateSize(n.label) })),
    edges: edges.map((e, i) => ({ id: `elk-e${i}`, sources: [e.source], targets: [e.target] })),
  };

  const result = await elk.layout(graph);
  const positions = new Map();
  for (const child of result.children || []) {
    positions.set(child.id, { x: child.x, y: child.y, width: child.width, height: child.height });
  }
  return positions;
}
