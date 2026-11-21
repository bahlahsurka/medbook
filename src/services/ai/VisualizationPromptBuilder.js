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

// A reference vocabulary of common relationship words — deliberately NOT a
// schema `enum` anymore (see GROQ_MINDMAP_SCHEMA's own comment on why) and
// NOT enforced by VisualizationValidator.js either, and NOT injected into
// the prompt (every word of prompt here costs tokens/latency on every
// request — not worth it for a free-text field nothing downstream branches
// on). Kept exported only as documentation of the kind of label to expect,
// e.g. useful if a future renderer wants to recognize a few common ones for
// styling (an arrowhead variant for "causes" vs "part_of", say) without
// that being required for the diagram to render correctly either way.
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
 *
 * A WORKED EXAMPLE was added here after real-world testing surfaced two
 * compounding problems a purely rule-based prompt (the version below
 * before this fix) didn't solve: (1) hedged/qualified source language —
 * "proposed mechanism", "used with some success", a timing WINDOW rather
 * than a single value — was being flattened into confident, unqualified
 * statements, exactly the failure mode PromptBuilder.js's own
 * GROQ_SYSTEM_INSTRUCTION history already proved gpt-oss-20b needs a
 * concrete example (not just an abstract rule) to avoid; and (2) nodes
 * were sometimes dropped outright to keep the diagram small, discarding
 * real clinical content the review stated. The example below is an
 * unrelated topic, exactly like PromptBuilder.js's own DKA example —
 * NEVER reuse its content, it exists only to show the FORM: hedges kept
 * as hedges, a timing window kept as a window, nothing summarized away.
 */
export const MINDMAP_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Mind Map study diagram for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

ABSOLUTE RULES:
- Build the diagram ONLY from information clearly supported by the review notes provided (and, if explicitly supplied, the additional medical context block below the notes).
- NEVER invent, infer beyond, or add facts not present in the review or supplied context — even if they are medically true and you know them. This is the most important rule.
- Preserve exact medical terminology, drug names, numeric values, units, thresholds, dosages, timing windows, and qualifiers EXACTLY as written. A hedge word ("proposed", "may", "usually", "used with some success", "history of or high risk for") is part of the fact, not filler to drop — removing it turns a possible mechanism into a stated one, or a risk factor into a diagnosis, which is a factual error even if every other word is correct.
- Do not pad the diagram with generic nodes ("Pathophysiology", "Treatment") that restate a category name instead of a specific fact. Every node must say something the review itself actually states.
- COMPLETENESS: never omit a clinically meaningful detail — a dose, a timing window ("starting at X, continuing until Y"), a qualifier, an indication, a mechanism — just to keep the node count low or the diagram visually simple. If a branch has several distinct facts, give it several child nodes, or fold the extra detail into that node's own "explanation" rather than dropping it. The only correct reason for a short diagram is that the review itself genuinely doesn't contain more — never because you stopped early or trimmed for tidiness. Conversely, if the review does not support much, return as few nodes as that genuinely justifies — never pad to reach a target size either.

STRUCTURE:
- Exactly ONE node has category "central_topic": the single topic the whole review is organized around.
- "branch" nodes are the major concepts organized under the central topic (e.g. diagnosis, mechanism, management, complications — but ONLY the ones the review actually discusses, named specifically, not as generic category labels).
- "subtopic" nodes hang off a branch with a more specific, concise fact. A branch with multiple distinct supporting facts (e.g. a timing window AND a mechanism AND an efficacy caveat) gets multiple subtopic nodes, one per fact — never one subtopic node silently merging several facts into a shorter sentence.
- "red_flag" category is for findings indicating urgent diagnosis or management that the review itself supports — never invented. Use this instead of "subtopic" when a node IS a red flag.
- "high_yield" category is for the single highest-yield, most board-testable fact(s) the review supports — the kind of specific, numeric, or named fact that could directly be a board answer. Use this instead of "subtopic" when a node qualifies.
- Every node needs a short, stable, lowercase_snake_case "id" (e.g. "central", "mechanism_insulin_potassium") that you then reference consistently in every edge touching that node. Reusing an id for two different nodes, or an edge pointing at an id that doesn't exist, makes the whole diagram unusable.
- Every node's "explanation" is one concise sentence that preserves the qualifiers/numbers/timing from its source text — concise means tightly worded, NOT stripped of hedges or specifics.
- Every edge needs a "relationship" — a short lowercase label describing how the two nodes relate (e.g. "treats", "causes", "part_of", "contraindicates" — pick whatever word fits best, this is a free label, not a fixed list). "label" may be an empty string when the relationship word alone is clear enough; use it only when a short extra phrase genuinely adds clarity (e.g. "if given before fluids").

