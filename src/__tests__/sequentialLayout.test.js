// Pure positioning math for Mechanism Diagram — longest-path-from-root
// layering. No ELK, no React — just graph structure in, {x,y} positions out.
import { computeSequentialLayout } from '../components/visualization/sequentialLayout';

describe('computeSequentialLayout', () => {
  test('places a root cause at column 0', () => {
    const positions = computeSequentialLayout(
      [{ id: 'cause' }, { id: 'effect' }],
      [{ source: 'cause', target: 'effect' }],
    );
    expect(positions.get('cause').x).toBe(0);
    expect(positions.get('effect').x).toBeGreaterThan(positions.get('cause').x);
  });

  test('a longer chain places later stages further right, strictly increasing', () => {
    const positions = computeSequentialLayout(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }],
    );
    expect(positions.get('a').x).toBeLessThan(positions.get('b').x);
    expect(positions.get('b').x).toBeLessThan(positions.get('c').x);
    expect(positions.get('c').x).toBeLessThan(positions.get('d').x);
  });

  test('a node is laid out at the LONGEST path reaching it, not the shortest', () => {
    // a -> c (direct), and a -> b -> c (two hops) — c must sit past b, not
    // tied with a's immediate successor, so the diagram never draws an
    // edge running backward through another node's column.
    const positions = computeSequentialLayout(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ source: 'a', target: 'c' }, { source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
    );
    expect(positions.get('c').x).toBeGreaterThan(positions.get('b').x);
  });

  test('siblings in the same layer get distinct y offsets (never stacked exactly on top of each other)', () => {
    const positions = computeSequentialLayout(
      [{ id: 'cause' }, { id: 'mech1' }, { id: 'mech2' }],
      [{ source: 'cause', target: 'mech1' }, { source: 'cause', target: 'mech2' }],
    );
    expect(positions.get('mech1').y).not.toBe(positions.get('mech2').y);
    expect(positions.get('mech1').x).toBe(positions.get('mech2').x); // same layer
  });

  test('never hangs on a cyclic input — cycle guard breaks the recursion', () => {
    const positions = computeSequentialLayout(
      [{ id: 'a' }, { id: 'b' }],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
    );
    expect(positions.size).toBe(2);
  });

  test('returns an empty map for no nodes', () => {
    expect(computeSequentialLayout([], []).size).toBe(0);
  });
});
