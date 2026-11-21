// Pure layout math — the one part of the Mind Map renderer most prone to
// actual bugs (node positions), and fully unit-testable without a DOM or
// @xyflow/react runtime. See mindMapLayout.js's own header comment for
// why this is a radial BFS layout rather than ELK.js.
import { computeMindMapLayout } from '../components/visualization/mindMapLayout';

function diagram(nodes, edges) {
  return { centralTopic: 'x', nodes, edges };
}

const n = (id, category = 'subtopic') => ({ id, label: id, explanation: '', category, sourceType: 'entry', sourceRef: 'x' });

describe('computeMindMapLayout', () => {
  test('places the central node at the origin', () => {
    const d = diagram(
      [n('central', 'central_topic'), n('a', 'branch')],
      [{ source: 'central', target: 'a', relationship: 'related_to', label: '' }]
    );
    const pos = computeMindMapLayout(d);
    expect(pos.get('central')).toEqual({ x: 0, y: 0, depth: 0 });
  });

  test('a lone central node (no other nodes) does not throw', () => {
    const d = diagram([n('central', 'central_topic')], []);
    expect(() => computeMindMapLayout(d)).not.toThrow();
    expect(computeMindMapLayout(d).size).toBe(1);
  });

  test('assigns increasing depth away from the central node', () => {
    const d = diagram(
      [n('central', 'central_topic'), n('branch1', 'branch'), n('sub1', 'subtopic')],
      [
        { source: 'central', target: 'branch1', relationship: 'related_to', label: '' },
        { source: 'branch1', target: 'sub1', relationship: 'related_to', label: '' },
      ]
    );
    const pos = computeMindMapLayout(d);
    expect(pos.get('branch1').depth).toBe(1);
    expect(pos.get('sub1').depth).toBe(2);
  });

  test('every non-central node gets a position distinct from the center', () => {
    const d = diagram(
      [n('central', 'central_topic'), n('a', 'branch'), n('b', 'branch'), n('c', 'branch')],
      [
        { source: 'central', target: 'a', relationship: 'related_to', label: '' },
        { source: 'central', target: 'b', relationship: 'related_to', label: '' },
        { source: 'central', target: 'c', relationship: 'related_to', label: '' },
      ]
    );
    const pos = computeMindMapLayout(d);
    for (const id of ['a', 'b', 'c']) {
      const p = pos.get(id);
      expect(p.x === 0 && p.y === 0).toBe(false);
    }
  });

  test('no two nodes at the same depth ring collide (angularly distinct positions)', () => {
    const nodes = [n('central', 'central_topic')];
    const edges = [];
    for (let i = 0; i < 8; i++) {
      nodes.push(n(`b${i}`, 'branch'));
      edges.push({ source: 'central', target: `b${i}`, relationship: 'related_to', label: '' });
    }
    const pos = computeMindMapLayout(diagram(nodes, edges));
    const coords = Array.from({ length: 8 }, (_, i) => pos.get(`b${i}`));
    const seen = new Set();
    for (const c of coords) {
      const key = `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('a node unreachable from the central node (disconnected sub-graph) still gets placed, not dropped', () => {
    const d = diagram(
      [n('central', 'central_topic'), n('a', 'branch'), n('orphan', 'subtopic')],
      [{ source: 'central', target: 'a', relationship: 'related_to', label: '' }]
      // 'orphan' has no edge at all
    );
    const pos = computeMindMapLayout(d);
    expect(pos.has('orphan')).toBe(true);
    expect(pos.get('orphan').depth).toBe(1);
  });

  test('a crowded ring (many siblings) gets a wider radius than a sparse one, avoiding crowding', () => {
    const sparseNodes = [n('central', 'central_topic'), n('only', 'branch')];
    const sparseEdges = [{ source: 'central', target: 'only', relationship: 'related_to', label: '' }];
    const sparsePos = computeMindMapLayout(diagram(sparseNodes, sparseEdges));

    const crowdedNodes = [n('central', 'central_topic')];
    const crowdedEdges = [];
    for (let i = 0; i < 20; i++) {
      crowdedNodes.push(n(`s${i}`, 'branch'));
      crowdedEdges.push({ source: 'central', target: `s${i}`, relationship: 'related_to', label: '' });
    }
    const crowdedPos = computeMindMapLayout(diagram(crowdedNodes, crowdedEdges));

    const sparseRadius = Math.hypot(sparsePos.get('only').x, sparsePos.get('only').y);
    const crowdedRadius = Math.hypot(crowdedPos.get('s0').x, crowdedPos.get('s0').y);
    expect(crowdedRadius).toBeGreaterThan(sparseRadius);
  });

  test('a small diagram (few total nodes) gets a visibly smaller base radius than a large one, at the SAME single-child depth-1 ring (regression: "excessive empty space, widely separated nodes")', () => {
    const small = diagram(
      [n('central', 'central_topic'), n('only', 'branch')],
      [{ source: 'central', target: 'only', relationship: 'related_to', label: '' }]
    );
    const large = diagram(
      [n('central', 'central_topic'), n('only', 'branch'), ...Array.from({ length: 16 }, (_, i) => n(`pad${i}`, 'subtopic'))],
      [
        { source: 'central', target: 'only', relationship: 'related_to', label: '' },
        ...Array.from({ length: 16 }, (_, i) => ({ source: 'only', target: `pad${i}`, relationship: 'related_to', label: '' })),
      ]
    );
    const smallRadius = Math.hypot(...Object.values(computeMindMapLayout(small).get('only')).slice(0, 2));
    const largeRadius = Math.hypot(...Object.values(computeMindMapLayout(large).get('only')).slice(0, 2));
    expect(smallRadius).toBeLessThan(largeRadius);
  });

  test('an empty node list returns an empty map rather than throwing', () => {
    const pos = computeMindMapLayout({ centralTopic: '', nodes: [], edges: [] });
    expect(pos.size).toBe(0);
  });
});
