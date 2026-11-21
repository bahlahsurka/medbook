// services/ai/visualizationValidationHelpers.js
//
// Tiny string/graph-shape helpers shared across the Phase 3 visualization
// validators (Knowledge Network, Clinical Flowchart, Mechanism Diagram,
// Comparison Map, Visual Summary). Mind Map's own VisualizationValidator.js
// predates this file and keeps its own private copies unchanged — not
// worth touching working, tested code just to de-duplicate ~10 lines, per
// this phase's "avoid unrelated refactoring" brief. Every NEW validator
// uses these instead of re-copying them a fifth time.
//
// `VisualizationValidationError` itself is NOT redefined here — every
// validator (old and new) must throw the SAME class, since
// api/visualize.mjs's `instanceof VisualizationValidationError` check is
// what routes a validation failure to the right HTTP status. It's
// re-exported from VisualizationValidator.js (Mind Map's file, where it
// was first defined) rather than moved, again to touch nothing there.
export { VisualizationValidationError } from './VisualizationValidator.js';

export function stripToJson(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
  }
  return s.trim();
}

export function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validates and normalizes the common {id, label, explanation, category,
 * sourceType, sourceRef} node shape every graph-based Phase 3 type uses
 * (Knowledge Network, Clinical Flowchart, Mechanism Diagram all share this
 * exact node shape — only the category enum differs per type, and
 * Clinical Flowchart's edges additionally carry `condition`). Throws
 * VisualizationValidationErrorCtor (passed in, not imported here, so this
 * stays a pure function with no error-class coupling of its own) on any
 * missing/invalid field, an unrecognized category, or a disallowed
 * ai_context node. Returns {nodes, idSet} — the normalized nodes plus the
 * id set edges are checked against next.
 */
export function validateCommonNodes(rawNodes, { categories, allowAiContext, ErrorCtor }) {
  const seenIds = new Set();
  const nodes = rawNodes.map((n, i) => {
    if (!n || typeof n !== 'object') throw new ErrorCtor(`Node at index ${i} is malformed.`);
    const { id, label, explanation, category, sourceType, sourceRef } = n;
    if (!nonEmptyString(id)) throw new ErrorCtor(`Node at index ${i} is missing a valid id.`);
    if (seenIds.has(id)) throw new ErrorCtor(`Duplicate node id "${id}" — every node must have a unique id.`);
    seenIds.add(id);
    if (!nonEmptyString(label)) throw new ErrorCtor(`Node "${id}" is missing a label.`);
    if (!nonEmptyString(explanation)) throw new ErrorCtor(`Node "${id}" is missing an explanation.`);
    if (!categories.has(category)) throw new ErrorCtor(`Node "${id}" has an unrecognized category "${category}".`);
    if (sourceType !== 'entry' && sourceType !== 'ai_context') {
      throw new ErrorCtor(`Node "${id}" has an unrecognized source classification "${sourceType}".`);
    }
    if (!nonEmptyString(sourceRef)) throw new ErrorCtor(`Node "${id}" is missing its supporting source reference.`);
    if (sourceType === 'ai_context' && !allowAiContext) {
      throw new ErrorCtor(`Node "${id}" is marked as additional AI context, but no additional context was requested for this generation.`);
    }
    return { id: id.trim(), label: label.trim(), explanation: explanation.trim(), category, sourceType, sourceRef: sourceRef.trim() };
  });
  return { nodes, idSet: seenIds };
}

/**
 * Validates the common {source, target, relationship, label} edge shape
 * (Clinical Flowchart's own validator additionally checks `condition` on
 * decision edges past this). `relationship` is a free-text label, not an
 * enum — see VisualizationPromptBuilder.js's own comment on why Mind Map
 * already made this call for Groq strict-mode reliability; every Phase 3
 * type follows the same lesson from the start instead of re-learning it.
 * Computes `provenance` per edge from its two endpoint nodes' sourceType,
 * exactly like Mind Map's validator does.
 */
export function validateCommonEdges(rawEdges, { idSet, nodes, allowSelfLoop = false, ErrorCtor }) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return rawEdges.map((e, i) => {
    if (!e || typeof e !== 'object') throw new ErrorCtor(`Edge at index ${i} is malformed.`);
    const { source, target, relationship, label } = e;
    if (!nonEmptyString(source) || !nonEmptyString(target)) {
      throw new ErrorCtor(`Edge at index ${i} is missing a source or target id.`);
    }
    if (!idSet.has(source)) throw new ErrorCtor(`Edge at index ${i} references nonexistent source node "${source}".`);
    if (!idSet.has(target)) throw new ErrorCtor(`Edge at index ${i} references nonexistent target node "${target}".`);
    if (!allowSelfLoop && source === target) throw new ErrorCtor(`Edge at index ${i} connects node "${source}" to itself.`);
    if (!nonEmptyString(relationship)) throw new ErrorCtor(`Edge at index ${i} is missing a relationship label.`);
    if (typeof label !== 'string') throw new ErrorCtor(`Edge at index ${i} has an invalid label.`);

    const sourceNode = byId.get(source);
    const targetNode = byId.get(target);
    const provenance = sourceNode.sourceType === targetNode.sourceType ? sourceNode.sourceType : 'mixed';
    return { source, target, relationship: relationship.trim(), label: label.trim(), provenance };
  });
}
