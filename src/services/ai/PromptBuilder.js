// services/ai/PromptBuilder.js
//
// Builds the prompt sent to Gemini. Kept separate from transport (GeminiService)
// and validation (ResponseParser) so prompts can be tuned or versioned without
// touching anything else.

export const PROMPT_VERSION = 'v1';

/** Hard caps from the spec. Enforced in the prompt AND again in ResponseParser. */
export const LIMITS = {
  keyLearningPoints: 7,   // ~3-7
  highYield:         5,   // max 5
  clinicalPearls:    3,   // max 3
  redFlags:          5,
  relatedTopics:     8,
  flashcards:        6,
};

/**
 * The persona + rules. Sent as Gemini's systemInstruction so it carries more
 * weight than if it were buried in the user turn.
 */
export const SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician teaching a student preparing for USMLE Step 2 CK.

You are given the student's own written review notes about a single question they have just studied. Your ONLY job is to ORGANISE the information that is already present in those notes into structured, high-yield study material.

ABSOLUTE RULES:
- Extract ONLY information that is clearly supported by the student's review text.
- NEVER invent, infer beyond, or add facts that are not in the review — even if they are medically true and you know them. This is the most important rule.
- NEVER rewrite, replace, summarise, or comment on the student's review itself.
- If a section is not supported by the review, return an EMPTY array for it. An empty section is correct and expected; a fabricated one is a failure.
- Prioritise facts that are genuinely board-relevant for Step 2 CK.
- Be concise. Use short bullet points, not paragraphs. Never write prose.
- Preserve exact medical terminology, drug names, values, and units as the student wrote them.
- Do not explain basic concepts the student clearly already understands.

SECTION DEFINITIONS:
- keyLearningPoints: the most important concepts in the review. 3-7 concise bullets.
- highYield: only the highest-yield facts likely to be directly tested. Max 5.
- clinicalPearls: small practical teaching points (e.g. "A normal chest x-ray does not exclude pulmonary embolism"). Max 3.
- redFlags: ONLY findings indicating urgent diagnosis or management (e.g. hypotension, altered mental status, septic shock). Do NOT invent red flags. Empty array if none are supported.
- relatedTopics: important related concepts worth linking to. Short noun phrases only.
- flashcards: concise question/answer pairs built ONLY from the review's content.`;

/**
 * Gemini structured-output schema. This is what actually forces valid JSON —
 * far more reliable than asking for JSON in the prose.
 */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    keyLearningPoints: { type: 'ARRAY', items: { type: 'STRING' } },
    highYield:         { type: 'ARRAY', items: { type: 'STRING' } },
    clinicalPearls:    { type: 'ARRAY', items: { type: 'STRING' } },
    redFlags:          { type: 'ARRAY', items: { type: 'STRING' } },
    relatedTopics:     { type: 'ARRAY', items: { type: 'STRING' } },
    flashcards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { front: { type: 'STRING' }, back: { type: 'STRING' } },
        required: ['front', 'back'],
      },
    },
  },
  required: [
    'keyLearningPoints', 'highYield', 'clinicalPearls',
    'redFlags', 'relatedTopics', 'flashcards',
  ],
};

/**
 * Build the user turn. ONLY the review text is sent — never the question,
 * images, system, difficulty or any other metadata (per spec: cheaper prompts,
 * tighter focus, less to hallucinate from).
 */
export function buildAnalysisPrompt(reviewText) {
  return `Here are the student's review notes. Organise them per your instructions.

Remember: extract only what is present below. If something is not here, leave that section empty.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;
}

/**
 * Future expansion hook (spec: "Regenerate only High Yield", etc.) — same
 * persona and rules, but scoped to one section.
 */
export function buildSectionPrompt(reviewText, sectionKey) {
  return `${buildAnalysisPrompt(reviewText)}

Return ONLY the "${sectionKey}" section. All other sections must be empty arrays.`;
}
