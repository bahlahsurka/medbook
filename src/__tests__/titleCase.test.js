import { toTitleCase } from '../lib/titleCase';

test('capitalizes each major word of a plain lowercase title', () => {
  expect(toTitleCase('digoxin toxicity changes')).toBe('Digoxin Toxicity Changes');
});

test('lowercases minor words (articles/conjunctions/short prepositions) in the middle', () => {
  expect(toTitleCase('effects of digoxin on the heart'))
    .toBe('Effects of Digoxin on the Heart');
});

test('a minor word at the very start or end is still capitalized', () => {
  expect(toTitleCase('a tale of two hearts')).toBe('A Tale of Two Hearts');
  expect(toTitleCase('what to look for')).toBe('What to Look For');
});

test('preserves an already-typed acronym instead of flattening it', () => {
  expect(toTitleCase('digoxin toxicity: ECG changes')).toBe('Digoxin Toxicity: ECG Changes');
  expect(toTitleCase('COPD exacerbation signs')).toBe('COPD Exacerbation Signs');
});

test('preserves meaningful mixed casing (mRNA, McDonald, iPhone-style)', () => {
  expect(toTitleCase('mRNA vaccine mechanism')).toBe('mRNA Vaccine Mechanism');
});

test('a title typed entirely in caps lock is treated as an accident, not all acronyms', () => {
  expect(toTitleCase('DIGOXIN TOXICITY ECG CHANGES')).toBe('Digoxin Toxicity Ecg Changes');
});

test('a mix of one real acronym among normal words is NOT treated as caps-lock', () => {
  expect(toTitleCase('ECG changes in digoxin toxicity')).toBe('ECG Changes in Digoxin Toxicity');
});

test('hyphenated acronym compounds: the acronym half is preserved, the other half title-cased', () => {
  expect(toTitleCase('ST-segment elevation')).toBe('ST-Segment Elevation');
});

test('an apostrophe stays part of its word, not split off', () => {
  expect(toTitleCase("crohn's disease overview")).toBe("Crohn's Disease Overview");
});

test('punctuation (colon, parentheses) is preserved verbatim', () => {
  expect(toTitleCase('shock types: hypovolemic vs cardiogenic (overview)'))
    .toBe('Shock Types: Hypovolemic vs Cardiogenic (Overview)');
});

test('empty/falsy input passes through unchanged', () => {
  expect(toTitleCase('')).toBe('');
  expect(toTitleCase(null)).toBe(null);
  expect(toTitleCase(undefined)).toBe(undefined);
});

test('a single word is still capitalized even though it is also the first/last word', () => {
  expect(toTitleCase('the')).toBe('The');
  expect(toTitleCase('of')).toBe('Of');
});
