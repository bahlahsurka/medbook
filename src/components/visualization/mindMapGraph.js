// components/visualization/mindMapGraph.js
//
// Converts a validated Mind Map diagram ({centralTopic, nodes, edges} —
// see VisualizationValidator.js) plus computeMindMapLayout's positions
// into the exact {nodes, edges} shape @xyflow/react's <ReactFlow> renders.
// Kept separate from MindMapRenderer.js so the pure data transform (easy
// to unit test) never needs a DOM/React Flow runtime to exercise.
import { computeMindMapLayout } from './mindMapLayout';

const HANDLE_IDS = ['top', 'right', 'bottom', 'left'];

/** Which of a node's four anchor handles points most toward (dx, dy). */
function pickHandle(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

// A relationship NOT grounded in the review itself (touches an ai_context
// node, per VisualizationValidator.js's computed edge.provenance) is drawn
// lighter/dashed rather than identically to an entry-grounded one — the
// rendering-layer half of "unsupported or uncertain relationships can be
// identified rather than silently presented as established facts" (the
// data-layer half is the provenance field itself).
function edgeStyleFor(t, provenance) {
  if (provenance === 'entry') {
    return { stroke: t.borderStrong, strokeWidth: 1.8 };
  }
  return { stroke: t.text4, strokeWidth: 1.4, strokeDasharray: '5 4' };
}

/**
 * @param {{centralTopic:string, nodes:Array, edges:Array}} diagram
 * @param {object} t — current theme tokens (useTheme().t), used for edge colour only;
 *   node colour comes from MindMapNode itself reading useTheme() directly.
 * @param {Set<string>} [expandedIds] — which node ids currently show their
 *   expanded detail (passed through as node data so MindMapNode/the
 *   renderer's detail panel logic stay in sync with one source of truth).
 */
export function buildFlowGraph(diagram, t, { selectedId } = {}) {
  const positions = computeMindMapLayout(diagram);
  // Phase 4: a node the user has dragged during editing carries its own
  // `position` field (see graphDiagramEdits.js's moveNode) that overrides
  // computeMindMapLayout's own radial placement for THAT node only — a
  // diagram with no dragged nodes yet (every pre-Phase-4 diagram) lays out
  // exactly as before, since no node has this field at all.
  const positionOf = (n) => n?.position || positions.get(n?.id) || { x: 0, y: 0 };
  const byId = new Map((diagram?.nodes || []).map(n => [n.id, n]));

  const flowNodes = (diagram?.nodes || []).map(n => {
    const pos = positionOf(n);
    return {
      id: n.id,
      type: 'mindMapNode',
      position: { x: pos.x, y: pos.y },
      selected: n.id === selectedId,
      data: { label: n.label, category: n.category, explanation: n.explanation, sourceType: n.sourceType, sourceRef: n.sourceRef },
      // Central topic is visually the anchor of the whole diagram — pinned
      // so a viewer dragging another node around never accidentally drags
      // the one thing everything else is laid out relative to.
      draggable: n.category !== 'central_topic',
    };
  });

  const flowEdges = (diagram?.edges || []).map((e, i) => {
    const sourcePos = positionOf(byId.get(e.source));
    const targetPos = positionOf(byId.get(e.target));
    const dx = targetPos.x - sourcePos.x;
    const dy = targetPos.y - sourcePos.y;
    return {
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle: pickHandle(dx, dy),
      targetHandle: pickHandle(-dx, -dy),
      label: e.label || undefined,
      labelStyle: { fill: t.text3, fontSize: 10.5, fontFamily: 'Inter,sans-serif' },
      labelBgStyle: { fill: t.surface },
      labelBgPadding: [4, 2],
      style: edgeStyleFor(t, e.provenance),
      type: 'smoothstep',
    };
  });

  return { flowNodes, flowEdges };
}

export { HANDLE_IDS, pickHandle };
