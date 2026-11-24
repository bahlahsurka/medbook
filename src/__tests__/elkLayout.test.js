// Real elkjs execution (via its bundled, webpack/Jest-safe entry point —
// see elkLayout.js's own header on why NOT the default 'elkjs' import) —
// not mocked, since this is deterministic layout math worth verifying
// actually runs and produces sane output under Jest/jsdom too.
import { computeElkLayout } from '../components/visualization/elkLayout';
import { hasOverlap } from '../components/visualization/overlapRemoval';

const box = (p) => ({ x: p.x, y: p.y, w: p.width, h: p.height });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('computeElkLayout', () => {
  test('returns empty maps for no nodes', async () => {
    const { positions, routes } = await computeElkLayout([], []);
    expect(positions.size).toBe(0);
    expect(routes.size).toBe(0);
  });

  test('"layered"/DOWN keeps the real node sizes and flows top to bottom', async () => {
    const { positions } = await computeElkLayout(
      [{ id: 'a', width: 140, height: 44 }, { id: 'b', width: 200, height: 62 }, { id: 'c', width: 120, height: 40 }],
      [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }],
      { algorithm: 'layered', direction: 'DOWN' },
    );
    expect(positions.size).toBe(3);
    expect(positions.get('b')).toMatchObject({ width: 200, height: 62 });
    expect(positions.get('a').y + 44).toBeLessThan(positions.get('b').y);
    expect(positions.get('b').y + 62).toBeLessThan(positions.get('c').y);
  });

  test('branch labels get their own ELK-placed boxes, clear of every node and of each other', async () => {
    const nodes = [
      { id: 'start', width: 160, height: 44 }, { id: 'dec', width: 210, height: 58 },
      { id: 'yes', width: 170, height: 44 }, { id: 'no', width: 170, height: 44 }, { id: 'maybe', width: 150, height: 44 },
    ];
    const edges = [
      { id: 's', source: 'start', target: 'dec' },
      { id: 'y', source: 'dec', target: 'yes', label: { text: 'Unstable (SBP < 90)', width: 128, height: 20 } },
      { id: 'n', source: 'dec', target: 'no', label: { text: 'Stable', width: 52, height: 20 } },
      { id: 'm', source: 'dec', target: 'maybe', label: { text: 'Borderline — repeat in 15 minutes', width: 150, height: 34 } },
    ];
    const { positions, routes } = await computeElkLayout(nodes, edges, { algorithm: 'layered', direction: 'DOWN' });
    const nodeBoxes = [...positions.values()].map(box);
    const labelBoxes = ['y', 'n', 'm'].map(id => routes.get(id).labelBox);
    labelBoxes.forEach(lb => expect(lb).toBeTruthy());
    for (const lb of labelBoxes.map(box)) for (const nb of nodeBoxes) expect(overlaps(lb, nb)).toBe(false);
    expect(hasOverlap(labelBoxes.map(box))).toBe(false);
  });

  test('every route starts on its source and ends on its target border', async () => {
    const { positions, routes } = await computeElkLayout(
      [{ id: 'a', width: 140, height: 44 }, { id: 'b', width: 140, height: 44 }, { id: 'c', width: 140, height: 44 }],
      [{ id: 'ab', source: 'a', target: 'b' }, { id: 'ac', source: 'a', target: 'c' }],
      { algorithm: 'layered', direction: 'DOWN' },
    );
    for (const [id, [s, t]] of [['ab', ['a', 'b']], ['ac', ['a', 'c']]]) {
      const pts = routes.get(id).points;
      const S = positions.get(s), T = positions.get(t);
      expect(pts[0].y).toBeCloseTo(S.y + S.height, 0);
      expect(pts[pts.length - 1].y).toBeCloseTo(T.y, 0);
    }
  });

  test('"stress" lays out a dense, cyclic network with no overlapping nodes', async () => {
    const nodes = Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, width: 120 + (i % 4) * 30, height: 40 + (i % 3) * 14 }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `h${i}`, source: n.id, target: 'n0' }))
      .concat(nodes.slice(1, 12).map((n, i) => ({ id: `x${i}`, source: n.id, target: nodes[i + 12].id })))
      .concat([{ id: 'cyc', source: 'n0', target: 'n1' }]);
    const { positions } = await computeElkLayout(nodes, edges, { algorithm: 'stress' });
    expect(positions.size).toBe(24);
    expect(hasOverlap([...positions.values()].map(box), 0)).toBe(false);
  });
});
