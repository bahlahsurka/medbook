// components/visualization/mechanismDiagramGraph.js
//
// Converts a validated Mechanism Diagram into @xyflow/react's
// {nodes, edges} shape. SYNCHRONOUS, unlike knowledgeNetworkGraph.js/
// clinicalFlowchartGraph.js — sequentialLayout.js's longest-path layering
// is cheap pure math, no async layout engine needed (see that file's own
// header on why a staged chain doesn't need ELK's weight).
import { computeSequentialLayout } from './sequentialLayout';
import { pickHandle } from './pickHandle';

const CATEGORY_ICON = { red_flag: '🚩' };

function styleFor(t, category) {
  const card = { background: t.surface, color: t.text2, border: `1px solid ${t.border}`, fontWeight: 500, fontSize: 12.5, padding: '9px 14px' };
  switch (category) {
    case 'cause': return { ...card, borderLeft: `3px solid ${t.borderStrong}`, color: t.text, fontWeight: 600, selectedRingColor: 'rgba(37,99,235,.35)' };
    case 'consequence': return { ...card, borderLeft: `3px solid ${t.accent}`, color: t.text, selectedRingColor: `${t.accent}55` };
    case 'red_flag': return { ...card, borderLeft: `3px solid ${t.danger}`, color: t.danger, fontWeight: 600, selectedRingColor: `${t.danger}55` };
    default: return { ...card, borderLeft: `3px solid ${t.warn}`, color: t.text2, selectedRingColor: `${t.warn}55` }; // 'mechanism'
  }
}

/** @param {{topic,nodes,edges}} diagram */
export function buildMechanismDiagramFlowGraph(diagram, t) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const positions = computeSequentialLayout(nodes.map(n => ({ id: n.id })), edges);
  // Phase 4: a node the user has dragged during editing carries its own
  // `position` field (graphDiagramEdits.js's moveNode) that overrides the
  // computed sequential-layout placement for THAT node only — a diagram
  // with no dragged nodes yet lays out exactly as before.
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
      id: `md-e${i}-${e.source}-${e.target}`,
      source: e.source, target: e.target,
      sourceHandle: pickHandle(dx, dy), targetHandle: pickHandle(-dx, -dy),
      label: e.label || undefined,
      labelStyle: { fill: t.text3, fontSize: 10.5, fontFamily: 'Inter,sans-serif' },
      labelBgStyle: { fill: t.surface }, labelBgPadding: [4, 2],
      style: { stroke: t.borderStrong, strokeWidth: 1.8 },
      type: 'smoothstep',
    };
  });

  return { flowNodes, flowEdges };
}
