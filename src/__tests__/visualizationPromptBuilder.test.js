// Confirms the one privacy/isolation guarantee buildMindMapPrompt makes:
// extra context is in its OWN clearly-delimited block and is simply ABSENT
// from the prompt when not supplied — "additional context must only be
// included when explicitly requested" has to be true by construction here,
// not by trusting the model to notice an empty block.
import { buildMindMapPrompt, GROQ_MINDMAP_SCHEMA, SUPPORTED_VIZ_TYPES } from '../services/ai/VisualizationPromptBuilder';

describe('buildMindMapPrompt', () => {
  test('includes the review text', () => {
    const p = buildMindMapPrompt('DKA presents with hyperglycemia.', '');
    expect(p).toContain('DKA presents with hyperglycemia.');
  });

  test('omits the additional-context block entirely when none is supplied', () => {
    const p = buildMindMapPrompt('some review text', '');
    expect(p).not.toMatch(/ADDITIONAL MEDICAL CONTEXT/);
  });

  test('omits the additional-context block when extraContext is only whitespace', () => {
    const p = buildMindMapPrompt('some review text', '   \n  ');
    expect(p).not.toMatch(/ADDITIONAL MEDICAL CONTEXT/);
  });

  test('includes a clearly separate additional-context block when supplied', () => {
    const p = buildMindMapPrompt('some review text', 'Also consider renal dosing adjustments.');
    expect(p).toMatch(/ADDITIONAL MEDICAL CONTEXT/);
    expect(p).toContain('Also consider renal dosing adjustments.');
    // Both blocks present, context clearly separated from the review itself.
    expect(p.indexOf('BEGIN REVIEW NOTES')).toBeLessThan(p.indexOf('ADDITIONAL MEDICAL CONTEXT'));
  });
});

describe('GROQ_MINDMAP_SCHEMA', () => {
  test('is strict: every object requires all of its own properties', () => {
    expect(GROQ_MINDMAP_SCHEMA.additionalProperties).toBe(false);
    expect(GROQ_MINDMAP_SCHEMA.required.sort()).toEqual(['centralTopic', 'edges', 'nodes'].sort());

    const nodeSchema = GROQ_MINDMAP_SCHEMA.properties.nodes.items;
    expect(nodeSchema.additionalProperties).toBe(false);
    expect(new Set(nodeSchema.required)).toEqual(new Set(Object.keys(nodeSchema.properties)));

    const edgeSchema = GROQ_MINDMAP_SCHEMA.properties.edges.items;
    expect(edgeSchema.additionalProperties).toBe(false);
    expect(new Set(edgeSchema.required)).toEqual(new Set(Object.keys(edgeSchema.properties)));
  });
});

describe('SUPPORTED_VIZ_TYPES', () => {
  test('is Mind Map only for Phase 1', () => {
    expect(SUPPORTED_VIZ_TYPES).toEqual(['mind_map']);
  });
});
