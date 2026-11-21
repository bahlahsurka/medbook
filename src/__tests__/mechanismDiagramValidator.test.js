// Structural validation for Mechanism Diagram output — at least one
// "cause" node, at least one "consequence"/"red_flag" terminal node, no
// orphans, and the chain must be acyclic (a causal chain cannot loop back
// on itself).
import { validateMechanismDiagram } from '../services/ai/MechanismDiagramValidator';
import { VisualizationValidationError } from '../services/ai/VisualizationValidator';

function validDiagram(overrides = {}) {
  return {
    topic: 'Succinylcholine-induced hyperkalemia',
    nodes: [
      { id: 'cause', label: 'Succinylcholine administration', explanation: 'Given to a susceptible patient.', category: 'cause', sourceType: 'entry', sourceRef: 'Succinylcholine causes transient hyperkalemia' },
      { id: 'depolarization', label: 'Sustained depolarization', explanation: 'Of extrajunctional receptors.', category: 'mechanism', sourceType: 'entry', sourceRef: 'via sustained depolarization' },
      { id: 'hyperkalemia', label: 'Transient hyperkalemia', explanation: 'Rise in serum K+.', category: 'consequence', sourceType: 'entry', sourceRef: 'causes transient hyperkalemia' },
      { id: 'arrhythmia', label: 'Cardiac arrhythmia', explanation: 'Can be precipitated.', category: 'red_flag', sourceType: 'entry', sourceRef: 'can precipitate cardiac arrhythmia' },
    ],
    edges: [
      { source: 'cause', target: 'depolarization', relationship: 'leads_to', label: '' },
      { source: 'depolarization', target: 'hyperkalemia', relationship: 'causes', label: '' },
      { source: 'hyperkalemia', target: 'arrhythmia', relationship: 'can_precipitate', label: '' },
    ],
    ...overrides,
  };
}
const raw = (d) => JSON.stringify(d);

describe('validateMechanismDiagram — happy path', () => {
  test('accepts a well-formed causal chain and normalizes it', () => {
    const out = validateMechanismDiagram(raw(validDiagram()));
    expect(out.topic).toBe('Succinylcholine-induced hyperkalemia');
    expect(out.nodes).toHaveLength(4);
  });

  test('accepts a branching chain (one cause feeding two parallel mechanisms)', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'mech2', label: 'Another mechanism', explanation: 'x', category: 'mechanism', sourceType: 'entry', sourceRef: 'y' });
    d.edges.push({ source: 'cause', target: 'mech2', relationship: 'leads_to', label: '' });
    d.edges.push({ source: 'mech2', target: 'hyperkalemia', relationship: 'contributes_to', label: '' });
    expect(() => validateMechanismDiagram(raw(d))).not.toThrow();
  });
});

describe('validateMechanismDiagram — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateMechanismDiagram('{not json')).toThrow(VisualizationValidationError);
  });

  test('requires at least one cause node', () => {
    const d = validDiagram();
    d.nodes[0].category = 'mechanism';
    expect(() => validateMechanismDiagram(raw(d))).toThrow(/no cause node/i);
  });

  test('requires at least one consequence/red_flag terminal node', () => {
    const d = validDiagram();
    d.nodes.forEach(n => { if (n.category === 'consequence' || n.category === 'red_flag') n.category = 'mechanism'; });
    expect(() => validateMechanismDiagram(raw(d))).toThrow(/no consequence or red-flag node/i);
  });

  test('rejects an orphaned node not connected to the chain', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'orphan', label: 'Unrelated', explanation: 'x', category: 'mechanism', sourceType: 'entry', sourceRef: 'y' });
    expect(() => validateMechanismDiagram(raw(d))).toThrow(/not connected/i);
  });

  test('rejects a cyclic chain (a causal chain cannot loop back on itself)', () => {
    const d = validDiagram();
    d.edges.push({ source: 'arrhythmia', target: 'cause', relationship: 'loops_back', label: '' });
    expect(() => validateMechanismDiagram(raw(d))).toThrow(/cycle/i);
  });
});
