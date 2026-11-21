// services/ai/visualizationStorage.js
//
// Phase 4: how BOTH the original AI-generated diagram and the current
// (possibly user-edited) diagram are stored inside entry_visualizations'
// existing `graph_data` jsonb column — no migration, no new column.
//
// Every row written by a fresh Groq generation (api/visualize.mjs) stores
// graph_data as the RAW validated diagram, exactly as every row has since
// Phase 1 ({nodes,edges,...} / {subjects,dimensions,cells} / {highlights}
// depending on type) — completely unchanged, so every already-generated
// visualization keeps loading exactly as before.
//
// The FIRST time a user saves an edit (api/visualize-edit.mjs), that row's
// graph_data is upgraded in place to a small self-describing ENVELOPE:
//   { __medbookViz: 1, original: <diagram>, current: <diagram>, edited: bool, editedAt: string|null }
// `original` is set ONCE, from whatever graph_data held at that moment
// (the untouched Groq output), and is never overwritten by a later save —
// only a fresh Groq generation/regenerate (which stores a brand new RAW
// diagram, collapsing any prior envelope) ever replaces it. `current` is
// whatever should actually be rendered right now. Restoring the original
// (api/visualize-edit.mjs, action 'restore') sets current = original and
// edited = false, but KEEPS the envelope shape — no Groq call either way.
//
// unwrapGraphData() is the one place that understands both shapes
// (envelope vs. legacy/fresh raw diagram) — every reader (api/visualize.mjs's
// cache-hit/claim checks, api/visualize-edit.mjs, visualizationRegistry.js's
// isRealDiagram/extractCoveragePairs callers) goes through it rather than
// re-deriving this logic.
const ENVELOPE_VERSION = 1;

export function isEnvelope(stored) {
  return !!stored && typeof stored === 'object' && !Array.isArray(stored) && stored.__medbookViz === ENVELOPE_VERSION;
}

/**
 * @param {*} stored — the raw `graph_data` column value: the empty-claim
 *   sentinel ({}), a legacy/freshly-generated raw diagram, or a Phase 4
 *   envelope.
 * @returns {{original:*, current:*, edited:boolean, editedAt:?string}}
 *   For a non-envelope value, `original` and `current` are the SAME
 *   reference (the stored value itself is the one-and-only diagram there
 *   is yet) — there is nothing to diverge from until the first edit-save.
 */
export function unwrapGraphData(stored) {
  if (isEnvelope(stored)) {
    return {
      original: stored.original,
      current: stored.current,
      edited: !!stored.edited,
      editedAt: stored.editedAt || null,
    };
  }
  return { original: stored, current: stored, edited: false, editedAt: null };
}

/**
 * Builds the envelope to persist after a successful edit-save.
 * `original` must be the EXISTING original (from unwrapGraphData() on the
 * row's current graph_data) — never the pre-edit `current` — so repeated
 * saves keep pointing back at the one true AI-generated version, however
 * many times the user edits and re-saves.
 */
export function wrapEdited(original, current, editedAt) {
  return { __medbookViz: ENVELOPE_VERSION, original, current, edited: true, editedAt };
}

/** Builds the envelope to persist after 'restore' — current reverts to original, no Groq call. */
export function wrapRestored(original) {
  return { __medbookViz: ENVELOPE_VERSION, original, current: original, edited: false, editedAt: null };
}

/**
 * DB row -> API response shape, shared by api/visualize.mjs and
 * api/visualize-edit.mjs so a save/restore response is a drop-in refresh
 * of whatever the generate endpoint last returned. `graphData` stays the
 * CURRENT diagram (so every existing renderer — all of which just take a
 * `diagram` prop — needs zero changes), with `originalGraphData`/
 * `isEdited`/`editedAt` as the new fields the editing UI reads.
 */
export function toVisualizationResponseShape(row) {
  const { original, current, edited, editedAt } = unwrapGraphData(row.graph_data);
  return {
    id: row.id,
    entryId: row.entry_id,
    vizType: row.viz_type,
    graphData: current,
    originalGraphData: original,
    isEdited: edited,
    editedAt,
    extraContext: row.extra_context,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    sourceContentHash: row.source_content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
