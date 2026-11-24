// components/visualization/clinicalFlowchartGraph.js
//
// Converts a validated Clinical Flowchart into @xyflow/react's {nodes,
// edges} using ELK 'layered' top-to-bottom (elkLayout.js). Branch
// conditions are measured and handed to ELK as labels, and the routes ELK
// returns are drawn as-is (diagramEdges.js RoutedEdge), so conditions sit
// on their own branch instead of colliding on a shared segment.
// React Flow's MarkerType.ArrowClosed is the plain string 'arrowclosed', so this module stays importable without the React Flow runtime (e.g. in unit tests).
const ARROW = 'arrowclosed';
import { computeElkLayout } from './elkLayout';
import { nodeData, toneStyle } from './nodeTheme';
import { measureNode } from './nodeMetrics';
import { pickHandle } from './pickHandle';
import { boundsOfRects, pickBestFit } from './viewport';

const NODE_SPEC = {
  start: { variant: 'root', tone: 'root', shape: 'pill' },
  decision: { variant: 'primary', tone: 'decision', shape: 'hexagon' },
  action: { variant: 'standard', tone: 'neutral' },
  outcome: { variant: 'standard', tone: 'ok', icon: '✓' },
  red_flag: { variant: 'standard', tone: 'danger', icon: '🚩' },
};

export const BRANCH_LABEL_SPEC = { fontSize: 11, weight: 700, lineHeight: 1.3, padX: 7, padY: 3, minWidth: 0, maxWidth: 150, extraX: 2, extraY: 2 };

/**
 * @param {{topic,nodes,edges}} diagram
 * @param {object} t
 * @param {{container?:{width,height,insets}}} [options] — with a container,
 *   left-to-right is used instead of the conventional top-to-bottom only
 *   when it fits that container clearly better.
 */
export async function buildClinicalFlowchartFlowGraph(diagram, t, { container } = {}) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const specOf = (n) => NODE_SPEC[n.category] || NODE_SPEC.action;
  const built = new Map(nodes.map(n => [n.id, nodeData(n, specOf(n))]));
  const edgeId = (e, i) => `cf-e${i}-${e.source}-${e.target}`;

  const elkNodes = nodes.map(n => ({ id: n.id, ...built.get(n.id).size }));
  const elkEdges = edges.map((e, i) => ({
    id: edgeId(e, i), source: e.source, target: e.target,
    label: e.label ? { text: e.label, ...measureNode(e.label, BRANCH_LABEL_SPEC) } : undefined,
  }));
  const directions = container ? ['DOWN', 'RIGHT'] : ['DOWN'];
  const layouts = await Promise.all(directions.map(async (direction) => {
    const result = await computeElkLayout(elkNodes, elkEdges, { algorithm: 'layered', direction });
    return { key: direction, ...result, bounds: boundsOfRects([...result.positions.values()]) };
  }));
  const chosen = layouts.length > 1 ? pickBestFit(layouts, container, 1.25) : layouts[0];
  const { positions, routes } = chosen;
  // A node the user dragged while editing carries its own top-left
  // `position` (graphDiagramEdits.js's moveNode), which always wins; edges
  // touching it fall back from ELK's route to a live curve.
  const byId = new Map(nodes.map(n => [n.id, n]));
  const layoutAt = (id) => { const p = positions.get(id); return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }; };
  const positionOf = (id) => byId.get(id)?.position || layoutAt(id);

  const flowNodes = nodes.map(n => ({
    id: n.id,
    type: 'graphNode',
    position: positionOf(n.id),
    data: { ...built.get(n.id).data, style: toneStyle(t, specOf(n).tone) },
    draggable: true,
  }));

  const stroke = t.text4;
  const flowEdges = edges.map((e, i) => {
    const s = positionOf(e.source), tp = positionOf(e.target);
    const dx = tp.x - s.x, dy = tp.y - s.y;
    const hasBranchLabel = !!e.label;
    const route = routes.get(edgeId(e, i));
    return {
      id: edgeId(e, i),
      source: e.source, target: e.target,
      sourceHandle: pickHandle(dx, dy), targetHandle: pickHandle(-dx, -dy),
      type: 'routed',
      label: e.label || undefined,
      // Branch conditions are the most important thing to read on a
      // flowchart — bold and accent-coloured.
      labelStyle: hasBranchLabel
        ? { fill: t.accent, fontSize: 11, fontWeight: 700, fontFamily: 'Inter,sans-serif' }
        : { fill: t.text3, fontSize: 10.5, fontFamily: 'Inter,sans-serif' },
      style: { stroke, strokeWidth: 1.7 },
      markerEnd: { type: ARROW, color: stroke, width: 16, height: 16 },
      data: { points: route?.points, labelBox: route?.labelBox, sourceAt: layoutAt(e.source), targetAt: layoutAt(e.target) },
    };
  });

  return { flowNodes, flowEdges, meta: { direction: chosen.key } };
}
