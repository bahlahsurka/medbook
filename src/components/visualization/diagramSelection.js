// components/visualization/diagramSelection.js
//
// Cheap, synchronous selection overlay (never re-runs layout): the
// selected node and its direct neighbours stay fully visible, everything
// else dims, and the selected node's own links always show their labels —
// so even a dense network can be read one concept at a time.

export function applySelection(flowNodes, flowEdges, selectedId) {
  if (!selectedId) {
    return {
      flowNodes: flowNodes.map(n => (n.selected || n.data?.dimmed ? { ...n, selected: false, data: { ...n.data, dimmed: false } } : n)),
      flowEdges,
    };
  }
  const near = new Set([selectedId]);
  for (const e of flowEdges) {
    if (e.source === selectedId) near.add(e.target);
    if (e.target === selectedId) near.add(e.source);
  }
  return {
    flowNodes: flowNodes.map(n => ({ ...n, selected: n.id === selectedId, data: { ...n.data, dimmed: !near.has(n.id) } })),
    flowEdges: flowEdges.map(e => {
      const touches = e.source === selectedId || e.target === selectedId;
      return { ...e, data: { ...e.data, dimmed: !touches, showLabel: touches ? true : e.data?.showLabel } };
    }),
  };
}

/** Incoming/outgoing connections of a node, for the detail panel. */
export function connectionsOf(diagram, nodeId) {
  const byId = new Map((diagram?.nodes || []).map(n => [n.id, n]));
  const out = [], inc = [];
  for (const e of diagram?.edges || []) {
    const rel = e.label || String(e.relationship || '').replace(/_/g, ' ');
    if (e.source === nodeId && byId.has(e.target)) out.push({ rel, other: byId.get(e.target).label });
    if (e.target === nodeId && byId.has(e.source)) inc.push({ rel, other: byId.get(e.source).label });
  }
  return { out, inc };
}
