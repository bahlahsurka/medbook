import {
  updateSubjectLabel, addSubject, deleteSubject,
  updateDimensionLabel, addDimension, deleteDimension, moveDimension,
  upsertCell, deleteCell,
} from '../components/visualization/comparisonMapEdits';

function baseDiagram() {
  return {
    topic: 'Test',
    subjects: [
      { id: 's1', label: 'Subject 1', sourceType: 'entry', sourceRef: 'x' },
      { id: 's2', label: 'Subject 2', sourceType: 'entry', sourceRef: 'x' },
    ],
    dimensions: [
      { id: 'd1', label: 'Dimension 1' },
      { id: 'd2', label: 'Dimension 2' },
    ],
    cells: [
      { subjectId: 's1', dimensionId: 'd1', value: 'A', distinguishing: false, sourceType: 'entry', sourceRef: 'x' },
      { subjectId: 's2', dimensionId: 'd1', value: 'B', distinguishing: true, sourceType: 'entry', sourceRef: 'x' },
    ],
  };
}

describe('subjects', () => {
  test('addSubject appends a new subject with a unique id', () => {
    const { diagram: next, id } = addSubject(baseDiagram());
    expect(next.subjects).toHaveLength(3);
    expect(next.subjects.find(s => s.id === id)).toBeTruthy();
  });

  test('deleteSubject cascades — every cell for it is removed too', () => {
    const next = deleteSubject(baseDiagram(), 's1');
    expect(next.subjects.map(s => s.id)).toEqual(['s2']);
    expect(next.cells).toHaveLength(1);
    expect(next.cells[0].subjectId).toBe('s2');
  });

  test('updateSubjectLabel patches only the targeted subject', () => {
    const next = updateSubjectLabel(baseDiagram(), 's1', 'Renamed');
    expect(next.subjects.find(s => s.id === 's1').label).toBe('Renamed');
  });
});

describe('dimensions', () => {
  test('addDimension appends a new dimension with a unique id', () => {
    const { diagram: next, id } = addDimension(baseDiagram());
    expect(next.dimensions).toHaveLength(3);
    expect(next.dimensions.find(d => d.id === id)).toBeTruthy();
  });

  test('deleteDimension cascades — every cell for it is removed too', () => {
    const next = deleteDimension(baseDiagram(), 'd1');
    expect(next.dimensions.map(d => d.id)).toEqual(['d2']);
    expect(next.cells).toHaveLength(0); // both cells in baseDiagram() are d1
  });

  test('moveDimension swaps order with its up/down neighbor', () => {
    const up = moveDimension(baseDiagram(), 'd2', 'up');
    expect(up.dimensions.map(d => d.id)).toEqual(['d2', 'd1']);
  });

  test('moveDimension is a no-op past either edge', () => {
    const d = baseDiagram();
    expect(moveDimension(d, 'd1', 'up').dimensions.map(x => x.id)).toEqual(['d1', 'd2']);
    expect(moveDimension(d, 'd2', 'down').dimensions.map(x => x.id)).toEqual(['d1', 'd2']);
  });
});

describe('cells', () => {
  test('upsertCell creates a new cell for a previously-unaddressed pair', () => {
    const next = upsertCell(baseDiagram(), 's1', 'd2', { value: 'New detail' });
    const cell = next.cells.find(c => c.subjectId === 's1' && c.dimensionId === 'd2');
    expect(cell.value).toBe('New detail');
    expect(cell.sourceType).toBe('user_added');
  });

  test('upsertCell merges into an EXISTING cell rather than duplicating it', () => {
    const next = upsertCell(baseDiagram(), 's1', 'd1', { distinguishing: true });
    const matches = next.cells.filter(c => c.subjectId === 's1' && c.dimensionId === 'd1');
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe('A'); // untouched field survives the merge
    expect(matches[0].distinguishing).toBe(true);
  });

  test('deleteCell removes exactly that pair', () => {
    const next = deleteCell(baseDiagram(), 's1', 'd1');
    expect(next.cells).toHaveLength(1);
    expect(next.cells[0].subjectId).toBe('s2');
  });
});
