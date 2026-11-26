// services/ai/MechanismDiagramPromptBuilder.js
//
// Prompt + schema for the Mechanism Diagram visualization type — a
// pathophysiological CHAIN (cause -> intermediate mechanism(s) ->
// consequence), possibly branching/converging but never a general tangled
// network. Gets its own cheap, purpose-built layout (sequentialLayout.js)
// rather than ELK — see that file's own header comment on why a staged
// chain doesn't need ELK's weight the way Knowledge Network/Clinical
// Flowchart genuinely do.
export const MECHANISM_NODE_CATEGORIES = ['cause', 'mechanism', 'manifestation', 'consequence', 'red_flag', 'investigation', 'management'];

// Preferred relationship vocabulary (free text in the schema — see
// visualizationValidationHelpers.js on why relationships aren't an enum).
export const MECHANISM_RELATIONSHIPS = [
  'causes', 'results_in', 'leads_to', 'progresses_to', 'extends_into', 'spreads_through', 'spreads_to',
  'presents_with', 'complicated_by', 'associated_with', 'increases_risk_of', 'requires', 'diagnosed_by', 'treated_with',
  'can_cause', 'can_result_in', 'can_lead_to', 'can_extend_into', 'can_spread_to', 'may_present_with',
];

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

NODE CATEGORIES (use each only for what it really is):
- "cause": the root trigger(s) / etiology / initiating event — nothing comes before it.
- "mechanism": an intermediate pathophysiological or anatomical-spread step between a cause and its results.
- "manifestation": a symptom, sign or examination finding of a condition (e.g. fever, odynophagia, neck stiffness). Connect it FROM the condition it belongs to with "presents_with" — a symptom is not a step in the causal chain.
- "consequence": a resulting condition or complication at the end of a branch.
- "red_flag": a consequence that is itself dangerous / life-threatening / needs urgent action, as the review describes it. Do not mark ordinary findings as red flags.
- "investigation": a test the review says to do (connect with "diagnosed_by" or "requires").
- "management": a treatment/intervention the review states (connect with "treated_with" or "requires").
Only include categories the review actually supports.

ORGANIZATION:
- Build meaningful BRANCHES rather than linking everything to one central node: the initiating event -> the core condition -> separate branches for (a) its clinical manifestations, (b) each distinct route of spread / mechanism chain in order, (c) the complications each route produces, and (d) investigations/management attached to the condition or complication they belong to.
- Keep a multi-step route as a chain (A extends into B, which spreads to C, which results in D) instead of joining every step back to the centre.
- If the review says two things happen together or in parallel (e.g. "extends into X, with spread to Y"), connect them the way the sentence does; do not invent a sequence the review doesn't state.

LABELS:
- "label" is the human-readable text shown on the diagram: natural medical language with normal spaces, sentence case and correct medical capitalization/abbreviations (e.g. "Thrombosis of the internal jugular vein", "Cranial nerve IX–XII deficits", "Chest X-ray: widened mediastinum"). NEVER use underscores or snake_case in a label, and never copy the id into the label.
- Keep labels short (about 2–7 words) but keep the specifics that matter: named nerves, numbers, thresholds, laterality.
- "id" is internal only: a short, stable, lowercase_snake_case identifier, referenced consistently in every edge touching that node.

RELATIONSHIPS:
- Every edge needs a "relationship" that states the actual medical link, in lowercase_snake_case, chosen from: causes, results_in, leads_to, progresses_to, extends_into, spreads_through, spreads_to, presents_with, complicated_by, associated_with, increases_risk_of, requires, diagnosed_by, treated_with — or a hedged form when the review hedges it: can_cause, can_result_in, can_lead_to, can_extend_into, can_spread_to, may_present_with. Prefer the most specific accurate verb; avoid using "causes"/"leads_to" for everything.
- Keep the review's certainty: if it says "can", "may", "potentially", "proposed", use the hedged form (or put the qualifier in "label"). Never turn a possibility into a certainty.
- "label" may be empty, or a short qualifier from the review (e.g. "rapidly", "if untreated", "especially with renal impairment").
- Only draw an edge the review states or clearly implies. Do not add links to make the diagram look complete.
- Edges point FORWARD (source = the earlier step or the condition, target = what follows from it / what it presents with) — never backward.

OTHER RULES:
- Every node needs at least one edge connecting it into the diagram.
- Every node's "explanation" is one concise sentence preserving the exact language, hedges and numbers from its source text.

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
    {"source":"hyperkalemia","target":"arrhythmia","relationship":"can_result_in","label":"especially with renal impairment"}
  ]
}
Notice the chain runs strictly forward (cause -> mechanism -> mechanism -> consequence -> red_flag), labels are natural text (no underscores), and "can precipitate" stays a hedge ("can_result_in"), not a certainty. If a review also lists symptoms, they become "manifestation" nodes linked from the condition with "presents_with"; a recommended test becomes an "investigation" node, and a stated treatment a "management" node. Match this on the real review below.

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
