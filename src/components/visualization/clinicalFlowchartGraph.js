// components/visualization/clinicalFlowchartGraph.js
//
// Converts a validated Clinical Flowchart diagram into @xyflow/react's
// {nodes, edges} shape, using ELK.js's 'layered' top-to-bottom algorithm
// (see elkLayout.js) — the standard, correct layout for a directed,
// branching flow, and genuinely hard to hand-roll well for anything but
// a trivial linear chain (unlike Mechanism Diagram's simpler staged
// chain, which gets its own much cheaper sequentialLayout.js instead).
import { computeElkLayout } from './elkLayout';
import { pickHandle } from './pickHandle';

const CATEGORY_ICON = { red_flag: '🚩', decision: '◆' };

function styleFor(t, category) {
  const card = { background: t.surface, color: t.text2, border: `1px solid ${t.border}`, fontWeight: 500, fontSize: 12.5, padding: '9px 14px' };
  switch (category) {
    case 'start': return { background: t.accent, color: '#fff', border: `1px solid ${t.accent}`, fontWeight: 700, fontSize: 13.5, padding: '11px 18px', boxShadow: `0 4px 12px -4px ${t.accent}70` };
    case 'decision': return { ...card, borderLeft: `3px solid ${t.accent}`, color: t.text, fontWeight: 600, selectedRingColor: `${t.accent}55` };
    case 'red_flag': return { ...card, borderLeft: `3px solid ${t.danger}`, color: t.danger, fontWeight: 600, selectedRingColor: `${t.danger}55` };
    case 'outcome': return { ...card, borderLeft: `3px solid ${t.ok}`, color: t.ok, fontWeight: 600, selectedRingColor: `${t.ok}55` };
    default: return { ...card, borderLeft: `3px solid ${t.borderStrong}`, selectedRingColor: 'rgba(37,99,235,.35)' }; // 'action'
  }
}

function shapeFor(category) {
  if (category === 'decision') return 'hexagon';
  if (category === 'start') return 'pill';
  return 'rect';
}

export async function buildClinicalFlowchartFlowGraph(diagram, t) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const positions = await computeElkLayout(nodes.map(n => ({ id: n.id, label: n.label })), edges, { algorithm: 'layered', direction: 'DOWN' });

  const flowNodes = nodes.map(n => {
    const pos = positions.get(n.id) || { x: 0, y: 0 };
    return {
      id: n.id,
      type: 'graphNode',
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label, style: styleFor(t, n.category), shape: shapeFor(n.category), icon: CATEGORY_ICON[n.category],
        explanation: n.explanation, sourceType: n.sourceType, sourceRef: n.sourceRef,
      },
      draggable: true,
    };
  });

  const positionOf = (id) => positions.get(id) || { x: 0, y: 0 };
  const flowEdges = edges.map((e, i) => {
    const s = positionOf(e.source), tp = positionOf(e.target);
    const dx = tp.x - s.x, dy = tp.y - s.y;
    const hasBranchLabel = !!e.label;
    return {
      id: `cf-e${i}-${e.source}-${e.target}`,
      source: e.source, target: e.target,
      sourceHandle: pickHandle(dx, dy), targetHandle: pickHandle(-dx, -dy),
      label: e.label || undefined,
      // Branch conditions ("Yes" / "No" / a specific threshold) are the
      // single most important thing to read at a glance on a flowchart —
      // bold and theme-accented rather than the quieter grey Mind Map/
      // Knowledge Network use for their more incidental edge labels.
      labelStyle: hasBranchLabel
        ? { fill: t.accent, fontSize: 11, fontWeight: 700, fontFamily: 'Inter,sans-serif' }
        : { fill: t.text3, fontSize: 10.5, fontFamily: 'Inter,sans-serif' },
      labelBgStyle: { fill: t.surface }, labelBgPadding: [4, 2],
      style: { stroke: t.borderStrong, strokeWidth: 1.8 },
      type: 'smoothstep',
    };
  });

  return { flowNodes, flowEdges };
}
