// Regression coverage for the specific content-fidelity complaint that
// motivated this module: a progesterone-for-preterm-labor review whose
// generated diagram dropped the timing window, the hedged mechanism, and
// the efficacy caveat. See this module's own header for what the
// heuristic is and is not (word-overlap, not semantic understanding).
import { findUncoveredStatements, SOURCE_COVERAGE_DISCLAIMER } from '../services/ai/sourceCoverage';

const PROGESTERONE_NOTES =
  'Progesterone has a history of or high risk for preterm labor as its main indication. ' +
  'Starting at 16-20 weeks gestation. Continuing until term. ' +
  'Proposed inhibition of uterine contractility is the mechanism. ' +
  'Used with some success in preventing preterm labor.';

function node(overrides) {
  return { id: 'n', label: 'n', explanation: '', category: 'subtopic', sourceType: 'entry', sourceRef: '', ...overrides };
}

describe('findUncoveredStatements — progesterone regression example', () => {
  test('an INCOMPLETE diagram (risk factor only) flags the timing window and the mechanism as uncovered', () => {
    const diagram = { nodes: [
      node({ id: 'central', category: 'central_topic', explanation: 'Progesterone for preterm labor', sourceRef: 'Progesterone has a history of or high risk for preterm labor' }),
    ] };
    const flagged = findUncoveredStatements(PROGESTERONE_NOTES, diagram);
    expect(flagged.some(s => /16-20 weeks/.test(s))).toBe(true);
    expect(flagged.some(s => /until term/.test(s))).toBe(true);
    expect(flagged.some(s => /inhibition of uterine contractility/.test(s))).toBe(true);
  });

  test('a COMPLETE diagram (timing, mechanism, efficacy, and risk all represented) flags nothing', () => {
    const diagram = { nodes: [
      node({ id: 'central', category: 'central_topic', explanation: 'Progesterone for preterm labor prevention', sourceRef: 'Progesterone has a history of or high risk for preterm labor' }),
      node({ id: 'timing', explanation: 'Starting at 16-20 weeks gestation, continuing until term', sourceRef: 'Starting at 16-20 weeks gestation. Continuing until term.' }),
      node({ id: 'mechanism', category: 'branch', explanation: 'Proposed inhibition of uterine contractility', sourceRef: 'Proposed inhibition of uterine contractility is the mechanism' }),
      node({ id: 'efficacy', category: 'high_yield', explanation: 'Used with some success in preventing preterm labor', sourceRef: 'Used with some success in preventing preterm labor' }),
    ] };
    const flagged = findUncoveredStatements(PROGESTERONE_NOTES, diagram);
    expect(flagged).toEqual([]);
  });

  test('exports a disclaimer that never claims a correctness/completeness guarantee', () => {
    expect(SOURCE_COVERAGE_DISCLAIMER.toLowerCase()).toContain('not a guarantee');
  });
});

describe('findUncoveredStatements — general behavior', () => {
  test('returns an empty array when the diagram has no nodes', () => {
    expect(findUncoveredStatements('some notes with 50mg and until term', { nodes: [] })).toEqual([]);
  });

  test('ignores short fragments and plain prose with no clinical signal', () => {
    const diagram = { nodes: [node({ explanation: 'x', sourceRef: 'x' })] };
    expect(findUncoveredStatements('Ok. Fine. Good.', diagram)).toEqual([]);
  });

  test('caps the flagged list at 8 even for a long, detail-dense review', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Dose is ${i}0mg starting at week ${i}.`);
    const diagram = { nodes: [node({ explanation: 'unrelated', sourceRef: 'unrelated' })] };
    const flagged = findUncoveredStatements(sentences.join(' '), diagram);
    expect(flagged.length).toBeLessThanOrEqual(8);
  });

  test('a longer, more complex multi-fact entry: covered facts are not flagged, a genuinely missing one is', () => {
    const notes =
      'Metformin is first-line for type 2 diabetes, starting at 500mg daily. ' +
      'It should not be used if eGFR is below 30 due to lactic acidosis risk. ' +
      'Common side effects include GI upset, usually improving over a few weeks. ' +
      'A rare but serious contraindication is active liver disease.';
    const diagram = { nodes: [
      node({ id: 'central', category: 'central_topic', explanation: 'Metformin for type 2 diabetes', sourceRef: 'Metformin is first-line for type 2 diabetes' }),
      node({ id: 'dose', explanation: 'Starting dose is 500mg daily', sourceRef: 'starting at 500mg daily' }),
      node({ id: 'contraindication', category: 'red_flag', explanation: 'Avoid if eGFR below 30 — lactic acidosis risk', sourceRef: 'should not be used if eGFR is below 30 due to lactic acidosis risk' }),
      // Deliberately NOT representing the liver-disease contraindication or the GI side effect.
    ] };
    const flagged = findUncoveredStatements(notes, diagram);
    expect(flagged.some(s => /liver disease/.test(s))).toBe(true);
  });
});
