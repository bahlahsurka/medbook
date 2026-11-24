// Structural validation for Key Points — mirrors visualizationValidator.test.js's
// own conventions. See KeyPointsValidator.js's header for what this does
// and doesn't guarantee (shape only, never medical correctness).
import { validateKeyPoints, KeyPointsValidationError } from '../services/ai/KeyPointsValidator';

function validKeyPoints(overrides = {}) {
  return {
    topic: 'Serotonin syndrome',
    sections: [
      {
        heading: 'Clinical triad & timing',
        bullets: [
          { text: 'Triad: autonomic instability, neuromuscular findings, altered mental status', emphasis: 'high_yield', sourceRef: 'the triad of autonomic instability...' },
          { text: 'Usually begins within 24 hours of starting a serotonergic drug', emphasis: 'normal', sourceRef: 'usually within 24 hours of starting' },
        ],
      },
      {
        heading: 'Management',
        bullets: [
          { text: 'Severe hyperthermia (>41.1C) with rigidity is a medical emergency', emphasis: 'red_flag', sourceRef: 'Severe hyperthermia (>41.1C) with rigidity is a medical emergency' },
        ],
      },
    ],
    ...overrides,
  };
}
const raw = (kp) => JSON.stringify(kp);

describe('validateKeyPoints — happy path', () => {
  test('accepts a well-formed Key Points object and normalizes it', () => {
    const out = validateKeyPoints(raw(validKeyPoints()));
    expect(out.topic).toBe('Serotonin syndrome');
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].bullets).toHaveLength(2);
  });

  test('strips markdown fences before parsing', () => {
    const fenced = '```json\n' + raw(validKeyPoints()) + '\n```';
    expect(() => validateKeyPoints(fenced)).not.toThrow();
  });

  test('trims whitespace from topic/heading/text/sourceRef', () => {
    const kp = validKeyPoints();
    kp.topic = '  Serotonin syndrome  ';
    kp.sections[0].heading = '  Clinical triad & timing  ';
    const out = validateKeyPoints(raw(kp));
    expect(out.topic).toBe('Serotonin syndrome');
    expect(out.sections[0].heading).toBe('Clinical triad & timing');
  });

  test('a section with a single bullet is valid — not padded', () => {
    const kp = validKeyPoints({ sections: [{ heading: 'Mechanism', bullets: [{ text: 'x', emphasis: 'normal', sourceRef: 'y' }] }] });
    expect(() => validateKeyPoints(raw(kp))).not.toThrow();
  });
});

describe('validateKeyPoints — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateKeyPoints('{not json')).toThrow(KeyPointsValidationError);
  });

  test('rejects a non-object top level', () => {
    expect(() => validateKeyPoints('[1,2,3]')).toThrow(KeyPointsValidationError);
  });

  test('rejects a missing topic', () => {
    const kp = validKeyPoints();
    delete kp.topic;
    expect(() => validateKeyPoints(raw(kp))).toThrow(/topic/i);
  });

  test('rejects an empty sections array', () => {
    expect(() => validateKeyPoints(raw(validKeyPoints({ sections: [] })))).toThrow(/no sections/i);
  });

  test('rejects a section missing its heading', () => {
    const kp = validKeyPoints();
    delete kp.sections[0].heading;
    expect(() => validateKeyPoints(raw(kp))).toThrow(/heading/i);
  });

  test('rejects a section with no bullets', () => {
    const kp = validKeyPoints();
    kp.sections[0].bullets = [];
    expect(() => validateKeyPoints(raw(kp))).toThrow(/no bullets/i);
  });

  test('rejects a bullet missing its text', () => {
    const kp = validKeyPoints();
    delete kp.sections[0].bullets[0].text;
    expect(() => validateKeyPoints(raw(kp))).toThrow(/text/i);
  });

  test('rejects a bullet with an unrecognized emphasis', () => {
    const kp = validKeyPoints();
    kp.sections[0].bullets[0].emphasis = 'super_important';
    expect(() => validateKeyPoints(raw(kp))).toThrow(/emphasis/i);
  });

  test('rejects a bullet missing its source reference', () => {
    const kp = validKeyPoints();
    kp.sections[0].bullets[0].sourceRef = '';
    expect(() => validateKeyPoints(raw(kp))).toThrow(/source reference/i);
  });
});
