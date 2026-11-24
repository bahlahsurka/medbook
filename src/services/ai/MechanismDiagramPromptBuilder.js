// services/ai/MechanismDiagramPromptBuilder.js
//
// Prompt + schema for the Mechanism Diagram visualization type — a
// pathophysiological CHAIN (cause -> intermediate mechanism(s) ->
// consequence), possibly branching/converging but never a general tangled
// network. Gets its own cheap, purpose-built layout (sequentialLayout.js)
// rather than ELK — see that file's own header comment on why a staged
// chain doesn't need ELK's weight the way Knowledge Network/Clinical
// Flowchart genuinely do.
export const MECHANISM_NODE_CATEGORIES = ['cause', 'mechanism', 'consequence', 'red_flag'];

export const GROQ_MECHANISM_DIAGRAM_SCHEMA = {
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
          category: { type: 'string', enum: MECHANISM_NODE_CATEGORIES },
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

export const MECHANISM_DIAGRAM_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Mechanism Diagram for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

A Mechanism Diagram shows a pathophysiological CHAIN: a root CAUSE, the intermediate MECHANISM step(s) by which it produces an effect, and the resulting CONSEQUENCE(S) — in causal order, connected by directed edges FROM cause TOWARD consequence. It is not a general web of related facts (that's a Knowledge Network) and not a sequence of clinical decisions (that's a Clinical Flowchart) — it is specifically "this leads to this, which leads to this."

ABSOLUTE RULES:
- Build the chain ONLY from causal relationships clearly stated or clearly implied by the review notes (and, if explicitly supplied, the additional medical context block below).
- NEVER invent a causal link the review doesn't support, even one you know is medically true — if the review doesn't say or clearly imply A causes B, do not draw that edge. This is the most important rule.
- Preserve exact mechanism language, hedges ("proposed", "thought to"), numeric values, and thresholds EXACTLY as written — a proposed mechanism must stay "proposed", not become a stated fact.
- Do not invent extra intermediate steps the review never mentions just to make the chain look more detailed.

STRUCTURE:
- "cause" nodes are the root trigger(s) — usually just one, but a review can support more than one contributing cause.
- "mechanism" nodes are the intermediate step(s) connecting a cause to its consequence — there can be one or several in sequence, or a cause can branch into two parallel mechanisms that both contribute to the same consequence.
- "consequence" nodes are the end result(s) of the chain.
- "red_flag" is for a consequence that is itself an urgent/dangerous finding — use this instead of "consequence" when that's the case.
- Every edge should point FORWARD along the causal chain (source = the earlier step, target = the later one it leads to) — never backward.
- Every node needs a short, stable, lowercase_snake_case "id" referenced consistently in every edge touching it, and at least one edge connecting it into the chain.
- Every node's "explanation" is one concise sentence preserving the exact mechanism language/hedges/numbers from its source text.
- Every edge needs a "relationship" — a short lowercase label for the causal link (e.g. "leads_to", "causes", "triggers", "results_in" — pick whatever fits). "label" may be empty, or a short clarifying phrase (e.g. "if untreated").

SOURCE CLASSIFICATION (every node is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote supporting this exact node.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, every node must be "entry".

WORKED EXAMPLE (an unrelated topic — shows the FORM, especially preserving a hedge and a branching mechanism; never reuse this content):

Example review notes: "Succinylcholine causes transient hyperkalemia via sustained depolarization of extrajunctional ACh receptors, which are upregulated in burn and denervation injuries. This can precipitate cardiac arrhythmia, especially in patients with pre-existing renal impairment."

Example correct output:
{
  "topic": "Succinylcholine-induced hyperkalemia",
  "nodes": [
    {"id":"cause","label":"Succinylcholine administration","explanation":"Depolarizing agent given to a susceptible patient.","category":"cause","sourceType":"entry","sourceRef":"Succinylcholine causes transient hyperkalemia"},
    {"id":"receptor_upregulation","label":"Upregulated extrajunctional ACh receptors","explanation":"Upregulated in burn and denervation injuries.","category":"mechanism","sourceType":"entry","sourceRef":"extrajunctional ACh receptors, which are upregulated in burn and denervation injuries"},
    {"id":"depolarization","label":"Sustained depolarization","explanation":"Sustained depolarization of these receptors.","category":"mechanism","sourceType":"entry","sourceRef":"via sustained depolarization of extrajunctional ACh receptors"},
    {"id":"hyperkalemia","label":"Transient hyperkalemia","explanation":"Transient rise in serum potassium.","category":"consequence","sourceType":"entry","sourceRef":"causes transient hyperkalemia"},
    {"id":"arrhythmia","label":"Cardiac arrhythmia","explanation":"Can precipitate arrhythmia, especially with pre-existing renal impairment.","category":"red_flag","sourceType":"entry","sourceRef":"can precipitate cardiac arrhythmia, especially in patients with pre-existing renal impairment"}
  ],
  "edges": [
    {"source":"cause","target":"receptor_upregulation","relationship":"requires","label":"in burn/denervation injury"},
    {"source":"receptor_upregulation","target":"depolarization","relationship":"leads_to","label":""},
    {"source":"depolarization","target":"hyperkalemia","relationship":"causes","label":""},
    {"source":"hyperkalemia","target":"arrhythmia","relationship":"can_precipitate","label":"especially with renal impairment"}
  ]
}
Notice the chain runs strictly forward (cause -> mechanism -> mechanism -> consequence -> red_flag) and "can precipitate" stays a hedge, not a certainty. Match this on the real review below.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildMechanismDiagramPrompt(reviewText, extraContext) {
  const trimmedContext = String(extraContext || '').trim();
  let prompt = `Here are the student's review notes. Build the Mechanism Diagram per your instructions.

Remember: every edge must point forward along the real causal chain the review states — extract only what is actually there, and never invent a causal link.

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
