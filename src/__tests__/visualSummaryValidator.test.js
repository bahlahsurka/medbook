// Structural validation for Visual Summary output — a flat, prioritized
// list of highlight cards, NOT the shared node/edge graph shape.
import { validateVisualSummary } from '../services/ai/VisualSummaryValidator';
import { VisualizationValidationError } from '../services/ai/VisualizationValidator';

function validDiagram(overrides = {}) {
  return {
    topic: 'Acute angle-closure glaucoma',
    highlights: [
      { id: 'emergency_flag', headline: 'Ophthalmologic emergency', detail: 'Treatment must not be delayed.', importance: 'critical', category: 'red_flag', sourceType: 'entry', sourceRef: 'treatment must not be delayed' },
      { id: 'iop_threshold', headline: 'IOP often >40-50 mmHg', detail: 'Intraocular pressure is often above 40-50 mmHg.', importance: 'critical', category: 'number', sourceType: 'entry', sourceRef: 'IOP is often above 40-50 mmHg' },
      { id: 'pupil_pearl', headline: 'Fixed, mid-dilated pupil', detail: 'A key distinguishing feature from conjunctivitis.', importance: 'high', category: 'pearl', sourceType: 'entry', sourceRef: 'a non-reactive pupil' },
    ],
    ...overrides,
  };
}
const raw = (d) => JSON.stringify(d);

describe('validateVisualSummary — happy path', () => {
  test('accepts a well-formed summary and normalizes it', () => {
    const out = validateVisualSummary(raw(validDiagram()));
    expect(out.topic).toBe('Acute angle-closure glaucoma');
    expect(out.highlights).toHaveLength(3);
  });

  test('accepts a short summary with just one highlight', () => {
    const d = validDiagram({ highlights: [validDiagram().highlights[0]] });
    expect(() => validateVisualSummary(raw(d))).not.toThrow();
  });
});

describe('validateVisualSummary — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateVisualSummary('{not json')).toThrow(VisualizationValidationError);
  });

  test('rejects an empty summary (no highlights)', () => {
    expect(() => validateVisualSummary(raw(validDiagram({ highlights: [] })))).toThrow(/no highlights/i);
  });

  test('rejects a duplicate highlight id', () => {
    const d = validDiagram();
    d.highlights.push({ ...d.highlights[0] });
    expect(() => validateVisualSummary(raw(d))).toThrow(/duplicate highlight id/i);
  });

  test('rejects an unrecognized importance tier', () => {
    const d = validDiagram();
    d.highlights[0].importance = 'super_critical';
    expect(() => validateVisualSummary(raw(d))).toThrow(/importance/i);
  });

  test('rejects an unrecognized category', () => {
    const d = validDiagram();
    d.highlights[0].category = 'made_up';
    expect(() => validateVisualSummary(raw(d))).toThrow(/category/i);
  });

  test('rejects a highlight missing its headline', () => {
    const d = validDiagram();
    delete d.highlights[0].headline;
    expect(() => validateVisualSummary(raw(d))).toThrow(/headline/i);
  });

  test('rejects an ai_context highlight when extra context was not requested', () => {
    const d = validDiagram();
    d.highlights[0].sourceType = 'ai_context';
    expect(() => validateVisualSummary(raw(d), { allowAiContext: false })).toThrow(/additional context was requested/i);
  });
});
