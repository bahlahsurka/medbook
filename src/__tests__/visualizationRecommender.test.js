// Prompt + validator for the optional "Recommend" feature — a stateless
// classification call, never a diagram generation.
import { buildRecommendPrompt, validateRecommendation } from '../services/ai/visualizationRecommender';
import { VisualizationValidationError } from '../services/ai/VisualizationValidator';

describe('buildRecommendPrompt', () => {
  test('embeds the review text between delimiters', () => {
    const prompt = buildRecommendPrompt('Some review notes about DKA.');
    expect(prompt).toContain('Some review notes about DKA.');
    expect(prompt).toContain('BEGIN REVIEW NOTES');
  });
});

describe('validateRecommendation — happy path', () => {
  test('accepts a well-formed recommendation', () => {
    const out = validateRecommendation(JSON.stringify({
      recommended: ['mechanism_diagram', 'clinical_flowchart'],
      rationale: 'The review explains both a causal mechanism and a stepwise workup.',
    }));
    expect(out.recommended).toEqual(['mechanism_diagram', 'clinical_flowchart']);
    expect(out.rationale).toMatch(/causal mechanism/);
  });

  test('caps the recommended list at 3 even if the model over-produced', () => {
    const out = validateRecommendation(JSON.stringify({
      recommended: ['mind_map', 'knowledge_network', 'clinical_flowchart', 'mechanism_diagram'],
      rationale: 'x',
    }));
    expect(out.recommended).toHaveLength(3);
  });

  test('dedupes a repeated type rather than rejecting it', () => {
    const out = validateRecommendation(JSON.stringify({
      recommended: ['mind_map', 'mind_map', 'visual_summary'],
      rationale: 'x',
    }));
    expect(out.recommended).toEqual(['mind_map', 'visual_summary']);
  });
});

describe('validateRecommendation — rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateRecommendation('{not json')).toThrow(VisualizationValidationError);
  });

  test('rejects an empty recommended list', () => {
    expect(() => validateRecommendation(JSON.stringify({ recommended: [], rationale: 'x' }))).toThrow(/recommended nothing/i);
  });

  test('rejects an unrecognized type', () => {
    expect(() => validateRecommendation(JSON.stringify({ recommended: ['timeline'], rationale: 'x' })))
      .toThrow(/unrecognized recommended type/i);
  });

  test('rejects a missing rationale', () => {
    expect(() => validateRecommendation(JSON.stringify({ recommended: ['mind_map'], rationale: '' })))
      .toThrow(/rationale/i);
  });
});
