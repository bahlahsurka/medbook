// services/ai/VisualSummaryPromptBuilder.js
//
// Prompt + schema for the Visual Summary visualization type — a compact,
// graphic-rich REVISION OVERVIEW: a short, prioritized list of the
// highlights worth re-reading right before an exam, not a restatement of
// the whole entry. Like Comparison Map, deliberately NOT the shared
// node/edge graph shape — a summary card grid has no meaningful edges at
// all, so it gets its own flat "highlights" shape and a purpose-built
// React card-grid renderer (no React Flow, no layout engine).
export const VISUAL_SUMMARY_IMPORTANCE = ['critical', 'high', 'standard'];
export const VISUAL_SUMMARY_CATEGORIES = ['red_flag', 'key_fact', 'number', 'pearl'];

export const GROQ_VISUAL_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          // A short, scannable phrase — the thing a student should still
          // remember after a 2-second glance (e.g. "Serum K+ > 6.5 mEq/L →
          // emergent"). Not a full sentence.
          headline: { type: 'string' },
          // One supporting sentence with the full clinical detail,
          // preserving exact source wording/numbers/hedges.
          detail: { type: 'string' },
          importance: { type: 'string', enum: VISUAL_SUMMARY_IMPORTANCE },
          category: { type: 'string', enum: VISUAL_SUMMARY_CATEGORIES },
          sourceType: { type: 'string', enum: ['entry', 'ai_context'] },
          sourceRef: { type: 'string' },
        },
        required: ['id', 'headline', 'detail', 'importance', 'category', 'sourceType', 'sourceRef'],
        additionalProperties: false,
      },
    },
  },
  required: ['topic', 'highlights'],
  additionalProperties: false,
};

export const VISUAL_SUMMARY_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Visual Summary for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

A Visual Summary is a COMPACT, GRAPHIC-RICH REVISION OVERVIEW — a short, prioritized list of the facts most worth re-reading right before an exam. It is NOT a restatement of the entire entry, and it is NOT a graph of related concepts (that's a Knowledge Network) — it exists so a student under time pressure can scan it in under a minute and walk away with the most important points.

ABSOLUTE RULES:
- Select only genuinely important highlights from the review notes (and, if explicitly supplied, the additional medical context block below) — prioritize ruthlessly. A short review might only produce 3-4 highlights; a long, dense one might produce 10-12. Never pad the list with restated or decorative filler just to look fuller.
- NEVER invent a fact, number, or red flag the review doesn't contain, even one you know is medically true.
- Preserve exact numeric values, units, thresholds, hedges, and timing windows EXACTLY as written in "detail" — a specific number or a hedge like "may" must survive unchanged.
- Any genuinely urgent/dangerous finding or action the review flags MUST be captured as a "red_flag" highlight with "importance":"critical" — do not bury a red flag at "standard" importance, and do not invent one that isn't there.
- Avoid generic decorative content — every highlight must trace to something specific the review actually says, not a generic textbook statement about the topic.

STRUCTURE:
- "headline" is a short, punchy, scannable phrase (not a full sentence) — the single thing to remember.
- "detail" is one supporting sentence with the full clinical nuance, preserving exact source wording.
- "importance": "critical" for the few things that matter most (red flags, the single key diagnostic/management point); "high" for clearly important supporting facts; "standard" for everything else worth keeping but less central.
- "category": "red_flag" for an urgent/dangerous finding; "key_fact" for a core diagnostic/management point; "number" for a specific numeric value/threshold worth memorizing; "pearl" for a high-yield distinguishing tip or commonly-confused point.
- Every highlight needs a short, stable, lowercase_snake_case "id".

SOURCE CLASSIFICATION (every highlight is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote supporting this exact highlight.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, every highlight must be "entry".

WORKED EXAMPLE (an unrelated topic — shows the FORM, especially ruthless prioritization and a correctly flagged red flag; never reuse this content):

Example review notes: "Acute angle-closure glaucoma presents with sudden severe eye pain, headache, nausea/vomiting, and a red eye with a fixed, mid-dilated pupil. IOP is often above 40-50 mmHg. This is an ophthalmologic emergency — treatment (IV acetazolamide, topical agents) must not be delayed, as permanent vision loss can occur within hours. A key distinguishing feature from conjunctivitis is the presence of severe pain and a non-reactive pupil."

Example correct output:
{
  "topic": "Acute angle-closure glaucoma",
  "highlights": [
    {"id":"emergency_flag","headline":"Ophthalmologic emergency — treat immediately","detail":"Treatment must not be delayed, as permanent vision loss can occur within hours.","importance":"critical","category":"red_flag","sourceType":"entry","sourceRef":"treatment ... must not be delayed, as permanent vision loss can occur within hours"},
    {"id":"iop_threshold","headline":"IOP often >40-50 mmHg","detail":"Intraocular pressure is often above 40-50 mmHg.","importance":"critical","category":"number","sourceType":"entry","sourceRef":"IOP is often above 40-50 mmHg"},
    {"id":"classic_presentation","headline":"Sudden eye pain, headache, N/V, red eye","detail":"Presents with sudden severe eye pain, headache, nausea/vomiting, and a red eye.","importance":"high","category":"key_fact","sourceType":"entry","sourceRef":"sudden severe eye pain, headache, nausea/vomiting, and a red eye"},
    {"id":"pupil_pearl","headline":"Fixed, mid-dilated, non-reactive pupil distinguishes from conjunctivitis","detail":"A key distinguishing feature from conjunctivitis is the presence of severe pain and a non-reactive pupil.","importance":"high","category":"pearl","sourceType":"entry","sourceRef":"A key distinguishing feature from conjunctivitis is the presence of severe pain and a non-reactive pupil"}
  ]
}
Notice the list is short and ruthlessly prioritized (not every clause from the source became its own highlight), and the one true emergency is correctly "critical"/"red_flag". Match this on the real review below.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildVisualSummaryPrompt(reviewText, extraContext) {
  const trimmedContext = String(extraContext || '').trim();
  let prompt = `Here are the student's review notes. Build the Visual Summary per your instructions.

Remember: prioritize ruthlessly, never pad the list, and make sure any genuine red flag is captured at "critical" importance.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;

  if (trimmedContext) {
    prompt += `

--- BEGIN ADDITIONAL MEDICAL CONTEXT (supplied separately by the user, NOT part of their review notes — highlights built from this block, and ONLY this block, must be marked sourceType "ai_context") ---
${trimmedContext}
--- END ADDITIONAL MEDICAL CONTEXT ---`;
  }
  return prompt;
}
