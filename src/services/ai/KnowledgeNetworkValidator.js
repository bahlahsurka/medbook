// services/ai/KnowledgeNetworkValidator.js
//
// Structural validation for Knowledge Network — reuses the shared node/
// edge helpers (visualizationValidationHelpers.js) since the shape is the
// same {nodes, edges} family Mind Map established, but adds the ONE rule
// specific to a network rather than a tree: every node needs at least one
// edge (an isolated node isn't "interconnected"), and there is no
// "exactly one central node" requirement at all. See VisualizationValidator.js's
// own header comment for what structural validation does and doesn't
// guarantee — same disclaimer applies here.
import {
  VisualizationValidationError, stripToJson, nonEmptyString,
  validateCommonNodes, validateCommonEdges,
} from './visualizationValidationHelpers.js';
import { KNOWLEDGE_NETWORK_NODE_CATEGORIES } from './KnowledgeNetworkPromptBuilder.js';

const CATEGORY_SET = new Set(KNOWLEDGE_NETWORK_NODE_CATEGORIES);

export function validateKnowledgeNetwork(rawText, { allowAiContext = false } = {}) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new VisualizationValidationError('The model returned malformed JSON. Nothing was saved.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format. Nothing was saved.');
  }
  if (!nonEmptyString(obj.topic)) throw new VisualizationValidationError('The network is missing its topic.');
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new VisualizationValidationError('The network is missing its nodes or edges.');
  }
  if (obj.nodes.length === 0) throw new VisualizationValidationError('The network has no nodes — nothing usable was generated.');

  const { nodes, idSet } = validateCommonNodes(obj.nodes, {
    categories: CATEGORY_SET, allowAiContext, ErrorCtor: VisualizationValidationError,
  });
  const edges = validateCommonEdges(obj.edges, { idSet, nodes, ErrorCtor: VisualizationValidationError });

  if (nodes.length > 1) {
    const touched = new Set();
    for (const e of edges) { touched.add(e.source); touched.add(e.target); }
    const isolated = nodes.find(n => !touched.has(n.id));
    if (isolated) {
      throw new VisualizationValidationError(`Node "${isolated.id}" has no connections — every node in a network needs at least one relationship.`);
    }
  }

  return { topic: obj.topic.trim(), nodes, edges };
}
