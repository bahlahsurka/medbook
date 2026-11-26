// services/ai/KnowledgeNetworkPromptBuilder.js
//
// Prompt + schema for the Knowledge Network visualization type. Separate
// file from VisualizationPromptBuilder.js (Mind Map) per the Phase 3
// brief: "Do not create one enormous universal schema for all
// visualization types" — each type gets its own dedicated prompt/schema,
// even though the underlying node/edge SHAPE is similar to Mind Map's.
// The real difference from Mind Map isn't the data shape, it's the
// STRUCTURE it's asked to produce: no single central topic, no tree —
// a genuinely interconnected web of concepts, which is also why this is
// one of the two types that gets ELK.js layout instead of Mind Map's
// radial-from-center math (see elkLayout.js).
export const KNOWLEDGE_NETWORK_NODE_CATEGORIES = ['concept', 'red_flag', 'high_yield'];

export const GROQ_KNOWLEDGE_NETWORK_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          explanation: { type: 'string' },
          category: { type: 'string', enum: KNOWLEDGE_NETWORK_NODE_CATEGORIES },
          sourceType: { type: 'string', enum: ['entry', 'ai_context'] },
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
          // Free-text, not an enum — same Groq strict-mode reliability
          // lesson Mind Map's own GROQ_MINDMAP_SCHEMA already documents.
          relationship: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['source', 'target', 'relationship', 'label'],
        additionalProperties: false,
      },
    },
  },
  required: ['topic', 'nodes', 'edges'],
  additionalProperties: false,
};

export const KNOWLEDGE_NETWORK_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Knowledge Network diagram for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

A Knowledge Network is NOT a tree with one center — it is a WEB of concepts the review discusses, connected by however many real relationships exist between them, including concepts that relate to EACH OTHER directly, not just to one "main" topic. If every node only ever connects back to one hub, you have built a Mind Map, not a Knowledge Network — actively look for and include direct links BETWEEN non-central concepts whenever the review supports one (e.g. a lab finding connecting directly to a specific management step, not only both connecting back to the diagnosis).

ABSOLUTE RULES:
- Build the network ONLY from information clearly supported by the review notes (and, if explicitly supplied, the additional medical context block below the notes).
- NEVER invent, infer beyond, or add facts not present in the review or supplied context — even if they are medically true and you know them. This is the most important rule.
- Preserve exact medical terminology, drug names, numeric values, units, thresholds, dosages, timing windows, and qualifiers EXACTLY as written — a hedge word ("proposed", "may", "usually") is part of the fact, not filler to drop.
- Do not pad with generic concept nodes. Every node must say something the review itself actually states.
- COMPLETENESS: never omit a clinically meaningful detail just to keep the network small — give it its own node rather than dropping it. The only correct reason for a small network is that the review itself doesn't support more.

STRUCTURE:
- Every node needs a short, stable, lowercase_snake_case "id" referenced consistently in every edge touching it.
- "label" is the human-readable text shown on the diagram: natural medical language with normal spaces, sentence case and correct medical capitalization (e.g. "Thrombosis of the internal jugular vein"). Never use underscores or snake_case in a label and never copy the id into it; keep important specifics (named nerves, numbers, thresholds).
- "concept" is the default category for a node. "red_flag" is for findings indicating urgent diagnosis or management the review supports — never invented. "high_yield" is for the single highest-yield, most board-testable fact(s) the review supports.
- Every node's "explanation" is one concise sentence preserving the qualifiers/numbers/timing from its source text.
- Every node needs at least one edge connecting it to the network — an isolated node with no relationships at all isn't a network entry, it's a stray fact; either connect it to something real or leave it out.
- Every edge needs a "relationship" — a short lowercase label describing how the two concepts relate (e.g. "causes", "treats", "indicates", "monitored_by" — pick whatever word fits best, this is a free label). "label" may be an empty string when the relationship word alone is clear enough.

SOURCE CLASSIFICATION (every node is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote from the review notes supporting this exact node.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, every node must be "entry". "sourceRef" for an ai_context node is a short note on what grounds it.

WORKED EXAMPLE (an unrelated topic — shows the FORM and, critically, the CROSS-LINKING a real network needs; never reuse this content):

Example review notes: "Hyperkalemia above 6.5 mEq/L or with ECG changes (peaked T waves, widened QRS) needs urgent treatment. IV calcium gluconate stabilizes the cardiac membrane within minutes but does not lower serum potassium. Insulin with glucose shifts potassium intracellularly, typically working within 15-30 minutes. Kayexalate removes potassium from the body but works over hours, too slow for an acute ECG change."

Example correct output:
{
  "topic": "Hyperkalemia management",
  "nodes": [
    {"id":"threshold","label":"Treatment threshold","explanation":"K+ above 6.5 mEq/L or any ECG change needs urgent treatment.","category":"high_yield","sourceType":"entry","sourceRef":"Hyperkalemia above 6.5 mEq/L or with ECG changes"},
    {"id":"ecg_changes","label":"ECG changes","explanation":"Peaked T waves and widened QRS.","category":"red_flag","sourceType":"entry","sourceRef":"ECG changes (peaked T waves, widened QRS)"},
    {"id":"calcium","label":"IV calcium gluconate","explanation":"Stabilizes cardiac membrane within minutes; does not lower serum K+.","category":"concept","sourceType":"entry","sourceRef":"IV calcium gluconate stabilizes the cardiac membrane within minutes but does not lower serum potassium"},
    {"id":"insulin_glucose","label":"Insulin + glucose","explanation":"Shifts K+ intracellularly, working in 15-30 minutes.","category":"concept","sourceType":"entry","sourceRef":"Insulin with glucose shifts potassium intracellularly, typically working within 15-30 minutes"},
    {"id":"kayexalate","label":"Kayexalate","explanation":"Removes K+ from the body but works over hours.","category":"concept","sourceType":"entry","sourceRef":"Kayexalate removes potassium from the body but works over hours"}
  ],
  "edges": [
    {"source":"threshold","target":"ecg_changes","relationship":"defined_by","label":""},
    {"source":"ecg_changes","target":"calcium","relationship":"treated_by","label":"first, for membrane stabilization"},
    {"source":"threshold","target":"insulin_glucose","relationship":"treated_by","label":""},
    {"source":"threshold","target":"kayexalate","relationship":"treated_by","label":"too slow for acute ECG change"},
    {"source":"calcium","target":"insulin_glucose","relationship":"precedes","label":"calcium buys time for this to work"}
  ]
}
Notice the direct link from "calcium" to "insulin_glucose" — two non-central concepts connected to EACH OTHER, not only both pointing back to "threshold". That cross-linking is what makes this a network rather than a tree; match it on the real review below wherever it genuinely supports one.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildKnowledgeNetworkPrompt(reviewText, extraContext) {
  const trimmedContext = String(extraContext || '').trim();
  let prompt = `Here are the student's review notes. Build the Knowledge Network per your instructions.

Remember: every node must trace back to a specific statement below — extract only what is actually there, and link concepts to EACH OTHER wherever the review supports a direct relationship, not only back to one hub.

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
