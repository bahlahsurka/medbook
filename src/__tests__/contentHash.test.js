// Covers the one mechanism entry_visualizations.source_content_hash relies
// on for stale-cache detection (see that migration's own comment and
// api/visualize.mjs) — must be deterministic, must change when either
// input changes, and must not collide two different (notes, extraContext)
// splits onto the same hash.
import { computeContentHash } from '../services/ai/contentHash';

describe('computeContentHash', () => {
  test('is deterministic for the same inputs', () => {
    const a = computeContentHash('DKA presents with hyperglycemia.', '');
    const b = computeContentHash('DKA presents with hyperglycemia.', '');
    expect(a).toBe(b);
  });

  test('is a hex sha256 digest (64 chars)', () => {
    const h = computeContentHash('some notes', '');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changes when the notes change', () => {
    const a = computeContentHash('notes version one', '');
    const b = computeContentHash('notes version two', '');
    expect(a).not.toBe(b);
  });

  test('changes when extra context changes, even with identical notes', () => {
    const a = computeContentHash('same notes', 'context A');
    const b = computeContentHash('same notes', 'context B');
    expect(a).not.toBe(b);
  });

  test('treats null/undefined extraContext the same as empty string', () => {
    const a = computeContentHash('same notes', '');
    const b = computeContentHash('same notes', null);
    const c = computeContentHash('same notes', undefined);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('does not collide ("ab","c") with ("a","bc")', () => {
    const a = computeContentHash('ab', 'c');
    const b = computeContentHash('a', 'bc');
    expect(a).not.toBe(b);
  });

  test('trims extraContext before hashing (whitespace-only context == no context)', () => {
    const a = computeContentHash('same notes', '');
    const b = computeContentHash('same notes', '   ');
    expect(a).toBe(b);
  });
});
