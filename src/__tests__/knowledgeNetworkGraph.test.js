import { buildKnowledgeNetworkFlowGraph } from '../components/visualization/knowledgeNetworkGraph';

const FAKE_THEME = {
  surface: '#fff', text2: '#333', border: '#ddd', borderStrong: '#999',
  text: '#111', danger: '#dc2626', warn: '#d97706', text3: '#666', text4: '#999',
};

const DIAGRAM = {
  topic: 'Test network',
  nodes: [
    { id: 'a', label: 'Concept A', explanation: 'x', category: 'concept', sourceType: 'entry', sourceRef: 'y' },
    { id: 'b', label: 'Concept B', explanation: 'x', category: 'red_flag', sourceType: 'entry', sourceRef: 'y' },
    { id: 'c', label: 'Concept C', explanation: 'x', category: 'high_yield', sourceType: 'entry', sourceRef: 'y' },
  ],
  edges: [
    { source: 'a', target: 'b', relationship: 'causes', label: '', provenance: 'entry' },
    { source: 'b', target: 'c', relationship: 'treated_by', label: '', provenance: 'entry' },
    { source: 'a', target: 'c', relationship: 'associated_with', label: '', provenance: 'entry' },
  ],
};

describe('buildKnowledgeNetworkFlowGraph', () => {
  test('resolves to a flow graph with every node and edge represented', async () => {
    const { flowNodes, flowEdges } = await buildKnowledgeNetworkFlowGraph(DIAGRAM, FAKE_THEME);
    expect(flowNodes).toHaveLength(3);
    expect(flowEdges).toHaveLength(3);
    expect(flowNodes.every(n => n.type === 'graphNode')).toBe(true);
  });

  test('a red_flag node gets a distinct icon from a plain concept node', async () => {
    const { flowNodes } = await buildKnowledgeNetworkFlowGraph(DIAGRAM, FAKE_THEME);
    const byId = Object.fromEntries(flowNodes.map(n => [n.id, n]));
    expect(byId.b.data.icon).toBe('🚩');
    expect(byId.a.data.icon).toBeUndefined();
  });

  test('cross-link edges not touching a "first" node still resolve correctly (a real network, not a tree)', async () => {
    const { flowEdges } = await buildKnowledgeNetworkFlowGraph(DIAGRAM, FAKE_THEME);
    expect(flowEdges.some(e => e.source === 'a' && e.target === 'c')).toBe(true);
  });
});