SOURCE CLASSIFICATION (every node is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote from the review notes that supports this exact node, keeping any hedge/qualifier word from that quote — not a paraphrase of your own reasoning, a traceable snippet of the actual text.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, you must not produce any "ai_context" node at all — every node must be "entry" in that case. "sourceRef" for an ai_context node is a short note on what grounds it (e.g. "standard dosing reference, not stated in the review").

RED FLAGS AND HIGH-YIELD: actively look for findings that belong in the "red_flag" or "high_yield" categories per the definitions above, and tag them as such rather than leaving them as plain "subtopic" nodes — but only ones the review (or supplied context) genuinely supports. An empty set of either is correct and expected when the review doesn't support one.

WORKED EXAMPLE (an unrelated topic — shows the FORM and the level of hedge/qualifier/timing preservation expected; never reuse this content, every fact in your real answer comes only from the real review below):

Example review notes: "Low-dose aspirin (81mg daily) is sometimes started at 12 weeks' gestation and continued until delivery for primary prevention of preeclampsia in patients at high risk (e.g. prior preeclampsia, chronic hypertension). The proposed mechanism is irreversible COX-1 inhibition in platelets, reducing thromboxane-mediated vasoconstriction and platelet aggregation relative to prostacyclin. Meta-analyses show a modest but inconsistent reduction in preeclampsia incidence; benefit is greatest when started before 16 weeks."

Example correct output:
{
  "centralTopic": "Low-dose aspirin for preeclampsia prevention",
  "nodes": [
    {"id":"central","label":"Low-dose aspirin (81mg) for preeclampsia prevention","explanation":"Used in high-risk pregnancies for primary prevention of preeclampsia.","category":"central_topic","sourceType":"entry","sourceRef":"Low-dose aspirin (81mg daily)... for primary prevention of preeclampsia in patients at high risk"},
    {"id":"timing","label":"Timing window","explanation":"Started at 12 weeks' gestation and continued until delivery.","category":"subtopic","sourceType":"entry","sourceRef":"sometimes started at 12 weeks' gestation and continued until delivery"},
    {"id":"risk_factors","label":"High-risk indications","explanation":"Prior preeclampsia or chronic hypertension are examples of qualifying high risk.","category":"subtopic","sourceType":"entry","sourceRef":"patients at high risk (e.g. prior preeclampsia, chronic hypertension)"},
    {"id":"mechanism","label":"Proposed mechanism","explanation":"Proposed (not confirmed) irreversible COX-1 inhibition in platelets, reducing thromboxane relative to prostacyclin.","category":"branch","sourceType":"entry","sourceRef":"The proposed mechanism is irreversible COX-1 inhibition in platelets"},
    {"id":"efficacy","label":"Modest, inconsistent benefit","explanation":"Meta-analyses show a modest but inconsistent reduction in preeclampsia incidence, not a strong or guaranteed effect.","category":"high_yield","sourceType":"entry","sourceRef":"Meta-analyses show a modest but inconsistent reduction in preeclampsia incidence"},
    {"id":"early_start","label":"Benefit greatest if started early","explanation":"Benefit is greatest when started before 16 weeks — later starts are less effective.","category":"subtopic","sourceType":"entry","sourceRef":"benefit is greatest when started before 16 weeks"}
  ],
  "edges": [
    {"source":"central","target":"timing","relationship":"has_timing","label":""},
    {"source":"central","target":"risk_factors","relationship":"indicated_for","label":""},
    {"source":"central","target":"mechanism","relationship":"mechanism_of","label":""},
    {"source":"central","target":"efficacy","relationship":"has_outcome","label":""},
    {"source":"timing","target":"early_start","relationship":"related_to","label":"earlier start = more benefit"}
  ]
}
Notice: "sometimes"/"proposed"/"modest but inconsistent" all survive into the nodes exactly as hedged; the timing is a WINDOW ("12 weeks until delivery"), not collapsed into one value; the efficacy caveat got its OWN node instead of being dropped to keep the diagram short. Match this standard of preservation and completeness on the real review below, whatever its actual topic is.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

/**
 * Groq structured-output schema for a Mind Map — standard JSON Schema,
 * `strict: true` dialect (every object lists ALL of its own properties in
 * `required` and sets `additionalProperties: false`, exactly like
 * PromptBuilder.js's GROQ_RESPONSE_SCHEMA already does for the same
 * documented reason: Groq rejects the request outright otherwise).
 *
 * `relationship` is `type: 'string'` with NO `enum` — it was constrained
 * to MINDMAP_RELATIONSHIPS originally, which turned out to be a real
 * contributor to "Groq produced output that did not match the required
 * structure" (json_validate_failed): under strict-mode constrained
 * decoding, every enum on every one of potentially a dozen+ edges is
 * another place a close-but-not-exact word choice (the model picking a
 * reasonable synonym Groq didn't generate the constrained grammar for)
 * fails the WHOLE request, not just that one edge. `category` and
 * `sourceType` stay enums — those ARE load-bearing (rendering and the
 * ai_context safety check branch on them), a 5-value and 2-value set is
 * far less surface area than a 13-value one across every edge, and
 * relationship is purely a display label with nothing downstream keyed
 * to its exact value either way, so constraining it bought restyling
 * consistency at the cost of reliability — not a trade worth making.
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
          relationship: { type: 'string' },
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
