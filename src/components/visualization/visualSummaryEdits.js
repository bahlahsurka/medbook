// components/visualization/visualSummaryEdits.js
//
// Pure, framework-agnostic mutation functions for a Visual Summary draft
// ({topic, highlights}) — mirrors graphDiagramEdits.js's role for the
// graph-shaped types, but for Visual Summary's own flat list shape (see
// VisualSummaryValidator.js). VisualSummaryEditor.js owns the draft state
// and calls these as `onDraftChange(deleteHighlight(draft, id))`.
import { USER_ADDED_SOURCE_TYPE, USER_ADDED_SOURCE_REF } from './graphDiagramEdits';

function generateId(existingIds) {
  const taken = new Set(existingIds);
  let i = existingIds.length + 1;
  let id = `highlight_${i}`;
  while (taken.has(id)) { i += 1; id = `highlight_${i}`; }
  return id;
}

export function updateTopic(diagram, value) {
  return { ...diagram, topic: value };
}

export function updateHighlight(diagram, id, patch) {
  return { ...diagram, highlights: diagram.highlights.map(h => (h.id === id ? { ...h, ...patch } : h)) };
}

export function addHighlight(diagram) {
  const id = generateId((diagram.highlights || []).map(h => h.id));
  const highlight = {
    id, headline: 'New highlight', detail: '', importance: 'standard', category: 'key_fact',
    sourceType: USER_ADDED_SOURCE_TYPE, sourceRef: USER_ADDED_SOURCE_REF,
  };
  return { diagram: { ...diagram, highlights: [...(diagram.highlights || []), highlight] }, id };
}

export function deleteHighlight(diagram, id) {
  return { ...diagram, highlights: diagram.highlights.filter(h => h.id !== id) };
}

/** Swaps a highlight with its neighbor one position toward `direction` ('up'|'down') — "sections and their ordering" for a flat list. */
export function moveHighlight(diagram, id, direction) {
  const list = [...diagram.highlights];
  const i = list.findIndex(h => h.id === id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= list.length) return diagram;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...diagram, highlights: list };
}
