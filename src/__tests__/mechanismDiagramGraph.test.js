// mechanismDiagramGraph.js is synchronous (sequentialLayout.js, no ELK) —
// unlike knowledgeNetworkGraph.js/clinicalFlowchartGraph.js, which are
// async and already covered by their own renderers' behavior.
import { buildMechanismDiagramFlowGraph } from '../components/visualization/mechanismDiagramGraph';

const FAKE_THEME = {
  surface: '#fff', text2: '#333', border: '#ddd', borderStrong: '#999',
  text: '#111', accent: '#2563eb', danger: '#dc2626', warn: '#d97706', text3: '#666',
};

const DIAGRAM = {
  topic: 'Test mechanism',
  nodes: [
    { id: 'cause', label: 'Cause', explanation: 'x', category: 'cause', sourceType: 'entry', sourceRef: 'y' },
    { id: 'mech', label: 'Mechanism', explanation: 'x', category: 'mechanism', sourceType: 'entry', sourceRef: 'y' },
    { id: 'conseq', label: 'Consequence', explanation: 'x', category: 'consequence', sourceType: 'entry', sourceRef: 'y' },
  ],
  edges: [
    { source: 'cause', target: 'mech', relationship: 'leads_to', label: '' },
    { source: 'mech', target: 'conseq', relationship: 'causes', label: 'eventually' },
  ],
};

describe('buildMechanismDiagramFlowGraph', () => {
  test('is synchronous — returns a plain object, not a Promise', () => {
    const result = buildMechanismDiagramFlowGraph(DIAGRAM, FAKE_THEME);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.flowNodes).toHaveLength(3);
    expect(result.flowEdges).toHaveLength(2);
  });

  test('positions nodes left-to-right by causal layer', () => {
    const { flowNodes } = buildMechanismDiagramFlowGraph(DIAGRAM, FAKE_THEME);
    const byId = Object.fromEntries(flowNodes.map(n => [n.id, n]));
    expect(byId.cause.position.x).toBeLessThan(byId.mech.position.x);
    expect(byId.mech.position.x).toBeLessThan(byId.conseq.position.x);
  });

  test('carries the edge label through for rendering', () => {
    const { flowEdges } = buildMechanismDiagramFlowGraph(DIAGRAM, FAKE_THEME);
    const labeled = flowEdges.find(e => e.source === 'mech' && e.target === 'conseq');
    expect(labeled.label).toBe('eventually');
  });

  test('every node gets a graphNode type and a style object', () => {
    const { flowNodes } = buildMechanismDiagramFlowGraph(DIAGRAM, FAKE_THEME);
    for (const n of flowNodes) {
      expect(n.type).toBe('graphNode');
      expect(typeof n.data.style).toBe('object');
    }
  });

  test('Phase 4: a node carrying a `position` field overrides the computed sequential layout for that node only', () => {
    const withOverride = { ...DIAGRAM, nodes: DIAGRAM.nodes.map(n => (n.id === 'mech' ? { ...n, position: { x: 12, y: 34 } } : n)) };
    const { flowNodes } = buildMechanismDiagramFlowGraph(withOverride, FAKE_THEME);
    expect(flowNodes.find(n => n.id === 'mech').position).toEqual({ x: 12, y: 34 });
  });
});
