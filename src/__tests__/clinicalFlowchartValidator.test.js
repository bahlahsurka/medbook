// Structural validation for Clinical Flowchart output — exactly one start
// node, at least one terminal node, every decision has >=2 labeled
// branches, no orphans.
import { validateClinicalFlowchart } from '../services/ai/ClinicalFlowchartValidator';
import { VisualizationValidationError } from '../services/ai/VisualizationValidator';

function validDiagram(overrides = {}) {
  return {
    topic: 'Suspected PE workup',
    nodes: [
      { id: 'start', label: 'Suspected PE', explanation: 'Entry point.', category: 'start', sourceType: 'entry', sourceRef: 'For suspected PE' },
      { id: 'stability_check', label: 'Hemodynamically stable?', explanation: 'Check SBP.', category: 'decision', sourceType: 'entry', sourceRef: 'assess hemodynamic stability' },
      { id: 'thrombolysis', label: 'Thrombolysis', explanation: 'If unstable.', category: 'red_flag', sourceType: 'entry', sourceRef: 'proceed to thrombolysis' },
      { id: 'ctpa', label: 'CT pulmonary angiogram', explanation: 'If stable.', category: 'action', sourceType: 'entry', sourceRef: 'obtain a CTPA' },
      { id: 'anticoagulation', label: 'Start anticoagulation', explanation: 'If positive.', category: 'outcome', sourceType: 'entry', sourceRef: 'start anticoagulation' },
    ],
    edges: [
      { source: 'start', target: 'stability_check', relationship: 'then', label: '' },
      { source: 'stability_check', target: 'thrombolysis', relationship: 'branches_to', label: 'Unstable (SBP < 90)' },
      { source: 'stability_check', target: 'ctpa', relationship: 'branches_to', label: 'Stable' },
      { source: 'ctpa', target: 'anticoagulation', relationship: 'then', label: '' },
    ],
    ...overrides,
  };
}
const raw = (d) => JSON.stringify(d);

describe('validateClinicalFlowchart — happy path', () => {
  test('accepts a well-formed flowchart and normalizes it', () => {
    const out = validateClinicalFlowchart(raw(validDiagram()));
    expect(out.topic).toBe('Suspected PE workup');
    expect(out.nodes).toHaveLength(5);
  });
});

describe('validateClinicalFlowchart — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateClinicalFlowchart('{not json')).toThrow(VisualizationValidationError);
  });

  test('requires exactly one start node — rejects zero', () => {
    const d = validDiagram();
    d.nodes[0].category = 'action';
    expect(() => validateClinicalFlowchart(raw(d))).toThrow(/exactly one start node/i);
  });

  test('requires exactly one start node — rejects two', () => {
    const d = validDiagram();
    d.nodes[1].category = 'start';
    expect(() => validateClinicalFlowchart(raw(d))).toThrow(/exactly one start node/i);
  });

  test('requires at least one outcome/red_flag terminal node', () => {
    const d = validDiagram();
    d.nodes.forEach(n => { if (n.category === 'outcome' || n.category === 'red_flag') n.category = 'action'; });
    expect(() => validateClinicalFlowchart(raw(d))).toThrow(/outcome or red-flag node/i);
  });

  test('rejects a decision node with only one outgoing branch', () => {
    const d = validDiagram({
      edges: [
        { source: 'start', target: 'stability_check', relationship: 'then', label: '' },
        { source: 'stability_check', target: 'ctpa', relationship: 'branches_to', label: 'Stable' },
        { source: 'ctpa', target: 'anticoagulation', relationship: 'then', label: '' },
      ],
    });
    // "thrombolysis" node is now orphaned too, but the decision-branch
    // check should fire first since it's checked before the orphan scan.
    expect(() => validateClinicalFlowchart(raw(d))).toThrow(/at least two/i);
  });

  test('rejects a decision node whose branches are not both labeled with a condition', () => {
    const d = validDiagram();
    d.edges[2].label = ''; // the "Stable" branch loses its condition label
    expect(() => validateClinicalFlowchart(raw(d))).toThrow(/stated condition/i);
  });

  test('rejects an orphaned node not connected to the rest of the flowchart', () => {
    const d = validDiagram();
    d.nodes.push({ id: 'orphan', label: 'Unrelated step', explanation: 'x', category: 'action', sourceType: 'entry', sourceRef: 'y' });
    expect(() => validateClinicalFlowchart(raw(d))).toThrow(/not connected/i);
  });
});
