// Pure mutation functions shared by the four graph-based renderers'
// editable mode (Mind Map, Knowledge Network, Clinical Flowchart,
// Mechanism Diagram) — see graphDiagramEdits.js's own header for why this
// is a plain function layer, not a hook.
import {
  cloneDiagram, addNode, updateNode, moveNode, deleteNode,
  addEdge, updateEdge, deleteEdge, USER_ADDED_SOURCE_TYPE,
} from '../components/visualization/graphDiagramEdits';

function baseDiagram() {
  return {
    topic: 'Test',
    nodes: [
      { id: 'a', label: 'A', explanation: 'x', category: 'concept', sourceType: 'entry', sourceRef: 'y' },
      { id: 'b', label: 'B', explanation: 'x', category: 'concept', sourceType: 'entry', sourceRef: 'y' },
    ],
    edges: [{ source: 'a', target: 'b', relationship: 'related_to', label: '' }],
  };
}

describe('cloneDiagram', () => {
  test('deep clones — mutating the clone never touches the original', () => {
    const d = baseDiagram();
    const clone = cloneDiagram(d);
    clone.nodes[0].label = 'changed';
    expect(d.nodes[0].label).toBe('A');
  });

  test('handles a null/undefined diagram safely', () => {
    expect(cloneDiagram(null)).toEqual({ nodes: [], edges: [] });
  });
});

describe('addNode', () => {
  test('adds a node with a unique generated id, user_added provenance, and the requested category', () => {
    const d = baseDiagram();
    const { diagram: next, id } = addNode(d, { category: 'red_flag' });
    expect(next.nodes).toHaveLength(3);
    const added = next.nodes.find(n => n.id === id);
    expect(added.category).toBe('red_flag');
    expect(added.sourceType).toBe(USER_ADDED_SOURCE_TYPE);
    expect(added.sourceRef).toBeTruthy();
  });

  test('never mutates the input diagram', () => {
    const d = baseDiagram();
    addNode(d, { category: 'concept' });
    expect(d.nodes).toHaveLength(2);
  });
});

describe('updateNode / moveNode', () => {
  test('updateNode patches only the targeted node', () => {
    const next = updateNode(baseDiagram(), 'a', { label: 'Renamed' });
    expect(next.nodes.find(n => n.id === 'a').label).toBe('Renamed');
    expect(next.nodes.find(n => n.id === 'b').label).toBe('B');
  });

  test('moveNode records a position override on the node', () => {
    const next = moveNode(baseDiagram(), 'a', { x: 42, y: 7 });
    expect(next.nodes.find(n => n.id === 'a').position).toEqual({ x: 42, y: 7 });
  });
});

describe('deleteNode — cascades edges, never leaves a dangling reference', () => {
  test('removes the node and every edge touching it', () => {
    const next = deleteNode(baseDiagram(), 'a');
    expect(next.nodes.map(n => n.id)).toEqual(['b']);
    expect(next.edges).toHaveLength(0);
  });

  test('an unrelated edge survives deleting a different node', () => {
    const d = baseDiagram();
    d.nodes.push({ id: 'c', label: 'C', explanation: 'x', category: 'concept', sourceType: 'entry', sourceRef: 'y' });
    d.edges.push({ source: 'b', target: 'c', relationship: 'related_to', label: '' });
    const next = deleteNode(d, 'a');
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]).toMatchObject({ source: 'b', target: 'c' });
  });
});

describe('addEdge', () => {
  test('adds a new connection with a default relationship', () => {
    const d = { ...baseDiagram(), edges: [] };
    const next = addEdge(d, 'a', 'b');
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0].relationship).toBeTruthy();
  });

  test('rejects a self-loop (returns the diagram unchanged)', () => {
    const d = baseDiagram();
    const next = addEdge(d, 'a', 'a');
    expect(next.edges).toHaveLength(1); // unchanged from baseDiagram()'s one edge
  });

  test('rejects an exact duplicate connection', () => {
    const d = baseDiagram(); // already has a->b
    const next = addEdge(d, 'a', 'b');
    expect(next.edges).toHaveLength(1);
  });
});

describe('updateEdge / deleteEdge', () => {
  test('updateEdge patches the edge at that index only', () => {
    const next = updateEdge(baseDiagram(), 0, { relationship: 'causes' });
    expect(next.edges[0].relationship).toBe('causes');
  });

  test('deleteEdge removes only that index, leaving nodes untouched', () => {
    const next = deleteEdge(baseDiagram(), 0);
    expect(next.edges).toHaveLength(0);
    expect(next.nodes).toHaveLength(2); // deleting a CONNECTION never deletes nodes
  });
});
