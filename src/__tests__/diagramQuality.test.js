// Diagram text quality: readable labels, relationship text, repairs and
// warnings — using a real saved Mechanism Diagram (retropharyngeal abscess)
// whose labels came back as snake_case ids.
import { humanizeLabel, humanizeRelationship, isMachineLabel, conceptKey } from '../services/ai/diagramLabels';
import { normalizeGraphDiagram, checkDiagramQuality } from '../services/ai/diagramQuality';
import { buildMechanismDiagramFlowGraph } from '../components/visualization/mechanismDiagramGraph';
import fixture from './fixtures/retropharyngealMechanism.json';

const { notes, diagram } = fixture;
const FAKE_THEME = new Proxy({}, { get: () => '#888' });

describe('humanizeLabel', () => {
  test.each([
    ['penetrating_trauma_to_posterior_pharynx', 'penetrating trauma to the posterior pharynx', 'Penetrating trauma to the posterior pharynx'],
    ['thrombosis_of_internal_jugular_vein', 'thrombosis of the internal jugular vein', 'Thrombosis of the internal jugular vein'],
    ['cranial_nerve_deficits', 'deficits in cranial nerves IX, X, XI, and XII', 'Deficits in cranial nerves IX, X, XI, and XII'],
    ['neck_stiffness', 'neck stiffness', 'Neck stiffness'],
    ['ecg_changes', '', 'ECG changes'],
    ['low_ph', '', 'Low pH'],
    ['cn_ix_palsy', '', 'CN IX palsy'],
  ])('%s -> %s', (label, sourceRef, expected) => {
    expect(humanizeLabel(label, { sourceRef })).toBe(expected);
  });

  test('natural labels are kept as written (only the first letter capitalised)', () => {
    expect(humanizeLabel('IV calcium gluconate')).toBe('IV calcium gluconate');
    expect(humanizeLabel('pH below 7.3')).toBe('pH below 7.3');
    expect(humanizeLabel('neck stiffness')).toBe('Neck stiffness');
    expect(isMachineLabel('Fever')).toBe(false);
    expect(isMachineLabel('neck_stiffness')).toBe(true);
  });

  test('relationship text and concept keys', () => {
    expect(humanizeRelationship('can_extend_into')).toBe('can extend into');
    expect(conceptKey('The Fever!')).toBe(conceptKey('fever'));
  });
});

describe('normalizeGraphDiagram (new generations only)', () => {
  const fixed = normalizeGraphDiagram(diagram, 'mechanism_diagram', { notes });
  const label = (id) => fixed.nodes.find(n => n.id === id).label;
  const rel = (s, t) => fixed.edges.find(e => e.source === s && e.target === t).relationship;

  test('no machine-style labels remain', () => {
    fixed.nodes.forEach(n => expect(n.label).not.toMatch(/_/));
    expect(label('thrombosis_internal_jugular')).toBe('Thrombosis of the internal jugular vein');
  });

  test('restores hedges the notes use ("can extend", "potentially resulting in")', () => {
    expect(rel('infection_retropharyngeal', 'extension_posterior_alar')).toBe('can_lead_to');
    expect(rel('spread_carotid_sheath', 'thrombosis_internal_jugular')).toBe('can_lead_to');
    expect(rel('cause_trauma', 'infection_retropharyngeal')).toBe('causes'); // not hedged in the notes
  });

  test('does not modify the input', () => {
    expect(diagram.nodes[0].label).toBe('penetrating_trauma_to_posterior_pharynx');
  });

  test('merges duplicate concepts and drops repeated links', () => {
    const d = {
      nodes: [
        { id: 'a', label: 'Fever', explanation: 'x', category: 'cause', sourceType: 'entry', sourceRef: 'fever' },
        { id: 'b', label: 'the fever', explanation: 'x', category: 'consequence', sourceType: 'entry', sourceRef: 'fever' },
        { id: 'c', label: 'Sepsis', explanation: 'x', category: 'consequence', sourceType: 'entry', sourceRef: 'sepsis' },
      ],
      edges: [
        { source: 'a', target: 'c', relationship: 'causes', label: '' },
        { source: 'b', target: 'c', relationship: 'causes', label: '' },
      ],
    };
    const out = normalizeGraphDiagram(d, 'mechanism_diagram');
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'c']);
    expect(out.edges).toHaveLength(1);
  });

  test('restores a qualifier the explanation dropped, from the node quote', () => {
    const d = { nodes: [{ id: 'k', label: 'High potassium', explanation: 'Potassium is high.', category: 'cause', sourceType: 'entry', sourceRef: 'K+ above 6.5 mEq/L' }], edges: [] };
    expect(normalizeGraphDiagram(d, 'knowledge_network').nodes[0].explanation).toBe('K+ above 6.5 mEq/L.');
  });

  test('a "cause" with something before it is re-classified as a mechanism', () => {
    const d = {
      nodes: [
        { id: 'r', label: 'Root', explanation: 'x', category: 'cause', sourceType: 'entry', sourceRef: 'root' },
        { id: 'm', label: 'Not a root', explanation: 'x', category: 'cause', sourceType: 'entry', sourceRef: 'not' },
        { id: 'z', label: 'End', explanation: 'x', category: 'consequence', sourceType: 'entry', sourceRef: 'end' },
      ],
      edges: [{ source: 'r', target: 'm', relationship: 'causes', label: '' }, { source: 'm', target: 'z', relationship: 'causes', label: '' }],
    };
    expect(normalizeGraphDiagram(d, 'mechanism_diagram').nodes.find(n => n.id === 'm').category).toBe('mechanism');
  });

  test('comparison map / visual summary pass through untouched', () => {
    const cm = { subjects: [], dimensions: [], cells: [] };
    expect(normalizeGraphDiagram(cm, 'comparison_map')).toBe(cm);
  });
});

