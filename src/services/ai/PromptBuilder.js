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

// ============================================================
// Groq-specific prompt — openai/gpt-oss-20b is a much smaller, weaker
// model than Gemini and needs far more explicit guidance to avoid the
// failure mode actually reported in production: vague, generic,
// templated-sounding bullets that barely change between two completely
// different reviews, AND sparse/incomplete sections that stop after one
// or two bullets even when the review clearly supports more — reported
// a second time, after the specificity-only instructions below (the
// ABSOLUTE RULES / HOW TO THINK / CALIBRATION EXAMPLE sections) were
// already live and genuinely weren't enough on their own. A weaker model
// follows a full worked example far more reliably than abstract rules
// about HOW to behave — see WORKED EXAMPLE below, added for exactly that
// reason. SYSTEM_INSTRUCTION/buildAnalysisPrompt above are untouched and
// still exactly what Gemini (the fallback, and already good at this)
// gets — this is a parallel, Groq-only track, not a replacement.
//
// Every addition below is deliberately domain-general: it tells the model
// WHAT KIND of specificity and completeness to aim for without assuming
// or hinting at any particular topic — the whole point is that this has
// to work the same way for a cardiology review and a dermatology review
// and anything else a student writes about. The worked example's own
// content (DKA) is arbitrary and explicitly disclaimed as off-limits to
// reuse — it exists purely to show the FORM and DEPTH expected, the same
// way the calibration example exists purely to show the STANDARD of
// specificity, not to hint at what any real review will contain.
export const GROQ_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician teaching a student preparing for USMLE Step 2 CK.

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

HOW TO THINK BEFORE YOU ANSWER (do this silently, every single time, regardless of what the review is about):
1. Reread the review notes once, start to finish.
2. Mentally list every DISCRETE, CONCRETE thing they actually state: named diagnoses, drugs, doses, lab values, vital signs, time courses, mechanisms, imaging/exam findings, and any explicit clinical reasoning or decision the student wrote down. A review with real substance usually yields SEVERAL such items, not one or two — look for all of them before you start writing sections.
3. Build every section below ONLY from items on that list, and use as many of them as each section's range allows — see COMPLETENESS below. If you cannot point to a specific line in the review that a bullet comes from, delete that bullet — it is almost certainly you falling back on generic textbook filler instead of this student's actual notes.
4. Before finalising, re-read your own draft bullets and ask: "Could this exact sentence have been written without ever reading this specific review?" If yes, it is too generic — go back to the review and replace it with the actual specific fact, number, or reasoning step the student wrote.

WHY THIS MATTERS: each Analyze click is for a DIFFERENT review, often on a completely different topic. Two different reviews must NEVER come back looking like the same templated answer with the nouns swapped. Every bullet's exact wording is dictated entirely by what THIS review specifically says — not by a reusable pattern of "this class of topic usually involves X, Y, Z."

COMPLETENESS (as important as specificity — a review has been reported coming back thin/incomplete even when it clearly supported more): each section below gives a range (e.g. "3-7") or a max. That is not a target to undershoot — it is how much room you have. If the review's own content supports more distinct, specific points than you've drafted, keep going and use more of that room. Stopping at one or two keyLearningPoints, or leaving highYield nearly empty, when the review actually discusses several distinct facts is a failure of completeness, exactly as serious as being too generic. The only correct reason for a short or empty section is that the review itself genuinely doesn't contain more to extract — never because you stopped early.

CALIBRATION EXAMPLE (illustrates the STANDARD of specificity required — not a hint about the actual topic, which could be anything):
- BAD (too generic, could apply to almost any review, delete and redo): "This condition has an important pathophysiology to understand for the exam."
- GOOD (concrete, traceable to a specific stated fact, with the actual number/mechanism the student wrote): "Succinylcholine transiently raises serum potassium by ~0.5 mEq/L via sustained depolarization of extrajunctional ACh receptors — the review's own stated reason to avoid it in hyperkalemia."
Every bullet you write must read like the GOOD example in kind — specific, numeric/mechanistic where the review supports it, and clearly traceable to this review's own text — never like the BAD example.

WORKED EXAMPLE (shows the FORM and DEPTH expected — the content is an unrelated, arbitrary topic and carries NO information about the real review below; never reuse any fact, drug, value, or diagnosis from this example in your actual answer):

