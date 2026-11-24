// services/ai/ClinicalFlowchartValidator.js
//
// Structural validation for Clinical Flowchart — reuses the shared node/
// edge helpers, plus the rules specific to a branching flow: exactly one
// "start" node, at least one terminal ("outcome"/"red_flag"), every
// "decision" node has at least two labeled outgoing branches (a decision
// with one way out isn't a real decision), and no orphaned node. See
// VisualizationValidator.js's own header on what structural validation
// does and doesn't guarantee — same applies here.
import {
  VisualizationValidationError, stripToJson, nonEmptyString,
  validateCommonNodes, validateCommonEdges,
} from './visualizationValidationHelpers.js';
import { CLINICAL_FLOWCHART_NODE_CATEGORIES } from './ClinicalFlowchartPromptBuilder.js';

const CATEGORY_SET = new Set(CLINICAL_FLOWCHART_NODE_CATEGORIES);
const TERMINAL_CATEGORIES = new Set(['outcome', 'red_flag']);

export function validateClinicalFlowchart(rawText, { allowAiContext = false } = {}) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new VisualizationValidationError('The model returned malformed JSON. Nothing was saved.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format. Nothing was saved.');
  }
  if (!nonEmptyString(obj.topic)) throw new VisualizationValidationError('The flowchart is missing its topic.');
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new VisualizationValidationError('The flowchart is missing its nodes or edges.');
  }
  if (obj.nodes.length === 0) throw new VisualizationValidationError('The flowchart has no nodes — nothing usable was generated.');

  const { nodes, idSet } = validateCommonNodes(obj.nodes, {
    categories: CATEGORY_SET, allowAiContext, ErrorCtor: VisualizationValidationError,
  });
  const edges = validateCommonEdges(obj.edges, { idSet, nodes, ErrorCtor: VisualizationValidationError });

  const startNodes = nodes.filter(n => n.category === 'start');
  if (startNodes.length !== 1) {
    throw new VisualizationValidationError(`The flowchart must have exactly one start node (found ${startNodes.length}).`);
  }
  if (!nodes.some(n => TERMINAL_CATEGORIES.has(n.category))) {
    throw new VisualizationValidationError('The flowchart has no outcome or red-flag node — every pathway needs somewhere to end.');
  }

  const outgoingByNode = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) outgoingByNode.get(e.source)?.push(e);

  for (const n of nodes) {
    if (n.category === 'decision') {
      const branches = outgoingByNode.get(n.id) || [];
      const labeled = branches.filter(e => nonEmptyString(e.label));
      if (branches.length < 2) {
        throw new VisualizationValidationError(`Decision node "${n.id}" has only ${branches.length} outgoing branch(es) — a decision needs at least two.`);
      }
      if (labeled.length < 2) {
        throw new VisualizationValidationError(`Decision node "${n.id}" needs at least two branches with a stated condition in their label.`);
      }
    }
  }

  if (nodes.length > 1) {
    const touched = new Set();
    for (const e of edges) { touched.add(e.source); touched.add(e.target); }
    const orphan = nodes.find(n => !touched.has(n.id));
    if (orphan) throw new VisualizationValidationError(`Node "${orphan.id}" is not connected to the rest of the flowchart.`);
  }

  return { topic: obj.topic.trim(), nodes, edges };
}
