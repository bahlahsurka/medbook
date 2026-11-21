import { buildClinicalFlowchartFlowGraph } from '../components/visualization/clinicalFlowchartGraph';

const FAKE_THEME = {
  surface: '#fff', text2: '#333', border: '#ddd', borderStrong: '#999',
  text: '#111', accent: '#2563eb', danger: '#dc2626', ok: '#16a34a', text3: '#666',
};

const DIAGRAM = {
  topic: 'Test flowchart',
  nodes: [
    { id: 'start', label: 'Start', explanation: 'x', category: 'start', sourceType: 'entry', sourceRef: 'y' },
    { id: 'dec', label: 'Decision?', explanation: 'x', category: 'decision', sourceType: 'entry', sourceRef: 'y' },
    { id: 'out1', label: 'Outcome A', explanation: 'x', category: 'outcome', sourceType: 'entry', sourceRef: 'y' },
    { id: 'out2', label: 'Outcome B', explanation: 'x', category: 'red_flag', sourceType: 'entry', sourceRef: 'y' },
  ],
  edges: [
    { source: 'start', target: 'dec', relationship: 'then', label: '', provenance: 'entry' },
    { source: 'dec', target: 'out1', relationship: 'branches_to', label: 'Yes', provenance: 'entry' },
    { source: 'dec', target: 'out2', relationship: 'branches_to', label: 'No', provenance: 'entry' },
  ],
};

describe('buildClinicalFlowchartFlowGraph', () => {
  test('resolves to a flow graph with every node and edge represented', async () => {
    const { flowNodes, flowEdges } = await buildClinicalFlowchartFlowGraph(DIAGRAM, FAKE_THEME);
    expect(flowNodes).toHaveLength(4);
    expect(flowEdges).toHaveLength(3);
  });

  test('a decision node renders as a hexagon, a start node as a pill', async () => {
    const { flowNodes } = await buildClinicalFlowchartFlowGraph(DIAGRAM, FAKE_THEME);
    const byId = Object.fromEntries(flowNodes.map(n => [n.id, n]));
    expect(byId.dec.data.shape).toBe('hexagon');
    expect(byId.start.data.shape).toBe('pill');
    expect(byId.out1.data.shape).toBe('rect');
  });

  test('branch condition labels get bold/accent styling, distinct from an unlabeled edge', async () => {
    const { flowEdges } = await buildClinicalFlowchartFlowGraph(DIAGRAM, FAKE_THEME);
    const branchEdge = flowEdges.find(e => e.source === 'dec' && e.target === 'out1');
    const plainEdge = flowEdges.find(e => e.source === 'start' && e.target === 'dec');
    expect(branchEdge.label).toBe('Yes');
    expect(branchEdge.labelStyle.fontWeight).toBe(700);
    expect(plainEdge.label).toBeUndefined();
  });

  test('flows top-to-bottom (layered/DOWN) — the decision sits below the start', async () => {
    const { flowNodes } = await buildClinicalFlowchartFlowGraph(DIAGRAM, FAKE_THEME);
    const byId = Object.fromEntries(flowNodes.map(n => [n.id, n]));
    expect(byId.start.position.y).toBeLessThan(byId.dec.position.y);
  });
});
