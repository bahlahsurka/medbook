// Pure layout math — the one part of the Mind Map renderer most prone to
// actual bugs (node positions), and fully unit-testable without a DOM or
// @xyflow/react runtime. See mindMapLayout.js's own header comment for the
// two-sided tree / outline modes.
import { computeMindMapLayout, defaultMindMapSize } from '../components/visualization/mindMapLayout';
import { hasOverlap } from '../components/visualization/overlapRemoval';

function rects(d, pos) {
  return d.nodes.map(node => { const s = defaultMindMapSize(node); const p = pos.get(node.id); return { x: p.x - s.width / 2, y: p.y - s.height / 2, w: s.width, h: s.height }; });
}

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
    expect(pos.get('central')).toMatchObject({ x: 0, y: 0, depth: 0 });
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

  const wordy = (id, category, words) => ({ ...n(id, category), label: Array.from({ length: words }, (_, i) => `term${i}${id}`).join(' ') });
  function sized(branches, subsPer, words) {
    const nodes = [wordy('central', 'central_topic', 6)];
    const edges = [];
    for (let b = 0; b < branches; b++) {
      nodes.push(wordy(`b${b}`, 'branch', 2));
      edges.push({ source: 'central', target: `b${b}`, relationship: 'r', label: '' });
      for (let k = 0; k < subsPer; k++) {
        nodes.push(wordy(`b${b}s${k}`, k === 0 ? 'red_flag' : 'subtopic', words));
        edges.push({ source: `b${b}`, target: `b${b}s${k}`, relationship: 'r', label: '' });
      }
    }
    return diagram(nodes, edges);
  }

  test.each([
    ['small (3 nodes)', sized(1, 1, 3)],
    ['medium (~16 nodes)', sized(3, 4, 4)],
    ['large (36 nodes)', sized(7, 4, 5)],
    ['long medical labels', sized(4, 3, 14)],
  ])('no two node boxes overlap — %s, in every mode', (_name, d) => {
    for (const mode of ['balanced', 'right', 'outline']) {
      expect(hasOverlap(rects(d, computeMindMapLayout(d, undefined, { mode })), 4)).toBe(false);
    }
  });

  test('balanced mode splits branches across both sides; right mode keeps them all on the right', () => {
    const d = sized(4, 2, 3);
    const bal = computeMindMapLayout(d, undefined, { mode: 'balanced' });
    const sides = new Set(['b0', 'b1', 'b2', 'b3'].map(id => Math.sign(bal.get(id).x)));
    expect(sides).toEqual(new Set([1, -1]));
    const right = computeMindMapLayout(d, undefined, { mode: 'right' });
    expect(['b0', 'b1', 'b2', 'b3'].every(id => right.get(id).x > 0)).toBe(true);
  });

  test('deeper levels sit further from the centre (aligned columns)', () => {
    const d = sized(2, 2, 3);
    const pos = computeMindMapLayout(d, undefined, { mode: 'right' });
    expect(pos.get('b0s0').x).toBeGreaterThan(pos.get('b0').x);
    expect(pos.get('b0s0').x - defaultMindMapSize(d.nodes.find(x => x.id === 'b0s0')).width / 2)
      .toBeCloseTo(pos.get('b1s0').x - defaultMindMapSize(d.nodes.find(x => x.id === 'b1s0')).width / 2, 5);
  });

  test('outline mode lists nodes top to bottom with children indented under their parent', () => {
    const d = sized(2, 2, 3);
    const pos = computeMindMapLayout(d, undefined, { mode: 'outline' });
    const leftOf = (id) => pos.get(id).x - defaultMindMapSize(d.nodes.find(x => x.id === id)).width / 2;
    expect(pos.get('b0').y).toBeGreaterThan(pos.get('central').y);
    expect(pos.get('b0s0').y).toBeGreaterThan(pos.get('b0').y);
    expect(pos.get('b1').y).toBeGreaterThan(pos.get('b0s1').y);
    expect(leftOf('b0')).toBeGreaterThan(leftOf('central'));
    expect(leftOf('b0s0')).toBeGreaterThan(leftOf('b0'));
  });

  test('an empty node list returns an empty map rather than throwing', () => {
    const pos = computeMindMapLayout({ centralTopic: '', nodes: [], edges: [] });
    expect(pos.size).toBe(0);
  });
});
