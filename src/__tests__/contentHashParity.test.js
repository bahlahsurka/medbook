// The browser hash (Web Crypto) must equal the server's node:crypto hash,
// or staleness would be flagged for every saved diagram / Key Points.
import { webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import { contentHashHex } from '../lib/contentHash';
import { computeContentHash } from '../services/ai/contentHash';
import { isKeyPointsStale } from '../lib/keyPoints';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = NodeTextEncoder;
});

test.each([
  ['plain notes', 'Cyproheptadine 12mg for moderate–severe cases.', ''],
  ['with extra context (trimmed)', 'Hyperkalemia > 5.5 mEq/L', '  calcium gluconate 10 mL of 10%  '],
  ['unicode', 'Δ pH < 7.3 · 17α-hydroxyprogesterone · 41.1°C', ''],
  ['empty', '', ''],
])('client and server hashes match — %s', async (_n, notes, extra) => {
  expect(await contentHashHex(notes, extra)).toBe(computeContentHash(notes, extra));
});

test('a same-length edit changes the hash (length comparison would miss it)', async () => {
  const a = 'Give 12mg loading dose.', b = 'Give 21mg loading dose.';
  expect(a.length).toBe(b.length);
  expect(await contentHashHex(a)).not.toBe(await contentHashHex(b));
});

describe('isKeyPointsStale', () => {
  const notes = 'Give 21mg loading dose.';
  test('uses the content hash when the saved Key Points have one', async () => {
    const saved = { sourceNotesLength: notes.length, sourceContentHash: computeContentHash('Give 12mg loading dose.', '') };
    expect(isKeyPointsStale(saved, notes, await contentHashHex(notes))).toBe(true);
    expect(isKeyPointsStale({ ...saved, sourceContentHash: computeContentHash(notes, '') }, notes, await contentHashHex(notes))).toBe(false);
  });
  test('falls back to notes length for legacy Key Points (no stored hash) or while the hash is computing', () => {
    expect(isKeyPointsStale({ sourceNotesLength: 3 }, notes, 'abc')).toBe(true);
    expect(isKeyPointsStale({ sourceNotesLength: notes.length, sourceContentHash: 'x' }, notes, null)).toBe(false);
  });
});
