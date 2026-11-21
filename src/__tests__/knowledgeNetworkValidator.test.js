// Structural validation for Knowledge Network output — same shape family
// as Mind Map (visualizationValidator.test.js) but with no "exactly one
// central node" rule and instead "every node needs at least one edge".
import { validateKnowledgeNetwork } from '../services/ai/KnowledgeNetworkValidator';
import { VisualizationValidationError } from '../services/ai/VisualizationValidator';

function validDiagram(overrides = {}) {
  return {
    topic: 'Hyperkalemia management',
    nodes: [
      { id: 'hyperkalemia', label: 'Hyperkalemia', explanation: 'Elevated serum potassium.', category: 'concept', sourceType: 'entry', sourceRef: 'Hyperkalemia is defined as K+ > 5.5' },
      { id: 'calcium_gluconate', label: 'IV calcium gluconate', explanation: 'Stabilizes the cardiac membrane.', category: 'high_yield', sourceType: 'entry', sourceRef: 'Give IV calcium gluconate first to stabilize the membrane' },
      { id: 'arrhythmia', label: 'Cardiac arrhythmia', explanation: 'Can occur with severe hyperkalemia.', category: 'red_flag', sourceType: 'entry', sourceRef: 'Severe hyperkalemia can cause arrhythmia' },
    ],
    edges: [
      { source: 'hyperkalemia', target: 'calcium_gluconate', relationship: 'treated_by', label: '' },
      { source: 'hyperkalemia', target: 'arrhythmia', relationship: 'can_cause', label: '' },
      { source: 'calcium_gluconate', target: 'arrhythmia', relationship: 'prevents', label: 'if given promptly' },
    ],
    ...overrides,
  };
}
const raw = (d) => JSON.stringify(d);

describe('validateKnowledgeNetwork — happy path', () => {
  test('accepts a well-formed network and normalizes it', () => {
    const out = validateKnowledgeNetwork(raw(validDiagram()));
    expect(out.topic).toBe('Hyperkalemia management');
    expect(out.nodes).toHaveLength(3);
    expect(out.edges).toHaveLength(3);
  });

  test('accepts cross-links between two non-"first" nodes (a real network, not a tree)', () => {
    const out = validateKnowledgeNetwork(raw(validDiagram()));
    expect(out.edges.some(e => e.source === 'calcium_gluconate' && e.target === 'arrhythmia')).toBe(true);
  });
});

describe('validateKnowledgeNetwork — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateKnowledgeNetwork('{not json')).toThrow(VisualizationValidationError);
  });

  test('rejects an empty network (no nodes)', () => {
    expect(() => validateKnowledgeNetwork(raw(validDiagram({ nodes: [], edges: [] })))).toThrow(/no nodes/i);
  });

  test('rejects an isolated node with no connections', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'isolated', label: 'Unrelated fact', explanation: 'x', category: 'concept', sourceType: 'entry', sourceRef: 'y' });
    expect(() => validateKnowledgeNetwork(raw(d))).toThrow(/at least one relationship/i);
  });

  test('rejects a node with an unrecognized category', () => {
    const d = validDiagram();
    d.nodes[0].category = 'central_topic'; // a Mind-Map-only category, not valid here
    expect(() => validateKnowledgeNetwork(raw(d))).toThrow(/category/i);
  });

  test('does NOT require exactly one "central" node — a flat set of concepts is valid', () => {
    const d = validDiagram();
    d.nodes = d.nodes.map(n => ({ ...n, category: 'concept' }));
    expect(() => validateKnowledgeNetwork(raw(d))).not.toThrow();
  });

  test('rejects an ai_context node when extra context was not requested', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'ctx', label: 'Dosing reference', explanation: 'x', category: 'concept', sourceType: 'ai_context', sourceRef: 'external' });
    d.edges.push({ source: 'hyperkalemia', target: 'ctx', relationship: 'related_to', label: '' });
    expect(() => validateKnowledgeNetwork(raw(d), { allowAiContext: false })).toThrow(/additional context was requested/i);
  });
});
