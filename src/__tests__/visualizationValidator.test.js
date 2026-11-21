// Structural validation for Mind Map output — see
// VisualizationValidator.js's own header comment on what this does and
// does NOT guarantee (shape/referential integrity only, never medical
// correctness). Each test below maps directly to one of the architecture
// audit's "programmatic structural validation" requirements.
import { validateMindMap, VisualizationValidationError } from '../services/ai/VisualizationValidator';

function validDiagram(overrides = {}) {
  return {
    centralTopic: 'Diabetic Ketoacidosis',
    nodes: [
      { id: 'central', label: 'DKA', explanation: 'Hyperglycemia, acidosis, ketosis.', category: 'central_topic', sourceType: 'entry', sourceRef: 'DKA presents with hyperglycemia' },
      { id: 'mgmt', label: 'Management', explanation: 'Fluids before insulin.', category: 'branch', sourceType: 'entry', sourceRef: 'Initial management is IV isotonic saline before starting insulin' },
      { id: 'red_flag_edema', label: 'Cerebral edema', explanation: 'Headache + AMS during treatment.', category: 'red_flag', sourceType: 'entry', sourceRef: 'Watch for cerebral edema in pediatric patients' },
    ],
    edges: [
      { source: 'central', target: 'mgmt', relationship: 'treats', label: '' },
      { source: 'mgmt', target: 'red_flag_edema', relationship: 'causes', label: 'if corrected too fast' },
    ],
    ...overrides,
  };
}

function raw(diagram) {
  return JSON.stringify(diagram);
}

describe('validateMindMap — happy path', () => {
  test('accepts a well-formed diagram and normalizes it', () => {
    const out = validateMindMap(raw(validDiagram()));
    expect(out.centralTopic).toBe('Diabetic Ketoacidosis');
    expect(out.nodes).toHaveLength(3);
    expect(out.edges).toHaveLength(2);
  });

  test('strips markdown fences before parsing', () => {
    const fenced = '```json\n' + raw(validDiagram()) + '\n```';
    expect(() => validateMindMap(fenced)).not.toThrow();
  });

  test('computes edge provenance from endpoint node sourceType', () => {
    const out = validateMindMap(raw(validDiagram()));
    expect(out.edges[0].provenance).toBe('entry'); // central(entry) -> mgmt(entry)
  });

  test('a mixed-provenance edge (entry node -> ai_context node) is flagged "mixed"', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'ctx', label: 'Renal dosing note', explanation: 'Adjust for CrCl.', category: 'subtopic', sourceType: 'ai_context', sourceRef: 'standard dosing reference' });
    d.edges.push({ source: 'mgmt', target: 'ctx', relationship: 'related_to', label: '' });
    const out = validateMindMap(raw(d), { allowAiContext: true });
    expect(out.edges.find(e => e.target === 'ctx').provenance).toBe('mixed');
  });
});

describe('validateMindMap — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateMindMap('{not json')).toThrow(VisualizationValidationError);
  });

  test('rejects a non-object top level', () => {
    expect(() => validateMindMap('[1,2,3]')).toThrow(VisualizationValidationError);
  });

  test('rejects an empty diagram (no nodes)', () => {
    const d = validDiagram({ nodes: [], edges: [] });
    expect(() => validateMindMap(raw(d))).toThrow(/no nodes/i);
  });

  test('rejects duplicate node ids', () => {
    const d = validDiagram();
    d.nodes.push({ ...d.nodes[1], id: 'central' }); // reuses the central node's id
    expect(() => validateMindMap(raw(d))).toThrow(/duplicate node id/i);
  });

  test('rejects an edge referencing a nonexistent source node', () => {
    const d = validDiagram();
    d.edges.push({ source: 'does_not_exist', target: 'central', relationship: 'related_to', label: '' });
    expect(() => validateMindMap(raw(d))).toThrow(/nonexistent source node/i);
  });

  test('rejects an edge referencing a nonexistent target node', () => {
    const d = validDiagram();
    d.edges.push({ source: 'central', target: 'does_not_exist', relationship: 'related_to', label: '' });
    expect(() => validateMindMap(raw(d))).toThrow(/nonexistent target node/i);
  });

  test('rejects a self-referencing edge', () => {
    const d = validDiagram();
    d.edges.push({ source: 'central', target: 'central', relationship: 'related_to', label: '' });
    expect(() => validateMindMap(raw(d))).toThrow(/itself/i);
  });

  test('rejects a node missing a required field', () => {
    const d = validDiagram();
    delete d.nodes[0].explanation;
    expect(() => validateMindMap(raw(d))).toThrow(/explanation/i);
  });

  test('rejects a node with an unrecognized category', () => {
    const d = validDiagram();
    d.nodes[1].category = 'made_up_category';
    expect(() => validateMindMap(raw(d))).toThrow(/category/i);
  });

  test('accepts a free-text relationship not in the reference vocabulary (not an enum — see generation-reliability fix)', () => {
    const d = validDiagram();
    d.edges[0].relationship = 'some_arbitrary_but_descriptive_label';
    expect(() => validateMindMap(raw(d))).not.toThrow();
  });

  test('rejects an edge with an empty relationship label', () => {
    const d = validDiagram();
    d.edges[0].relationship = '';
    expect(() => validateMindMap(raw(d))).toThrow(/relationship/i);
  });

  test('rejects a node missing its source reference', () => {
    const d = validDiagram();
    d.nodes[0].sourceRef = '';
    expect(() => validateMindMap(raw(d))).toThrow(/source reference/i);
  });

  test('requires exactly one central_topic node — rejects zero', () => {
    const d = validDiagram();
    d.nodes[0].category = 'branch';
    expect(() => validateMindMap(raw(d))).toThrow(/exactly one central topic/i);
  });

  test('requires exactly one central_topic node — rejects two', () => {
    const d = validDiagram();
    d.nodes[1].category = 'central_topic';
    expect(() => validateMindMap(raw(d))).toThrow(/exactly one central topic/i);
  });

  test('rejects multiple nodes with zero connecting edges', () => {
    const d = validDiagram({ edges: [] });
    expect(() => validateMindMap(raw(d))).toThrow(/no relationships connecting/i);
  });

  test('rejects an ai_context node when extra context was not requested for this generation', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'ctx', label: 'Renal dosing', explanation: 'x', category: 'subtopic', sourceType: 'ai_context', sourceRef: 'external' });
    d.edges.push({ source: 'mgmt', target: 'ctx', relationship: 'related_to', label: '' });
    expect(() => validateMindMap(raw(d), { allowAiContext: false })).toThrow(/additional context was requested/i);
  });

  test('accepts the same ai_context node when extra context WAS requested', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'ctx', label: 'Renal dosing', explanation: 'x', category: 'subtopic', sourceType: 'ai_context', sourceRef: 'external' });
    d.edges.push({ source: 'mgmt', target: 'ctx', relationship: 'related_to', label: '' });
    expect(() => validateMindMap(raw(d), { allowAiContext: true })).not.toThrow();
  });
});