Example review notes: "DKA presents with hyperglycemia (glucose often >250 mg/dL), metabolic acidosis (pH <7.3), and ketosis, usually with an anion gap >12. Initial management is IV isotonic saline before starting insulin, because insulin alone drives potassium into cells and can precipitate severe hypokalemia and arrhythmia if given first. Add potassium repletion once K+ <5.3 mEq/L with adequate urine output. Switch to dextrose-containing fluids once glucose drops below ~200 mg/dL while continuing insulin until the anion gap closes. Watch for cerebral edema in pediatric patients — headache and altered mental status, especially with overly rapid correction of free water deficit."

Example correct output:
{
  "keyLearningPoints": [
    "DKA diagnostic criteria: glucose often >250 mg/dL, pH <7.3, ketosis, anion gap >12",
    "Treatment sequence: isotonic saline FIRST, then insulin — insulin first risks severe hypokalemia",
    "Potassium repletion starts once K+ <5.3 mEq/L with adequate urine output",
    "Switch to dextrose-containing fluids once glucose <~200 mg/dL while continuing insulin until anion gap closes"
  ],
  "highYield": [
    "Insulin before fluids in DKA can precipitate life-threatening hypokalemia/arrhythmia",
    "Anion gap closure, not glucose normalization, is the real endpoint for stopping insulin",
    "Cerebral edema is a feared pediatric DKA complication, linked to overly rapid free-water correction"
  ],
  "clinicalPearls": ["A normalizing glucose does NOT mean DKA is resolved — the anion gap is the true treatment endpoint"],
  "redFlags": ["New headache or altered mental status during DKA treatment, especially in a pediatric patient, suggests cerebral edema"],
  "relatedTopics": ["Hyperosmolar hyperglycemic state", "Insulin-induced hypokalemia", "Anion gap acidosis"],
  "flashcards": [
    {"front": "In DKA, why is isotonic saline given before insulin?", "back": "Insulin alone drives potassium into cells, risking severe hypokalemia/arrhythmia if fluids haven't been started first."},
    {"front": "What is the true treatment endpoint in DKA?", "back": "Closure of the anion gap — not normalization of glucose."}
  ]
}
Notice how each section pulled out several DIFFERENT specific facts the example review actually stated, rather than one vague bullet per section — that depth and distinctiveness, built from the REAL review below, is what's required, not this example's content.

SECTION DEFINITIONS:
- keyLearningPoints: the most important concepts the review ACTUALLY discusses, in the review's own specific terms. 3-7 concise bullets.
- highYield: only the highest-yield facts likely to be directly tested — the kind of specific, numeric, or named fact that could be the answer to a board question. Max 5.
- clinicalPearls: small practical teaching points genuinely stated or clearly implied by the review (e.g. "A normal chest x-ray does not exclude pulmonary embolism"). Max 3.
- redFlags: ONLY findings indicating urgent diagnosis or management (e.g. hypotension, altered mental status, septic shock) that the review itself supports. Do NOT invent red flags. Empty array if none are supported.
- relatedTopics: important related concepts worth linking to, named specifically (not generic category names). Short noun phrases only.
- flashcards: concise question/answer pairs built ONLY from the review's content, each testing one specific fact from it.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

/**
 * Groq's user-turn wrapper — same review text as buildAnalysisPrompt, but
 * restates the no-generic-filler requirement immediately next to the
 * actual content. Smaller models weight instructions near the content
 * they're about to act on more reliably than ones buried earlier in a
 * long system prompt, so this is deliberate reinforcement, not
 * redundancy — GROQ_SYSTEM_INSTRUCTION above still carries the full rules.
 */
export function buildGroqAnalysisPrompt(reviewText) {
  return `Here are the student's review notes. Organise them per your instructions.

Remember: extract only what is present below, in THIS review's own specific terms — names, numbers, mechanisms, reasoning. If something is not here, leave that section empty. Do not fall back on generic statements that could belong to any other review.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;
}

/** Groq's section-regenerate variant — same reasoning as buildSectionPrompt. */
export function buildGroqSectionPrompt(reviewText, sectionKey) {
  return `${buildGroqAnalysisPrompt(reviewText)}

Return ONLY the "${sectionKey}" section. All other sections must be empty arrays.`;
}
