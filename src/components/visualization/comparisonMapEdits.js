// components/visualization/comparisonMapEdits.js
//
// Pure, framework-agnostic mutation functions for a Comparison Map draft
// ({topic, subjects, dimensions, cells}) — mirrors graphDiagramEdits.js's
// role for the graph-shaped types, but for Comparison Map's own grid
// shape (see ComparisonMapValidator.js). ComparisonMapEditor.js owns the
// draft state and calls these as `onDraftChange(deleteSubject(draft, id))`.
import { USER_ADDED_SOURCE_TYPE, USER_ADDED_SOURCE_REF } from './graphDiagramEdits';

function generateId(existingIds, prefix) {
  const taken = new Set(existingIds);
  let i = existingIds.length + 1;
  let id = `${prefix}_${i}`;
  while (taken.has(id)) { i += 1; id = `${prefix}_${i}`; }
  return id;
}

export function updateTopic(diagram, value) {
  return { ...diagram, topic: value };
}

export function updateSubjectLabel(diagram, subjectId, label) {
  return { ...diagram, subjects: diagram.subjects.map(s => (s.id === subjectId ? { ...s, label } : s)) };
}

export function addSubject(diagram) {
  const id = generateId((diagram.subjects || []).map(s => s.id), 'subject');
  const subject = { id, label: 'New subject', sourceType: USER_ADDED_SOURCE_TYPE, sourceRef: USER_ADDED_SOURCE_REF };
  return { diagram: { ...diagram, subjects: [...(diagram.subjects || []), subject] }, id };
}

/** Removing a subject (column) cascades to every cell for it — no dangling references left in the grid. */
export function deleteSubject(diagram, subjectId) {
  return {
    ...diagram,
    subjects: diagram.subjects.filter(s => s.id !== subjectId),
    cells: diagram.cells.filter(c => c.subjectId !== subjectId),
  };
}

export function updateDimensionLabel(diagram, dimensionId, label) {
  return { ...diagram, dimensions: diagram.dimensions.map(d => (d.id === dimensionId ? { ...d, label } : d)) };
}

export function addDimension(diagram) {
  const id = generateId((diagram.dimensions || []).map(d => d.id), 'dimension');
  return { diagram: { ...diagram, dimensions: [...(diagram.dimensions || []), { id, label: 'New dimension' }] }, id };
}

/** Removing a dimension (row) cascades to every cell for it. */
export function deleteDimension(diagram, dimensionId) {
  return {
    ...diagram,
    dimensions: diagram.dimensions.filter(d => d.id !== dimensionId),
    cells: diagram.cells.filter(c => c.dimensionId !== dimensionId),
  };
}

/** Swaps a dimension (row) with its neighbor one position toward `direction` ('up'|'down') — the editing half of "sections and their ordering". */
export function moveDimension(diagram, dimensionId, direction) {
  const dims = [...diagram.dimensions];
  const i = dims.findIndex(d => d.id === dimensionId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= dims.length) return diagram;
  [dims[i], dims[j]] = [dims[j], dims[i]];
  return { ...diagram, dimensions: dims };
}

/** Creates the (subjectId, dimensionId) cell if it doesn't exist yet (sourceType 'user_added'), or merges `patch` into the existing one. */
export function upsertCell(diagram, subjectId, dimensionId, patch) {
  const cells = diagram.cells || [];
  const idx = cells.findIndex(c => c.subjectId === subjectId && c.dimensionId === dimensionId);
  if (idx === -1) {
    const cell = {
      subjectId, dimensionId, value: '', distinguishing: false,
      sourceType: USER_ADDED_SOURCE_TYPE, sourceRef: USER_ADDED_SOURCE_REF,
      ...patch,
    };
    return { ...diagram, cells: [...cells, cell] };
  }
  return { ...diagram, cells: cells.map((c, i) => (i === idx ? { ...c, ...patch } : c)) };
}

export function deleteCell(diagram, subjectId, dimensionId) {
  return { ...diagram, cells: (diagram.cells || []).filter(c => !(c.subjectId === subjectId && c.dimensionId === dimensionId)) };
}
