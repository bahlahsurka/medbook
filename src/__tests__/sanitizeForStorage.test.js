// Regression test for a real Supabase/PostgREST save failure: pasting text
// that came from some PDFs (broken ligature/font mapping in their text
// layer) carries a lone, unpaired UTF-16 surrogate, or occasionally a
// literal NUL character — either one makes the insert/update come back
// "unsupported Unicode escape sequence" instead of saving, even though the
// text looked completely normal on screen. sanitizeForStorage is the
// backstop called right before any title/notes payload is sent.
import { sanitizeForStorage } from '../lib/bulletList';

test('strips a literal NUL character', () => {
  expect(sanitizeForStorage('before\u0000after')).toBe('beforeafter');
});

test('strips a lone high surrogate with no low-surrogate partner', () => {
  expect(sanitizeForStorage('before\uD835after')).toBe('beforeafter');
});

test('strips a lone low surrogate with no high-surrogate partner', () => {
  expect(sanitizeForStorage('before\uDC00after')).toBe('beforeafter');
});

test('strips two separate lone surrogates without eating a real neighbouring character', () => {
  // The naive "consume the adjacent character too" approach this replaced
  // would silently miss the SECOND lone surrogate here.
  expect(sanitizeForStorage('a\uDC00b\uDC00c')).toBe('abc');
});

test('leaves a real surrogate PAIR (e.g. an emoji) completely untouched', () => {
  const pizza = '🍕'; // U+1F355, a genuine high+low surrogate pair
  expect(sanitizeForStorage(`before ${pizza} after`)).toBe(`before ${pizza} after`);
});

test('leaves ordinary text, including newlines and tabs, untouched', () => {
  const text = 'Line one\nLine two\tindented';
  expect(sanitizeForStorage(text)).toBe(text);
});

test('passes through empty/falsy input unchanged', () => {
  expect(sanitizeForStorage('')).toBe('');
  expect(sanitizeForStorage(null)).toBe(null);
  expect(sanitizeForStorage(undefined)).toBe(undefined);
});
