// Covers the diagram -> @xyflow/react shape conversion, independent of
// any actual React Flow/DOM rendering — see mindMapGraph.js's own header
// comment. Exercises exactly the two things most likely to silently break
// this feature: picking a sensible handle per edge direction, and the
// provenance-based "is this grounded in the entry or supplementary
// context" edge styling the audit called for.
import { buildFlowGraph, pickHandle } from '../components/visualization/mindMapGraph';

const LIGHT_T = {
  accent: '#2563eb', surface: '#fff', surface2: '#eee', text: '#111', text2: '#333', text3: '#666', text4: '#999',
  border: '#ddd', borderStrong: '#ccc', dangerBg: '#fee', dangerBorder: '#fcc', danger: '#c00',
  warnBg: '#ffe', warnBorder: '#fd8', warn: '#a60',
};

function diagram(nodes, edges) {
  return { centralTopic: 'x', nodes, edges };
}
const n = (id, category = 'subtopic') => ({ id, label: id, explanation: 'exp', category, sourceType: 'entry', sourceRef: 'x' });

describe('pickHandle', () => {
  test('picks right for a positive-dx-dominant direction', () => {
    expect(pickHandle(100, 10)).toBe('right');
  });
  test('picks left for a negative-dx-dominant direction', () => {
    expect(pickHandle(-100, 10)).toBe('left');
  });
  test('picks bottom for a positive-dy-dominant direction', () => {
    expect(pickHandle(5, 100)).toBe('bottom');
  });
  test('picks top for a negative-dy-dominant direction', () => {
    expect(pickHandle(5, -100)).toBe('top');
  });
});

describe('buildFlowGraph', () => {
  const d = diagram(
    [n('central', 'central_topic'), n('branch', 'branch'), n('ctx', 'subtopic')],
    [
      { source: 'central', target: 'branch', relationship: 'treats', label: 'via fluids', provenance: 'entry' },
    ]
  );
  // Give the 'ctx' node an ai_context-provenance edge to central for the
  // mixed-provenance styling check below.
  d.nodes[2].sourceType = 'ai_context';
  d.edges.push({ source: 'central', target: 'ctx', relationship: 'related_to', label: '', provenance: 'mixed' });

  const centreOf = (fn) => ({ x: fn.position.x + fn.data.width / 2, y: fn.position.y + fn.data.height / 2 });

  test('produces one flow node per diagram node, positioned from the layout (central topic centred on the origin)', () => {
    const { flowNodes } = buildFlowGraph(d, LIGHT_T, {});
    expect(flowNodes).toHaveLength(3);
    expect(centreOf(flowNodes.find(fn => fn.id === 'central'))).toEqual({ x: 0, y: 0 });
  });

  test('every node carries its measured layout size', () => {
    const { flowNodes } = buildFlowGraph(d, LIGHT_T, {});
    for (const fn of flowNodes) {
      expect(fn.data.width).toBeGreaterThan(0);
      expect(fn.data.height).toBeGreaterThan(0);
    }
  });

  test('the central node is not draggable; others are', () => {
    const { flowNodes } = buildFlowGraph(d, LIGHT_T, {});
    expect(flowNodes.find(fn => fn.id === 'central').draggable).toBe(false);
    expect(flowNodes.find(fn => fn.id === 'branch').draggable).toBe(true);
  });

  test('marks the selected node id as selected', () => {
    const { flowNodes } = buildFlowGraph(d, LIGHT_T, { selectedId: 'branch' });
    expect(flowNodes.find(fn => fn.id === 'branch').selected).toBe(true);
    expect(flowNodes.find(fn => fn.id === 'central').selected).toBe(false);
  });

  test('every node uses the shared custom node type', () => {
    const { flowNodes } = buildFlowGraph(d, LIGHT_T, {});
    expect(flowNodes.every(fn => fn.type === 'mindMapNode')).toBe(true);
  });

  test('produces one flow edge per diagram edge, with a relationship label when given', () => {
    const { flowEdges } = buildFlowGraph(d, LIGHT_T, {});
    expect(flowEdges).toHaveLength(2);
    expect(flowEdges.find(fe => fe.target === 'branch').label).toBe('via fluids');
  });

  test('edges are drawn the same whatever their source (no provenance styling)', () => {
    const { flowEdges } = buildFlowGraph(d, LIGHT_T, {});
    const entryEdge = flowEdges.find(fe => fe.target === 'branch');
    const mixedEdge = flowEdges.find(fe => fe.target === 'ctx');
    expect(entryEdge.style.strokeDasharray).toBeUndefined();
    expect(mixedEdge.style.strokeDasharray).toBeUndefined();
  });

  test('each edge resolves a concrete source/target handle id', () => {
    const { flowEdges } = buildFlowGraph(d, LIGHT_T, {});
    for (const e of flowEdges) {
      expect(['top', 'right', 'bottom', 'left']).toContain(e.sourceHandle);
      expect(['top', 'right', 'bottom', 'left']).toContain(e.targetHandle);
    }
  });

  test('with a narrow container, picks the outline layout and draws elbow routes for tree links', () => {
    const { flowEdges, meta } = buildFlowGraph(d, LIGHT_T, { container: { width: 380, height: 600, insets: { top: 60, left: 12, right: 12, bottom: 46 } } });
    expect(meta.mode).toBe('outline');
    const tree = flowEdges.find(fe => fe.target === 'branch');
    expect(tree.type).toBe('routed');
    expect(tree.data.points.length).toBeGreaterThanOrEqual(3);
  });

  test('with a wide container, picks a balanced or one-sided tree with curved branch links', () => {
    const { flowEdges, meta } = buildFlowGraph(d, LIGHT_T, { container: { width: 900, height: 600, insets: { top: 60, left: 22, right: 22, bottom: 46 } } });
    expect(['balanced', 'right']).toContain(meta.mode);
    expect(flowEdges.every(fe => fe.type === 'branch')).toBe(true);
  });

  test('Phase 4: a node carrying a `position` field overrides the computed layout for that node only', () => {
    const central = n('central', 'central_topic');
    const branch = { ...n('branch'), position: { x: 999, y: -123 } };
    const dWithOverride = diagram([central, branch], [{ source: 'central', target: 'branch', relationship: 'x', label: '' }]);
    const { flowNodes } = buildFlowGraph(dWithOverride, LIGHT_T, {});
    expect(flowNodes.find(fn => fn.id === 'branch').position).toEqual({ x: 999, y: -123 });
    // The un-overridden central node still gets its normal computed position.
    expect(centreOf(flowNodes.find(fn => fn.id === 'central'))).toEqual({ x: 0, y: 0 });
  });
});
