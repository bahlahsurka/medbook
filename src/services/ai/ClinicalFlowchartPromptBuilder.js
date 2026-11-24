// services/ai/ClinicalFlowchartPromptBuilder.js
//
// Prompt + schema for the Clinical Flowchart visualization type. A true
// directed, branching flow (start -> decisions -> actions -> outcomes) —
// one of the two Phase 3 types ELK.js lays out (see elkLayout.js), using
// its 'layered' top-to-bottom algorithm, which is exactly what a
// flowchart's own visual convention expects.
export const CLINICAL_FLOWCHART_NODE_CATEGORIES = ['start', 'decision', 'action', 'outcome', 'red_flag'];

export const GROQ_CLINICAL_FLOWCHART_SCHEMA = {
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
          category: { type: 'string', enum: CLINICAL_FLOWCHART_NODE_CATEGORIES },
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
          // For an edge leaving a "decision" node, `label` IS the branch
          // condition (e.g. "Yes", "No", "K+ > 6.5 mEq/L") — the one field
          // this schema asks the model to actually fill in reliably,
          // since it's what makes a branch readable at all.
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

export const CLINICAL_FLOWCHART_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Clinical Flowchart for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

A Clinical Flowchart represents a SEQUENCE of clinical decisions and actions — it has a clear beginning, branches at each decision point, and ends at one or more outcomes. It is NOT a web of related facts (that's a Knowledge Network) and NOT a cause-effect chain (that's a Mechanism Diagram) — it is "what do you do, in order, and what do you do differently depending on what you find."

ABSOLUTE RULES:
- Build the flowchart ONLY from information clearly supported by the review notes (and, if explicitly supplied, the additional medical context block below).
- NEVER invent a decision, threshold, or step not present in the review or supplied context — even if you know the real clinical guideline. This is the most important rule.
- Preserve exact criteria and thresholds EXACTLY as written — a specific number, lab value, or cutoff ("K+ above 6.5", "systolic BP under 90") must appear in the decision node or its branch labels exactly as the review states it, never rounded or rephrased into a vaguer criterion.
- Do not invent extra decision points or steps the review never mentions just to make the chart look more complete.

STRUCTURE:
- Exactly ONE node has category "start" — where the clinical scenario begins.
- "decision" nodes are branch points — something is checked, and the next step depends on the answer. EVERY decision node needs AT LEAST TWO outgoing edges, each with a "label" stating the actual condition for that branch (e.g. "Yes" / "No", or a specific threshold like "K+ > 6.5 mEq/L" / "K+ <= 6.5 mEq/L"). A decision node with only one way out is not a real decision — give it a second branch or change its category to "action".
- "action" nodes are a step taken (a test ordered, a drug given, a procedure done).
- "outcome" nodes are where a pathway ends (a diagnosis confirmed, a disposition decided).
- "red_flag" nodes are urgent findings/steps the review flags as needing immediate action — use this instead of "action"/"outcome" when a step IS the urgent one.
- Every node needs a short, stable, lowercase_snake_case "id" referenced consistently in every edge touching it. Every node (except possibly a terminal outcome) needs at least one outgoing edge — a flowchart with a dead end that was never meant to be the end is a broken chart.
- Every node's "explanation" is one concise sentence preserving the exact criteria/thresholds from its source text.

SOURCE CLASSIFICATION (every node is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote from the review notes supporting this exact node.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, every node must be "entry".

WORKED EXAMPLE (an unrelated topic — shows the FORM, especially the two-branch decision structure; never reuse this content):

Example review notes: "For suspected PE, first assess hemodynamic stability. If the patient is hemodynamically unstable (systolic BP under 90), proceed directly to thrombolysis if no contraindication. If stable, obtain a CT pulmonary angiogram. If CTPA is positive, start anticoagulation. If CTPA is negative but Wells score is high, consider further imaging."

Example correct output:
{
  "topic": "Suspected PE workup",
  "nodes": [
    {"id":"start","label":"Suspected PE","explanation":"Entry point for suspected pulmonary embolism.","category":"start","sourceType":"entry","sourceRef":"For suspected PE, first assess hemodynamic stability"},
    {"id":"stability_check","label":"Hemodynamically stable?","explanation":"Check if systolic BP is under 90 (unstable) or not.","category":"decision","sourceType":"entry","sourceRef":"If the patient is hemodynamically unstable (systolic BP under 90)"},
    {"id":"thrombolysis","label":"Thrombolysis","explanation":"Proceed directly to thrombolysis if no contraindication.","category":"red_flag","sourceType":"entry","sourceRef":"proceed directly to thrombolysis if no contraindication"},
    {"id":"ctpa","label":"CT pulmonary angiogram","explanation":"Obtain CTPA if hemodynamically stable.","category":"action","sourceType":"entry","sourceRef":"If stable, obtain a CT pulmonary angiogram"},
    {"id":"ctpa_check","label":"CTPA positive?","explanation":"Branch on CTPA result.","category":"decision","sourceType":"entry","sourceRef":"If CTPA is positive, start anticoagulation. If CTPA is negative"},
    {"id":"anticoagulation","label":"Start anticoagulation","explanation":"Started if CTPA is positive.","category":"outcome","sourceType":"entry","sourceRef":"start anticoagulation"},
    {"id":"further_imaging","label":"Consider further imaging","explanation":"If CTPA negative but Wells score high.","category":"outcome","sourceType":"entry","sourceRef":"If CTPA is negative but Wells score is high, consider further imaging"}
  ],
  "edges": [
    {"source":"start","target":"stability_check","relationship":"then","label":""},
    {"source":"stability_check","target":"thrombolysis","relationship":"branches_to","label":"Unstable (SBP < 90)"},
    {"source":"stability_check","target":"ctpa","relationship":"branches_to","label":"Stable"},
    {"source":"ctpa","target":"ctpa_check","relationship":"then","label":""},
    {"source":"ctpa_check","target":"anticoagulation","relationship":"branches_to","label":"Positive"},
    {"source":"ctpa_check","target":"further_imaging","relationship":"branches_to","label":"Negative, high Wells score"}
  ]
}
Notice EVERY decision node ("stability_check", "ctpa_check") has exactly two labeled branches stating the real condition, not bare "Yes"/"No" with no criterion attached. Match this on the real review below.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildClinicalFlowchartPrompt(reviewText, extraContext) {
  const trimmedContext = String(extraContext || '').trim();
  let prompt = `Here are the student's review notes. Build the Clinical Flowchart per your instructions.

Remember: every decision needs at least two labeled branches with the REAL criteria from the review — extract only what is actually there.

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
