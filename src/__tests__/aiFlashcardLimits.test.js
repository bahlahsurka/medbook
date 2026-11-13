// Regression test for: the AI Analyze section's flashcard list was
// hard-capped at 6 cards (LIMITS.flashcards in PromptBuilder.js), silently
// truncating anything beyond that even when the review genuinely supported
// more question/answer pairs. Removed by setting the cap to Infinity —
// Array#slice(0, Infinity) returns the full array, so this stays the one
// code path (toFlashcards) rather than needing a separate uncapped branch.
//
// keyLearningPoints (was 7) and highYield (was 5) got the same fix later,
// for the same reason: a review that genuinely supported more was having
// real extracted material silently discarded. toStringList is the
// equivalent code path for these (string arrays, not {front,back} pairs).
import { LIMITS } from '../services/ai/PromptBuilder';
import { parseAnalysis, normalizeSections } from '../services/ai/ResponseParser';

function fakeCards(n) {
  return Array.from({ length: n }, (_, i) => ({ front: `Q${i}`, back: `A${i}` }));
}

describe('AI flashcards have no hard cap', () => {
  test('LIMITS.flashcards no longer caps at 6', () => {
    expect(LIMITS.flashcards).toBe(Infinity);
  });

  test('parseAnalysis keeps every flashcard a model returns, even well past the old cap of 6', () => {
    const raw = JSON.stringify({
      keyLearningPoints: [], highYield: [], clinicalPearls: [], redFlags: [], relatedTopics: [],
      flashcards: fakeCards(14),
    });
    const sections = parseAnalysis(raw);
    expect(sections.flashcards).toHaveLength(14);
    expect(sections.flashcards[13]).toEqual({ front: 'Q13', back: 'A13' });
  });

  test('normalizeSections (loading a stored entry) also keeps every flashcard', () => {
    const stored = { flashcards: fakeCards(20) };
    const sections = normalizeSections(stored);
    expect(sections.flashcards).toHaveLength(20);
  });
});

describe('AI keyLearningPoints/highYield have no hard cap', () => {
  test('LIMITS.keyLearningPoints and LIMITS.highYield no longer cap at 7/5', () => {
    expect(LIMITS.keyLearningPoints).toBe(Infinity);
    expect(LIMITS.highYield).toBe(Infinity);
  });

  test('parseAnalysis keeps every point/fact a model returns, well past the old caps of 7/5', () => {
    const raw = JSON.stringify({
      keyLearningPoints: Array.from({ length: 12 }, (_, i) => `point ${i}`),
      highYield: Array.from({ length: 9 }, (_, i) => `hy ${i}`),
      clinicalPearls: [], redFlags: [], relatedTopics: [], flashcards: [],
    });
    const sections = parseAnalysis(raw);
    expect(sections.keyLearningPoints).toHaveLength(12);
    expect(sections.highYield).toHaveLength(9);
  });

  test('normalizeSections (loading a stored entry) also keeps every point/fact', () => {
    const stored = {
      keyLearningPoints: Array.from({ length: 15 }, (_, i) => `point ${i}`),
      highYield: Array.from({ length: 11 }, (_, i) => `hy ${i}`),
    };
    const sections = normalizeSections(stored);
    expect(sections.keyLearningPoints).toHaveLength(15);
    expect(sections.highYield).toHaveLength(11);
  });

  test('clinicalPearls/redFlags/relatedTopics keep their own existing caps (this change is keyLearningPoints/highYield/flashcards-only)', () => {
    const raw = JSON.stringify({
      keyLearningPoints: [], highYield: [],
      clinicalPearls: Array.from({ length: 10 }, (_, i) => `pearl ${i}`),
      redFlags: Array.from({ length: 10 }, (_, i) => `flag ${i}`),
      relatedTopics: Array.from({ length: 20 }, (_, i) => `topic ${i}`),
      flashcards: [],
    });
    const sections = parseAnalysis(raw);
    expect(sections.clinicalPearls).toHaveLength(LIMITS.clinicalPearls);
    expect(sections.redFlags).toHaveLength(LIMITS.redFlags);
    expect(sections.relatedTopics).toHaveLength(LIMITS.relatedTopics);
  });
});