describe('checkDiagramQuality', () => {
  test('flags a node whose quote is not in the notes, and an unstated link', () => {
    const d = {
      nodes: [
        { id: 'a', label: 'Retropharyngeal abscess', explanation: 'x', category: 'cause', sourceType: 'entry', sourceRef: 'retropharyngeal abscess' },
        { id: 'b', label: 'Kawasaki disease', explanation: 'x', category: 'consequence', sourceType: 'entry', sourceRef: 'coronary aneurysm in Kawasaki disease' },
      ],
      edges: [{ source: 'a', target: 'b', relationship: 'causes', label: '' }],
    };
    const w = checkDiagramQuality(notes, d, 'mechanism_diagram');
    expect(w.some(x => /Kawasaki disease.*wasn't found/.test(x))).toBe(true);
    expect(w.some(x => /isn't stated together/.test(x))).toBe(true);
  });

  test('the real saved diagram: every quote is from the notes', () => {
    expect(checkDiagramQuality(notes, diagram, 'mechanism_diagram').filter(x => /wasn't found/.test(x))).toEqual([]);
  });

  test('only for graph types', () => {
    expect(checkDiagramQuality(notes, { cells: [] }, 'comparison_map')).toEqual([]);
  });
});

describe('rendering a saved diagram (display-only normalization)', () => {
  const { flowNodes, flowEdges } = buildMechanismDiagramFlowGraph(diagram, FAKE_THEME, { direction: 'DOWN' });
  test('shows readable labels without changing the saved data', () => {
    flowNodes.forEach(n => expect(n.data.label).not.toMatch(/_/));
    expect(diagram.nodes.find(n => n.id === 'fever').label).toBe('fever');
  });

  test('a fan-out is drawn as a bracket: straight drops, each label on its own drop', () => {
    const fan = flowEdges.filter(e => e.source === 'infection_retropharyngeal');
    expect(fan.length).toBe(6);
    fan.forEach(e => {
      expect(e.type).toBe('routed');
      expect(e.data.smooth).toBe(false);
      expect(e.data.points).toHaveLength(4);
    });
    const busY = new Set(fan.map(e => Math.round(e.data.points[1].y)));
    expect(busY.size).toBe(1); // one shared bus
    const labelXs = fan.filter(e => e.data.labelBox).map(e => Math.round(e.data.labelBox.x));
    expect(new Set(labelXs).size).toBe(labelXs.length); // no two labels stacked
  });

  test('continuing chains are grouped apart from end findings (no interleaving)', () => {
    const x = (id) => flowNodes.find(n => n.id === id).position.x;
    const chains = ['extension_posterior_alar', 'extension_superior_mediastinum'].map(x);
    const findings = ['neck_stiffness', 'bulging_pharyngeal_wall', 'fever', 'odynophagia'].map(x);
    expect(Math.max(...chains)).toBeLessThan(Math.min(...findings));
  });
});
