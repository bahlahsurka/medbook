// services/ai/MechanismDiagramValidator.js
//
// Structural validation for Mechanism Diagram — reuses the shared node/
// edge helpers, plus the rules specific to a causal chain: at least one
// "cause" node, at least one terminal ("consequence"/"red_flag") node,
// every edge must run forward (no node may be its own ancestor — i.e. no
// cycles, since a causal chain cannot loop back on itself), and no
// orphaned node. See VisualizationValidator.js's own header on what
// structural validation does and doesn't guarantee — same applies here.
import {
  VisualizationValidationError, stripToJson, nonEmptyString,
  validateCommonNodes, validateCommonEdges,
} from './visualizationValidationHelpers.js';
import { MECHANISM_NODE_CATEGORIES } from './MechanismDiagramPromptBuilder.js';

const CATEGORY_SET = new Set(MECHANISM_NODE_CATEGORIES);
const TERMINAL_CATEGORIES = new Set(['consequence', 'red_flag']);

function assertAcyclic(nodes, edges) {
  const adjacency = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) adjacency.get(e.source)?.push(e.target);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(nodes.map(n => [n.id, WHITE]));

  function visit(id) {
    color.set(id, GRAY);
    for (const next of adjacency.get(id) || []) {
      const c = color.get(next);
      if (c === GRAY) {
        throw new VisualizationValidationError(`The mechanism chain contains a cycle involving "${id}" — a causal chain cannot loop back on itself.`);
      }
      if (c === WHITE) visit(next);
    }
    color.set(id, BLACK);
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) visit(n.id);
  }
}

export function validateMechanismDiagram(rawText, { allowAiContext = false } = {}) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new VisualizationValidationError('The model returned malformed JSON. Nothing was saved.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format. Nothing was saved.');
  }
  if (!nonEmptyString(obj.topic)) throw new VisualizationValidationError('The mechanism diagram is missing its topic.');
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new VisualizationValidationError('The mechanism diagram is missing its nodes or edges.');
  }
  if (obj.nodes.length === 0) throw new VisualizationValidationError('The mechanism diagram has no nodes — nothing usable was generated.');

  const { nodes, idSet } = validateCommonNodes(obj.nodes, {
    categories: CATEGORY_SET, allowAiContext, ErrorCtor: VisualizationValidationError,
  });
  const edges = validateCommonEdges(obj.edges, { idSet, nodes, ErrorCtor: VisualizationValidationError });

  if (!nodes.some(n => n.category === 'cause')) {
    throw new VisualizationValidationError('The mechanism diagram has no cause node — every causal chain needs a starting point.');
  }
  if (!nodes.some(n => TERMINAL_CATEGORIES.has(n.category))) {
    throw new VisualizationValidationError('The mechanism diagram has no consequence or red-flag node — every causal chain needs somewhere to end.');
  }

  if (nodes.length > 1) {
    const touched = new Set();
    for (const e of edges) { touched.add(e.source); touched.add(e.target); }
    const orphan = nodes.find(n => !touched.has(n.id));
    if (orphan) throw new VisualizationValidationError(`Node "${orphan.id}" is not connected to the rest of the mechanism chain.`);
  }

  assertAcyclic(nodes, edges);

  return { topic: obj.topic.trim(), nodes, edges };
}
