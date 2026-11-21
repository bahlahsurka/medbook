// Structural validation for Comparison Map output — a subject x dimension
// grid, NOT the shared node/edge graph shape. At least two subjects, at
// least one dimension, no duplicate (subject, dimension) cells, and every
// subject/dimension must be touched by at least one cell.
import { validateComparisonMap } from '../services/ai/ComparisonMapValidator';
import { VisualizationValidationError } from '../services/ai/VisualizationValidator';

function validDiagram(overrides = {}) {
  return {
    topic: "Crohn's disease vs. ulcerative colitis",
    subjects: [
      { id: 'crohns', label: "Crohn's disease", sourceType: 'entry', sourceRef: "Crohn's disease can affect any part of the GI tract" },
      { id: 'uc', label: 'Ulcerative colitis', sourceType: 'entry', sourceRef: 'ulcerative colitis is continuous and limited to the colon' },
    ],
    dimensions: [
      { id: 'location', label: 'Location/distribution' },
      { id: 'depth', label: 'Depth of inflammation' },
    ],
    cells: [
      { subjectId: 'crohns', dimensionId: 'location', value: 'Mouth to anus, skip lesions', distinguishing: true, sourceType: 'entry', sourceRef: 'mouth to anus with skip lesions' },
      { subjectId: 'uc', dimensionId: 'location', value: 'Continuous, limited to the colon', distinguishing: true, sourceType: 'entry', sourceRef: 'continuous and limited to the colon' },
      { subjectId: 'crohns', dimensionId: 'depth', value: 'Transmural', distinguishing: true, sourceType: 'entry', sourceRef: 'transmural inflammation' },
      { subjectId: 'uc', dimensionId: 'depth', value: 'Mucosal only', distinguishing: true, sourceType: 'entry', sourceRef: 'limited to the mucosa' },
    ],
    ...overrides,
  };
}
const raw = (d) => JSON.stringify(d);

describe('validateComparisonMap — happy path', () => {
  test('accepts a well-formed grid and normalizes it', () => {
    const out = validateComparisonMap(raw(validDiagram()));
    expect(out.subjects).toHaveLength(2);
    expect(out.dimensions).toHaveLength(2);
    expect(out.cells).toHaveLength(4);
  });

  test('allows a missing (subject, dimension) pair — rendered as "not addressed" rather than invented', () => {
    const d = validDiagram();
    d.cells = d.cells.filter(c => !(c.subjectId === 'uc' && c.dimensionId === 'depth'));
    const out = validateComparisonMap(raw(d));
    expect(out.cells).toHaveLength(3);
  });
});

describe('validateComparisonMap — structural rejections', () => {
  test('rejects malformed JSON', () => {
    expect(() => validateComparisonMap('{not json')).toThrow(VisualizationValidationError);
  });

  test('requires at least two subjects', () => {
    const d = validDiagram();
    d.subjects = [d.subjects[0]];
    d.cells = d.cells.filter(c => c.subjectId === 'crohns');
    expect(() => validateComparisonMap(raw(d))).toThrow(/at least two subjects/i);
  });

  test('requires at least one dimension', () => {
    const d = validDiagram({ dimensions: [], cells: [] });
    expect(() => validateComparisonMap(raw(d))).toThrow(/no dimensions/i);
  });

  test('rejects a duplicate cell for the same subject/dimension pair', () => {
    const d = validDiagram();
    d.cells.push({ ...d.cells[0] });
    expect(() => validateComparisonMap(raw(d))).toThrow(/duplicate cell/i);
  });

  test('rejects a cell referencing a nonexistent subject', () => {
    const d = validDiagram();
    d.cells.push({ subjectId: 'ghost', dimensionId: 'location', value: 'x', distinguishing: false, sourceType: 'entry', sourceRef: 'y' });
    expect(() => validateComparisonMap(raw(d))).toThrow(/nonexistent subject/i);
  });

  test('rejects a subject with no cells comparing it on any dimension', () => {
    const d = validDiagram();
    d.subjects.push({ id: 'pseudomembranous', label: 'Pseudomembranous colitis', sourceType: 'entry', sourceRef: 'x' });
    expect(() => validateComparisonMap(raw(d))).toThrow(/no cells comparing it/i);
  });

  test('rejects an ai_context subject when extra context was not requested', () => {
    const d = validDiagram();
    d.subjects[1].sourceType = 'ai_context';
    expect(() => validateComparisonMap(raw(d), { allowAiContext: false })).toThrow(/additional context was requested/i);
  });

  test('Phase 4: accepts a user_added subject/cell regardless of allowAiContext', () => {
    const d = validDiagram();
    d.subjects[1].sourceType = 'user_added';
    d.cells.forEach(c => { if (c.subjectId === d.subjects[1].id) c.sourceType = 'user_added'; });
    expect(() => validateComparisonMap(raw(d), { allowAiContext: false })).not.toThrow();
  });
});
