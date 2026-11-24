// services/ai/VisualizationValidator.js
//
// Turns Groq's raw text into a trustworthy Mind Map — or throws. Mirrors
// ResponseParser.js's own discipline (never return a partial/garbled
// object, because a caller writes the result straight to the database) but
// is deliberately its own file/class, not an extension of ResponseParser —
// see VisualizationPromptBuilder.js's header comment on why this feature
// stays separate from the existing AI Analysis pipeline.
//
// IMPORTANT — what this file does NOT do: nothing here checks medical
// CORRECTNESS. It is pure structural validation (shape, referential
// integrity, required fields) — the model could still produce a
// structurally perfect diagram built on a medically wrong inference, and
// this validator has no way to catch that. Schema/structural validity is a
// floor, not a correctness guarantee; api/visualize.mjs's response carries
// an explicit disclaimer saying exactly that, rather than letting a
// "passed validation" diagram read as "verified correct".

export class VisualizationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VisualizationValidationError';
    this.kind = 'invalid_diagram';
  }
}

const MINDMAP_NODE_CATEGORIES = new Set(['central_topic', 'branch', 'subtopic', 'red_flag', 'high_yield']);
// 'user_added' (Phase 4) is never something Groq itself produces — the
// schema Groq must satisfy still only offers 'entry'/'ai_context' — but
// this validator is ALSO reused as-is to re-validate a user's edited
// diagram before saving it (see api/visualize-edit.mjs), and a node the
// user typed in directly during editing is neither from the review nor
// from supplied AI context, so it needs its own honest classification
// rather than being forced to masquerade as one of the other two.
const MINDMAP_SOURCE_TYPES = new Set(['entry', 'ai_context', 'user_added']);
// `relationship` is intentionally NOT an enum here (or in the Groq schema
// — see VisualizationPromptBuilder.js's GROQ_MINDMAP_SCHEMA comment for
// the generation-reliability reasoning): it's a free-text display label
// nothing downstream branches on, so this validator only requires it be a
// real, non-empty string, same as `label`.

/**
 * Models sometimes wrap JSON in markdown fences or add a stray sentence
 * even when asked not to — same fallback ResponseParser.js's own
 * stripToJson applies, reimplemented independently here on purpose (no
 * import from ResponseParser.js) so this module has zero dependency on the
 * AI Analysis pipeline.
 */
