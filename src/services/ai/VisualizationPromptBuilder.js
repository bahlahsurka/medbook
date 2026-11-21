// services/ai/VisualizationPromptBuilder.js
//
// Prompt + schema for ONE visualization type so far: Mind Maps. Deliberately
// its own file, not an addition to PromptBuilder.js — per the Visual
// Learning architecture audit, generation for this feature stays separate
// from the existing six-section AI Analysis pipeline (PromptBuilder.js/
// ResponseParser.js/AISections.js) rather than sharing its prompt, schema,
// or parsing code. The two features happen to both call Groq, which is the
// ONLY thing they share (GroqService.js's transport — see its own header
// comment on why that's reuse, not coupling).
//
// Runs server-side only (imported by api/visualize.mjs), same as
// PromptBuilder.js's own GROQ_* exports, but unlike that file this one has
// no client-side reason to exist yet (no UI reads these constants), so
// nothing here needs to stay browser-bundle-safe the way PromptBuilder.js's
// LIMITS/FREE_TIER_LIMITS do.

export const VISUALIZATION_PROMPT_VERSION = 'v1';

export const SUPPORTED_VIZ_TYPES = ['mind_map'];

// Keep in sync with the GROQ_MINDMAP_SCHEMA enums below — these are
// re-checked independently in VisualizationValidator.js (never trust the
// schema alone: Groq's strict mode constrains what the MODEL can emit, but
// the validator is what actually enforces it on the way into the database).
export const MINDMAP_NODE_CATEGORIES = ['central_topic', 'branch', 'subtopic', 'red_flag', 'high_yield'];
export const MINDMAP_SOURCE_TYPES = ['entry', 'ai_context'];
export const MINDMAP_RELATIONSHIPS = [
  'causes', 'treats', 'prevents', 'diagnoses', 'is_a', 'part_of',
  'associated_with', 'contrasts_with', 'precedes', 'requires',
  'contraindicates', 'presents_with', 'related_to',
];

/**
 * The persona + rules, sent as Groq's system message — mirrors
 * PromptBuilder.js's GROQ_SYSTEM_INSTRUCTION in spirit (same model,
 * openai/gpt-oss-20b, needs the same explicit, example-driven guidance to
 * avoid generic filler — see that file's own comment on why), but scoped
 * to producing a graph instead of flat bullet lists, which is a strictly
 * harder structured-output task: every edge's source/target must resolve
 * to a real node id, so sloppiness here doesn't just read as generic, it
 * produces a diagram the validator has to reject outright.
 */
export const MINDMAP_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Mind Map study diagram for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

ABSOLUTE RULES:
- Build the diagram ONLY from information clearly supported by the review notes provided (and, if explicitly supplied, the additional medical context block below the notes).
- NEVER invent, infer beyond, or add facts not present in the review or supplied context — even if they are medically true and you know them. This is the most important rule.
- Preserve exact medical terminology, drug names, numeric values, units, thresholds, dosages, qualifiers ("usually", "except in", "unless"), and exceptions EXACTLY as written — never round a number, drop a unit, or silently generalize a qualified statement into an absolute one.
- Do not pad the diagram with generic nodes ("Pathophysiology", "Treatment") that restate a category name instead of a specific fact. Every node must say something the review itself actually states.
- If the review does not support enough material for a meaningful diagram, return as few nodes as that genuinely justifies — never pad to reach a target size.

