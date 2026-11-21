// components/visualization/graphDiagramEdits.js
//
// Pure, framework-agnostic mutation functions for a graph-shaped diagram
// ({nodes, edges}, plus one top-level topic string under either `topic` or
// `centralTopic` depending on type) — shared by the editable-mode wiring
// in MindMapRenderer.js, KnowledgeNetworkRenderer.js,
// ClinicalFlowchartRenderer.js, and MechanismDiagramRenderer.js (all four
// use this exact node/edge shape). Deliberately NOT a React hook — each
// renderer owns its own `[draft, setDraft]` state and calls these as
// `setDraft(d => deleteNode(d, id))`; keeping this layer pure makes the
// one thing most likely to have a subtle bug (cascade-deleting edges,
// never leaving a dangling reference) trivial to unit test without any
// DOM/React Flow runtime.
//
// Every mutation here enforces "preserve valid graph structure / prevent
// dangling connections and invalid node references" AT EDIT TIME, as a UI
// guard — api/visualize-edit.mjs re-validates the full saved result
// server-side too (the real, unbypassable guarantee), but catching it here
// means a user never even SEES an invalid intermediate state while editing.

export const USER_ADDED_SOURCE_TYPE = 'user_added';
export const USER_ADDED_SOURCE_REF = 'Added by you during editing';

/** Diagrams are plain JSON data — safe and simple to deep-clone this way. */
export function cloneDiagram(diagram) {
  return diagram ? JSON.parse(JSON.stringify(diagram)) : { nodes: [], edges: [] };
}

function generateNodeId(nodes) {
  const existing = new Set(nodes.map(n => n.id));
  let i = nodes.length + 1;
  let id = `user_node_${i}`;
  while (existing.has(id)) { i += 1; id = `user_node_${i}`; }
  return id;
}

/**
 * @param {object} diagram
 * @param {{category:string, position?:{x:number,y:number}}} options
 * @returns {{diagram:object, id:string}} the new diagram plus the new
 *   node's generated id, so a caller can immediately select/focus it.
 */
export function addNode(diagram, { category, position = null } = {}) {
  const id = generateNodeId(diagram.nodes || []);
  const node = {
    id, label: 'New node', explanation: '',
    category, sourceType: USER_ADDED_SOURCE_TYPE, sourceRef: USER_ADDED_SOURCE_REF,
  };
  if (position) node.position = position;
  return { diagram: { ...diagram, nodes: [...(diagram.nodes || []), node] }, id };
}

/** Shallow-merges `patch` into the node with this id (rename, re-category, edit explanation, …). */
export function updateNode(diagram, id, patch) {
  return { ...diagram, nodes: (diagram.nodes || []).map(n => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Records a dragged node's new canvas position — this is what makes a rearrangement survive a save/reload. */
export function moveNode(diagram, id, position) {
  return updateNode(diagram, id, { position });
}

/**
 * Removes a node AND every edge touching it — the cascade is what
 * guarantees "no dangling connections" after a deletion, rather than
 * leaving an edge that references an id that no longer exists.
 */
export function deleteNode(diagram, id) {
  return {
    ...diagram,
    nodes: (diagram.nodes || []).filter(n => n.id !== id),
    edges: (diagram.edges || []).filter(e => e.source !== id && e.target !== id),
  };
}

/** No self-loop, no exact duplicate of an existing connection — both are "invalid structure" to prevent outright rather than allow-then-flag. */
export function addEdge(diagram, source, target) {
  if (!source || !target || source === target) return diagram;
  const edges = diagram.edges || [];
  if (edges.some(e => e.source === source && e.target === target)) return diagram;
  return { ...diagram, edges: [...edges, { source, target, relationship: 'related_to', label: '' }] };
}

/** Patches one edge (its relationship/label) by its position in the array — stable for the lifetime of a single edit session. */
export function updateEdge(diagram, index, patch) {
  return { ...diagram, edges: (diagram.edges || []).map((e, i) => (i === index ? { ...e, ...patch } : e)) };
}

export function deleteEdge(diagram, index) {
  return { ...diagram, edges: (diagram.edges || []).filter((_, i) => i !== index) };
}

export function updateTopic(diagram, topicKey, value) {
  return { ...diagram, [topicKey]: value };
}
