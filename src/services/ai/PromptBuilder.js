// services/ai/PromptBuilder.js
//
// Builds the prompt sent to whichever provider is answering (Groq primary,
// Gemini fallback — see api/analyze.mjs). Kept separate from transport
// (GroqService/GeminiService) and validation (ResponseParser) so prompts
// can be tuned or versioned without touching anything else. This file now
// runs server-side (imported by api/analyze.mjs) as well as being bundled
// into the client for the read-only bits (LIMITS, FREE_TIER_LIMITS) the UI
// still needs — it has no env/browser dependency either way.

export const PROMPT_VERSION = 'v1';

// Published free-tier ceilings, for the usage estimate shown in the UI.
// These are NOT read from either provider at runtime — neither free tier
// reliably exposes a remaining-quota figure — so this is a rough guide
// against published limits, not an authoritative live number.
export const FREE_TIER_LIMITS = {
  'gemini-2.5-pro':        { rpm: 5,  rpd: 100  },
  'gemini-2.5-flash':      { rpm: 10, rpd: 250  },
  'gemini-flash-latest':   { rpm: 10, rpd: 250  }, // the alias — see GeminiService.js for why we stopped defaulting to it
  'gemini-2.5-flash-lite': { rpm: 15, rpd: 1000 },
  'gemini-3.5-flash':      { rpm: 10, rpd: 250  },
  // Confirmed directly in Google AI Studio (2026-08-15) — notably tighter
  // than the older Flash models above; this is exactly why the default
  // model was pinned instead of left on the auto-updating alias.
  'gemini-3.6-flash':      { rpm: 5,  rpd: 20   },
  // Groq's own published numbers (console.groq.com/docs/rate-limits,
  // confirmed 2026-10-14) for the Developer-plan base tier, which is what
  // a fresh no-credit-card signup gets. Groq enforces these per
  // ORGANIZATION, not per key — exactly why the request count this limit
  // is compared against now has to be tracked server-side (see
  // ai_usage_daily in api/analyze.mjs) rather than per browser session.
  'openai/gpt-oss-20b':    { rpm: 30, rpd: 1000 },
};
export function limitsFor(model) {
  return FREE_TIER_LIMITS[model] || { rpm: null, rpd: null };
}

/** Hard caps from the spec. Enforced in the prompt AND again in ResponseParser. */
export const LIMITS = {
  keyLearningPoints: 7,   // ~3-7
  highYield:         5,   // max 5
  clinicalPearls:    3,   // max 3
  redFlags:          5,
  relatedTopics:     8,
  // No cap — a thorough Review can legitimately support more than 6
  // question/answer pairs, and arbitrarily truncating a longer, well-
  // supported set discarded real study material for no reason tied to the
  // actual content. Array#slice(0, Infinity) returns the full array, so
  // this stays a plain "cap" everywhere it's used below rather than
  // needing a separate uncapped code path.
  flashcards:        Infinity,
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
 * Groq structured-output schema — same six fields as RESPONSE_SCHEMA above,
 * just standard JSON Schema instead of Gemini's uppercase OBJECT/ARRAY/STRING
 * dialect. Shaped specifically for Groq's `strict: true` mode (confirmed
 * against console.groq.com/docs/structured-outputs, 2026-10-14): every
 * object — including the nested flashcard items — must list ALL of its own
 * properties in `required` and set `additionalProperties: false`, or Groq
 * rejects the request outright rather than just being less reliable about
 * it. Sent via GroqService as response_format.json_schema.schema.
 */
export const GROQ_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    keyLearningPoints: { type: 'array', items: { type: 'string' } },
    highYield:         { type: 'array', items: { type: 'string' } },
    clinicalPearls:    { type: 'array', items: { type: 'string' } },
    redFlags:          { type: 'array', items: { type: 'string' } },
    relatedTopics:     { type: 'array', items: { type: 'string' } },
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { front: { type: 'string' }, back: { type: 'string' } },
        required: ['front', 'back'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'keyLearningPoints', 'highYield', 'clinicalPearls',
    'redFlags', 'relatedTopics', 'flashcards',
  ],
  additionalProperties: false,
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
