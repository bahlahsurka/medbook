// Phase 5: confirms entries.ai_sections.keyPoints (the new, additive Key
// Points payload, nested inside the SAME jsonb column the old six-section
// analysis already used) coexists safely with the old format — the exact
// thing ReviewQueue.js/SystemReview.js/ReviewKeyPoints.js must keep working
// on, completely unmodified, until Phase 6. normalizeSections() is what
// all three of those actually call; this proves it still extracts the old
// four fields correctly regardless of whether a `keyPoints` key is also
// present, and ignores that key entirely (it only reads the six field
// names it has always read).
import { normalizeSections, isAllEmpty } from '../services/ai';
import { hasKeyPoints } from '../components/ReviewKeyPoints';
import { getSavedKeyPoints } from '../lib/keyPoints';

const OLD_STYLE_SECTIONS = {
  keyLearningPoints: ['Point one', 'Point two'],
  highYield: ['High yield fact'],
  clinicalPearls: ['A pearl'],
  redFlags: ['A red flag'],
  relatedTopics: ['Related topic'],
  flashcards: [{ front: 'Q', back: 'A' }],
};

describe('backward compatibility: old ai_sections rows (no keyPoints key at all)', () => {
  test('normalizeSections extracts every old field correctly, as before Phase 5', () => {
    const out = normalizeSections(OLD_STYLE_SECTIONS);
    expect(out.keyLearningPoints).toEqual(['Point one', 'Point two']);
    expect(out.highYield).toEqual(['High yield fact']);
    expect(out.clinicalPearls).toEqual(['A pearl']);
    expect(out.redFlags).toEqual(['A red flag']);
    expect(out.flashcards).toEqual([{ front: 'Q', back: 'A' }]);
  });

  test('ReviewKeyPoints\' hasKeyPoints() still recognizes a legacy-only row', () => {
    expect(hasKeyPoints(normalizeSections(OLD_STYLE_SECTIONS))).toBe(true);
  });
});

describe('forward compatibility: a row with BOTH the old fields AND the new nested keyPoints key', () => {
  const mixedSections = { ...OLD_STYLE_SECTIONS, keyPoints: { content: { topic: 'x', sections: [] }, generatedAt: 't', model: 'm' } };

  test('normalizeSections still extracts the old fields correctly, ignoring the new key entirely', () => {
    const out = normalizeSections(mixedSections);
    expect(out.keyLearningPoints).toEqual(['Point one', 'Point two']);
    expect(out.flashcards).toEqual([{ front: 'Q', back: 'A' }]);
    // normalizeSections only ever returns the six known fields — the new
    // `keyPoints` key must not leak into (or corrupt) its output shape.
    expect(out.keyPoints).toBeUndefined();
  });

  test('ReviewKeyPoints\' hasKeyPoints() is unaffected by the new key being present', () => {
    expect(hasKeyPoints(normalizeSections(mixedSections))).toBe(true);
  });
});

describe('a brand-new entry that only ever used Key Points (no legacy fields at all)', () => {
  const keyPointsOnlySections = { keyPoints: { content: { topic: 'x', sections: [] }, generatedAt: 't', model: 'm' } };

  test('normalizeSections returns all-empty legacy sections — never throws, never crashes', () => {
    const out = normalizeSections(keyPointsOnlySections);
    expect(isAllEmpty(out)).toBe(true);
  });

  test('the legacy sections alone have nothing to show, but Phase 6 review shows the new Key Points', () => {
    expect(hasKeyPoints(normalizeSections(keyPointsOnlySections))).toBe(false);
    const withBullets = { keyPoints: { content: { topic: 'x', sections: [{ heading: 'H', bullets: [{ text: 'b', emphasis: 'normal' }] }] } } };
    expect(hasKeyPoints(normalizeSections(withBullets), getSavedKeyPoints(withBullets))).toBe(true);
  });
});

describe('completely empty/missing ai_sections (a never-analyzed entry)', () => {
  test('normalizeSections handles null safely', () => {
    expect(() => normalizeSections(null)).not.toThrow();
    expect(isAllEmpty(normalizeSections(null))).toBe(true);
  });
});
