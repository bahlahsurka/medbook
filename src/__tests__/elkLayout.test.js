// Real elkjs execution (via its bundled, webpack/Jest-safe entry point —
// see elkLayout.js's own header on why NOT the default 'elkjs' import) —
// not mocked, since this is pure deterministic layout math worth
// verifying actually runs and produces sane output under Jest/jsdom too.
import { computeElkLayout } from '../components/visualization/elkLayout';

describe('computeElkLayout', () => {
  test('returns an empty map for no nodes', async () => {
    const positions = await computeElkLayout([], []);
    expect(positions.size).toBe(0);
  });

  test('"layered"/DOWN gives every node a position and a sane width/height', async () => {
    const positions = await computeElkLayout(
      [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Decision point' }, { id: 'c', label: 'End' }],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
      { algorithm: 'layered', direction: 'DOWN' },
    );
    expect(positions.size).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      const p = positions.get(id);
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
    // top-to-bottom flow: a decision chain should move downward in y.
    expect(positions.get('a').y).toBeLessThan(positions.get('c').y);
  });

  test('"force" algorithm lays out a cyclic network without hanging', async () => {
    const positions = await computeElkLayout(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }],
      { algorithm: 'force' },
    );
    expect(positions.size).toBe(3);
  });
});