function stripToJson(raw) {
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

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Parse + structurally validate a Mind Map. Throws VisualizationValidationError
 * on anything unusable. `allowAiContext` is false unless the caller actually
 * supplied extra context for THIS generation — enforced here as defense in
 * depth on top of the prompt's own instruction (never invent context nodes),
 * because a prompt instruction is advisory and this check is not.
 *
 * On success, returns a NORMALIZED diagram: the same nodes/edges the model
 * produced, trimmed, plus one derived field per edge — `provenance` — computed
 * from its two endpoint nodes' own sourceType ('entry' | 'ai_context' | 'mixed').
 * This is what satisfies "unsupported or uncertain relationships can be
 * identified rather than silently presented as established facts": rather
 * than asking the model to self-rate its own confidence (unreliable), any
 * edge touching an ai_context node is deterministically flagged by its
 * already-validated node provenance, which a future UI can use to visually
 * de-emphasize it relative to a relationship grounded entirely in the
 * entry's own text.
 */
export function validateMindMap(rawText, { allowAiContext = false } = {}) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    throw new VisualizationValidationError('The model returned malformed JSON. Nothing was saved.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format. Nothing was saved.');
  }

  if (!nonEmptyString(obj.centralTopic)) {
    throw new VisualizationValidationError('The diagram is missing its central topic.');
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new VisualizationValidationError('The diagram is missing its nodes or edges.');
  }
  if (obj.nodes.length === 0) {
    throw new VisualizationValidationError('The diagram has no nodes — nothing usable was generated.');
  }

  // ---- Nodes: required fields, duplicate IDs, exactly one central topic ----
  const seenIds = new Set();
  let centralCount = 0;
  const nodes = obj.nodes.map((n, i) => {
    if (!n || typeof n !== 'object') {
      throw new VisualizationValidationError(`Node at index ${i} is malformed.`);
    }
    const { id, label, explanation, category, sourceType, sourceRef } = n;
    if (!nonEmptyString(id)) throw new VisualizationValidationError(`Node at index ${i} is missing a valid id.`);
    if (seenIds.has(id)) throw new VisualizationValidationError(`Duplicate node id "${id}" — every node must have a unique id.`);
    seenIds.add(id);

    if (!nonEmptyString(label)) throw new VisualizationValidationError(`Node "${id}" is missing a label.`);
    if (!nonEmptyString(explanation)) throw new VisualizationValidationError(`Node "${id}" is missing an explanation.`);
    if (!MINDMAP_NODE_CATEGORIES.has(category)) {
      throw new VisualizationValidationError(`Node "${id}" has an unrecognized category "${category}".`);
    }
    if (!MINDMAP_SOURCE_TYPES.has(sourceType)) {
      throw new VisualizationValidationError(`Node "${id}" has an unrecognized source classification "${sourceType}".`);
    }
    // "Preserve source references" — a node with no traceable reference at
    // all is exactly the kind of unsupported claim the prompt rules exist
    // to prevent; treat a missing one as a validation failure, not a detail
    // to silently drop.
    if (!nonEmptyString(sourceRef)) {
      throw new VisualizationValidationError(`Node "${id}" is missing its supporting source reference.`);
    }
    if (sourceType === 'ai_context' && !allowAiContext) {
      throw new VisualizationValidationError(
        `Node "${id}" is marked as additional AI context, but no additional context was requested for this generation.`
      );
    }
    if (category === 'central_topic') centralCount++;

    return {
      id: id.trim(),
      label: label.trim(),
      explanation: explanation.trim(),
      category,
      sourceType,
      sourceRef: sourceRef.trim(),
    };
  });

  if (centralCount !== 1) {
    throw new VisualizationValidationError(
      `The diagram must identify exactly one central topic node (found ${centralCount}).`
    );
  }

  // ---- Edges: valid references, no self-loops, recognized relationship ----
  const edges = obj.edges.map((e, i) => {
    if (!e || typeof e !== 'object') {
      throw new VisualizationValidationError(`Edge at index ${i} is malformed.`);
    }
    const { source, target, relationship, label } = e;
    if (!nonEmptyString(source) || !nonEmptyString(target)) {
      throw new VisualizationValidationError(`Edge at index ${i} is missing a source or target id.`);
    }
    if (!seenIds.has(source)) {
      throw new VisualizationValidationError(`Edge at index ${i} references nonexistent source node "${source}".`);
    }
    if (!seenIds.has(target)) {
      throw new VisualizationValidationError(`Edge at index ${i} references nonexistent target node "${target}".`);
    }
    if (source === target) {
      throw new VisualizationValidationError(`Edge at index ${i} connects node "${source}" to itself.`);
    }
    if (!nonEmptyString(relationship)) {
      throw new VisualizationValidationError(`Edge at index ${i} is missing a relationship label.`);
    }
    if (typeof label !== 'string') {
      throw new VisualizationValidationError(`Edge at index ${i} has an invalid label.`);
    }

    const sourceNode = nodes.find(n => n.id === source);
    const targetNode = nodes.find(n => n.id === target);
    const provenance = sourceNode.sourceType === targetNode.sourceType
      ? sourceNode.sourceType
      : 'mixed';

    return { source, target, relationship: relationship.trim(), label: label.trim(), provenance };
  });

  // A diagram with more than one node but nothing connecting them isn't a
  // mind map, it's an unconnected list — reject it the same way an empty
  // node set is rejected, rather than silently accepting a "diagram" that
  // can't actually be laid out as one.
  if (nodes.length > 1 && edges.length === 0) {
    throw new VisualizationValidationError('The diagram has multiple nodes but no relationships connecting them.');
  }

  return {
    centralTopic: obj.centralTopic.trim(),
    nodes,
    edges,
  };
}
