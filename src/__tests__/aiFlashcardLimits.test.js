// Regression test for: the AI Analyze section's flashcard list was
// hard-capped at 6 cards (LIMITS.flashcards in PromptBuilder.js), silently
// truncating anything beyond that even when the review genuinely supported
// more question/answer pairs. Removed by setting the cap to Infinity —
// Array#slice(0, Infinity) returns the full array, so this stays the one
// code path (toFlashcards) rather than needing a separate uncapped branch.
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

  test('other sections keep their own existing caps (this change is flashcards-only)', () => {
    const raw = JSON.stringify({
      keyLearningPoints: Array.from({ length: 10 }, (_, i) => `point ${i}`),
      highYield: Array.from({ length: 10 }, (_, i) => `hy ${i}`),
      clinicalPearls: Array.from({ length: 10 }, (_, i) => `pearl ${i}`),
      redFlags: [], relatedTopics: [], flashcards: [],
    });
    const sections = parseAnalysis(raw);
    expect(sections.keyLearningPoints).toHaveLength(LIMITS.keyLearningPoints);
    expect(sections.highYield).toHaveLength(LIMITS.highYield);
    expect(sections.clinicalPearls).toHaveLength(LIMITS.clinicalPearls);
  });
});
