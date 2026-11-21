// components/visualization/knowledgeNetworkGraph.js
//
// Converts a validated Knowledge Network diagram into @xyflow/react's
// {nodes, edges} shape, using ELK.js's 'force' algorithm for layout (see
// elkLayout.js's own header on why this type gets ELK and Mind Map
// doesn't) — a genuine graph with cross-links, not a tree, so there's no
// single "center" to radiate from the way mindMapLayout.js assumes.
// ASYNC (ELK's layout() returns a Promise) — KnowledgeNetworkRenderer.js
// handles that with its own loading state, unlike Mind Map's synchronous
// useMemo.
import { computeElkLayout } from './elkLayout';
import { pickHandle } from './pickHandle';

function styleFor(t, category) {
  const card = { background: t.surface, color: t.text2, border: `1px solid ${t.border}`, fontWeight: 500, fontSize: 12.5, padding: '9px 14px' };
  switch (category) {
    case 'red_flag': return { ...card, borderLeft: `3px solid ${t.danger}`, color: t.danger, fontWeight: 600, selectedRingColor: `${t.danger}55` };
    case 'high_yield': return { ...card, borderLeft: `3px solid ${t.warn}`, color: t.warn, fontWeight: 600, selectedRingColor: `${t.warn}55` };
    default: return { ...card, borderLeft: `3px solid ${t.accent}`, color: t.text, selectedRingColor: `${t.accent}55` };
  }
}
const CATEGORY_ICON = { red_flag: '🚩', high_yield: '⭐' };

function edgeStyleFor(t, provenance) {
  return provenance === 'entry'
    ? { stroke: t.borderStrong, strokeWidth: 1.8 }
    : { stroke: t.text4, strokeWidth: 1.4, strokeDasharray: '5 4' };
}

// Deliberately does NOT take `selectedId` — ELK layout is async and
// relatively expensive to re-run, so the renderer computes this ONCE per
// (diagram, theme) change and applies selection highlighting afterward
// with a cheap synchronous map, rather than re-running ELK on every click.
export async function buildKnowledgeNetworkFlowGraph(diagram, t) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const positions = await computeElkLayout(nodes.map(n => ({ id: n.id, label: n.label })), edges, { algorithm: 'force' });
  // Phase 4: a node the user has dragged during editing carries its own
  // `position` field (graphDiagramEdits.js's moveNode) that overrides
  // ELK's own computed placement for THAT node only — a diagram with no
  // dragged nodes yet lays out exactly as before.
  const byId = new Map(nodes.map(n => [n.id, n]));
  const positionOf = (id) => byId.get(id)?.position || positions.get(id) || { x: 0, y: 0 };

  const flowNodes = nodes.map(n => {
    const pos = positionOf(n.id);
    return {
      id: n.id,
      type: 'graphNode',
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label, style: styleFor(t, n.category), shape: 'rect', icon: CATEGORY_ICON[n.category],
        explanation: n.explanation, sourceType: n.sourceType, sourceRef: n.sourceRef,
      },
      draggable: true,
    };
  });

  const flowEdges = edges.map((e, i) => {
    const s = positionOf(e.source), tp = positionOf(e.target);
    const dx = tp.x - s.x, dy = tp.y - s.y;
    return {
      id: `kn-e${i}-${e.source}-${e.target}`,
      source: e.source, target: e.target,
      sourceHandle: pickHandle(dx, dy), targetHandle: pickHandle(-dx, -dy),
      label: e.label || undefined,
      labelStyle: { fill: t.text3, fontSize: 10.5, fontFamily: 'Inter,sans-serif' },
      labelBgStyle: { fill: t.surface }, labelBgPadding: [4, 2],
      style: edgeStyleFor(t, e.provenance),
      type: 'smoothstep',
    };
  });

  return { flowNodes, flowEdges };
}
