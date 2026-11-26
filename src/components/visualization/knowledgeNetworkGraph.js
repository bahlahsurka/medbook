// components/visualization/knowledgeNetworkGraph.js
//
// Converts a validated Knowledge Network into @xyflow/react's {nodes,
// edges}, laid out by ELK 'stress' (a network has cross-links and no single
// root) followed by overlap removal (elkLayout.js). Hub concepts — the most
// connected nodes — are drawn larger so the network's structure reads at a
// glance; links are direct arrows, and relationship names are shown when
// the network is sparse enough for them to stay legible (otherwise they
// appear for a selected node's own links; see diagramSelection.js).
// React Flow's MarkerType.ArrowClosed is the plain string 'arrowclosed', so this module stays importable without the React Flow runtime (e.g. in unit tests).
const ARROW = 'arrowclosed';
import { computeElkLayout } from './elkLayout';
import { nodeData, toneStyle } from './nodeTheme';
import { pickHandle } from './pickHandle';
import { measureNode } from './nodeMetrics';
import { rectBorderPoint } from './edgeGeometry';
import { placeLabels, EDGE_LABEL_SPEC, humanizeRelationship } from './labelPlacement';

const MAX_LABELLED_EDGES = 16;

function specFor(category, isHub) {
  if (category === 'red_flag') return { variant: isHub ? 'primary' : 'standard', tone: 'danger', icon: '🚩' };
  if (category === 'high_yield') return { variant: isHub ? 'primary' : 'standard', tone: 'warn', icon: '⭐' };
  return isHub ? { variant: 'primary', tone: 'accent' } : { variant: 'secondary', tone: 'neutral' };
}

function edgeStyleFor(t) {
  return { stroke: t.text4, strokeWidth: 1.5 };
}

// Computed once per (diagram, theme); selection highlighting is applied
// afterwards by the renderer without re-running ELK.
export async function buildKnowledgeNetworkFlowGraph(diagram, t) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const degree = new Map(nodes.map(n => [n.id, 0]));
  edges.forEach(e => { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); });
  const maxDegree = Math.max(0, ...degree.values());
  const hubThreshold = Math.max(3, Math.ceil(maxDegree * 0.6));
  const specOf = (n) => specFor(n.category, nodes.length > 3 && degree.get(n.id) >= hubThreshold);
  const built = new Map(nodes.map(n => [n.id, nodeData(n, specOf(n))]));

  const showLabels = edges.length <= MAX_LABELLED_EDGES;
  const labelText = (e) => [humanizeRelationship(e.relationship), String(e.label || '').trim()].filter(Boolean).join(' · ');
  const labelSizes = edges.map(e => (labelText(e) ? measureNode(labelText(e), EDGE_LABEL_SPEC) : null));
  const avgW = nodes.length ? [...built.values()].reduce((s, b) => s + b.size.width, 0) / nodes.length : 150;
  const avgLabel = showLabels && labelSizes.some(Boolean)
    ? labelSizes.filter(Boolean).reduce((s, l) => s + l.width, 0) / labelSizes.filter(Boolean).length : 0;

  const { positions } = await computeElkLayout(
    nodes.map(n => ({ id: n.id, ...built.get(n.id).size })),
    edges.map((e, i) => ({ id: `kn-e${i}`, source: e.source, target: e.target })),
    // Longer links when relationship names will be drawn on them, and when
    // a hub has many neighbours (they need a ring with room for each).
    { algorithm: 'stress', edgeLength: Math.max(avgW * 0.6 + 90 + avgLabel * 0.7, (maxDegree * (avgW * 0.3 + 18)) / (2 * Math.PI)) },
  );
  // A node the user dragged while editing carries its own top-left
  // `position` (graphDiagramEdits.js's moveNode), which always wins.
  const byId = new Map(nodes.map(n => [n.id, n]));
  const positionOf = (id) => byId.get(id)?.position || positions.get(id) || { x: 0, y: 0 };
  const rectOf = (id) => ({ ...positionOf(id), w: built.get(id)?.size.width || 0, h: built.get(id)?.size.height || 0 });

  // Relationship names only where their pill lands clear of nodes/other labels.
  const fitting = showLabels ? placeLabels(edges.map((e, i) => {
    if (!labelSizes[i] || !built.has(e.source) || !built.has(e.target)) return null;
    const a = rectOf(e.source), b = rectOf(e.target);
    const p = rectBorderPoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const q = rectBorderPoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    return { key: i, cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, width: labelSizes[i].width, height: labelSizes[i].height };
  }).filter(Boolean), nodes.map(n => { const r = rectOf(n.id); return { x: r.x, y: r.y, width: r.w, height: r.h }; })) : new Set();

  const flowNodes = nodes.map(n => {
    const pos = positionOf(n.id);
    return {
      id: n.id,
      type: 'graphNode',
      position: { x: pos.x, y: pos.y },
      data: { ...built.get(n.id).data, style: toneStyle(t, specOf(n).tone) },
      draggable: true,
    };
  });

  const flowEdges = edges.map((e, i) => {
    const s = positionOf(e.source), tp = positionOf(e.target);
    const dx = tp.x - s.x, dy = tp.y - s.y;
    const style = edgeStyleFor(t);
    return {
      id: `kn-e${i}-${e.source}-${e.target}`,
      source: e.source, target: e.target,
      sourceHandle: pickHandle(dx, dy), targetHandle: pickHandle(-dx, -dy),
      type: 'link',
      label: labelText(e) || undefined,
      labelStyle: { fill: t.text3, fontSize: 10.5, fontWeight: 600 },
      style,
      markerEnd: { type: ARROW, color: style.stroke, width: 15, height: 15 },
      data: { showLabel: fitting.has(i) },
    };
  });

  return { flowNodes, flowEdges };
}