STRUCTURE:
- Exactly ONE node has category "central_topic": the single topic the whole review is organized around.
- "branch" nodes are the major concepts organized under the central topic (e.g. diagnosis, mechanism, management, complications — but ONLY the ones the review actually discusses, named specifically, not as generic category labels).
- "subtopic" nodes hang off a branch with a more specific, concise fact.
- "red_flag" category is for findings indicating urgent diagnosis or management that the review itself supports — never invented. Use this instead of "subtopic" when a node IS a red flag.
- "high_yield" category is for the single highest-yield, most board-testable fact(s) the review supports — the kind of specific, numeric, or named fact that could directly be a board answer. Use this instead of "subtopic" when a node qualifies.
- Every node needs a short, stable, lowercase_snake_case "id" (e.g. "central", "mechanism_insulin_potassium") that you then reference consistently in every edge touching that node. Reusing an id for two different nodes, or an edge pointing at an id that doesn't exist, makes the whole diagram unusable.
- Every node's "explanation" is one concise sentence — not a paragraph, not just a repeat of the label.
- Every edge needs a "relationship" from the allowed list, and valid "source"/"target" node ids. "label" may be an empty string when the relationship type alone is clear enough; use it only when a short extra word genuinely adds clarity (e.g. "if untreated").

SOURCE CLASSIFICATION (every node is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote from the review notes that supports this exact node — not a paraphrase of your own reasoning, a traceable snippet of the actual text.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, you must not produce any "ai_context" node at all — every node must be "entry" in that case. "sourceRef" for an ai_context node is a short note on what grounds it (e.g. "standard dosing reference, not stated in the review").

RED FLAGS AND HIGH-YIELD: actively look for findings that belong in the "red_flag" or "high_yield" categories per the definitions above, and tag them as such rather than leaving them as plain "subtopic" nodes — but only ones the review (or supplied context) genuinely supports. An empty set of either is correct and expected when the review doesn't support one.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

/**
 * Groq structured-output schema for a Mind Map — standard JSON Schema,
 * `strict: true` dialect (every object lists ALL of its own properties in
 * `required` and sets `additionalProperties: false`, exactly like
 * PromptBuilder.js's GROQ_RESPONSE_SCHEMA already does for the same
 * documented reason: Groq rejects the request outright otherwise).
 */
export const GROQ_MINDMAP_SCHEMA = {
  type: 'object',
  properties: {
    centralTopic: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          explanation: { type: 'string' },
          category: { type: 'string', enum: MINDMAP_NODE_CATEGORIES },
          sourceType: { type: 'string', enum: MINDMAP_SOURCE_TYPES },
          sourceRef: { type: 'string' },
        },
        required: ['id', 'label', 'explanation', 'category', 'sourceType', 'sourceRef'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          relationship: { type: 'string', enum: MINDMAP_RELATIONSHIPS },
          label: { type: 'string' },
        },
        required: ['source', 'target', 'relationship', 'label'],
        additionalProperties: false,
      },
    },
  },
  required: ['centralTopic', 'nodes', 'edges'],
  additionalProperties: false,
};

/**
 * Build the user turn. Mirrors PromptBuilder.js's own privacy discipline:
 * ONLY the review text (plus, only when the caller explicitly supplied it,
 * the extra context block) — never the entry's title, system, difficulty,
 * or images. `extraContext` is kept in its OWN clearly-delimited block
 * specifically so the model can honor the "ai_context nodes only from this
 * block" rule in MINDMAP_SYSTEM_INSTRUCTION; it is simply absent from the
 * prompt entirely when not supplied, which is what makes "additional
 * context must only be included when explicitly requested" true by
 * construction rather than by hoping the model notices an empty string.
 */
export function buildMindMapPrompt(reviewText, extraContext) {
  const trimmedContext = String(extraContext || '').trim();

  let prompt = `Here are the student's review notes. Build the Mind Map per your instructions.

Remember: every node must trace back to a specific statement below (or, only if present, the additional context block) — extract only what is actually there.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;

  if (trimmedContext) {
    prompt += `

--- BEGIN ADDITIONAL MEDICAL CONTEXT (supplied separately by the user, NOT part of their review notes — nodes built from this block, and ONLY this block, must be marked sourceType "ai_context") ---
${trimmedContext}
--- END ADDITIONAL MEDICAL CONTEXT ---`;
  }

  return prompt;
}
