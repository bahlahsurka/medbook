// services/ai/KeyPointsPromptBuilder.js
//
// Phase 5: a dedicated prompt + Groq strict-mode schema for "Key Points" —
// the concise, exam-oriented textual summary that replaces the old flat
// six-array AI Analysis presentation (keyLearningPoints/highYield/
// clinicalPearls/redFlags/relatedTopics) in the entry detail view. This is
// a genuinely NEW schema, not a re-prompted version of the old one — see
// this module's own header reasoning below for why a flat array of
// strings literally cannot express "clear bold headings organizing
// concepts" or "red flags emphasized rather than siloed into their own
// box", both explicit Phase 5 requirements.
//
// Deliberately does NOT touch PromptBuilder.js/ResponseParser.js/
// GroqService's existing six-section task, GeminiService.js, or
// api/analyze.mjs — ALL of that stays exactly as it is, because it is
// also "the flashcard generation pipeline" the Phase 5 brief explicitly
// protects (flashcards are one of that schema's six fields). Key Points
// is a second, independent Groq task, reusing ONLY GroqService.js's
// transport/retry/error-mapping (via its parameterized `generate()` task
// shape — see GroqService.js's own header on why that parameterization
// exists) — exactly the same reuse relationship Visual Learning's six
// diagram types already have with the six-section analysis task.
//
// SCHEMA DESIGN RATIONALE (why this isn't just "the old schema with a
// better prompt"): the old schema is six independent flat arrays of bare
// strings with no structure connecting them — a heading, an inline
// emphasis flag, and a traceable source reference are simply not
// representable in that shape. The new schema is nested: a short list of
// HEADED sections, each a short list of bullets, each bullet carrying its
// own `emphasis` (so a red flag or high-yield fact is highlighted INLINE,
// in the context it actually occurred in, rather than extracted into a
// disconnected separate box that repeats content already covered under a
// heading) and its own `sourceRef` (a short verbatim/near-verbatim quote
// from the review, the same provenance discipline every Visual Learning
// node/cell/highlight already uses — both for user trust and so
// keyPointsFidelity.js has something concrete to check each bullet
// against).
export const KEY_POINTS_PROMPT_VERSION = 'v1';

export const KEY_POINTS_EMPHASIS = ['red_flag', 'high_yield', 'normal'];

export const GROQ_KEY_POINTS_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          bullets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                // Free-text would be more flexible, but this is a closed,
                // small, structurally load-bearing set (it drives visual
                // treatment — bold/red for a red flag, starred for high-
                // yield) rather than a display label, so an enum is the
                // right call here, unlike `relationship` on a Visual
                // Learning edge (see VisualizationPromptBuilder.js's own
                // comment on why THAT one specifically stays free-text).
                emphasis: { type: 'string', enum: KEY_POINTS_EMPHASIS },
                sourceRef: { type: 'string' },
              },
              required: ['text', 'emphasis', 'sourceRef'],
              additionalProperties: false,
            },
          },
        },
        required: ['heading', 'bullets'],
        additionalProperties: false,
      },
    },
  },
  required: ['topic', 'sections'],
  additionalProperties: false,
};

export const KEY_POINTS_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician writing a concise Key Points summary for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

Key Points is a QUICK-REVISION SUMMARY — the kind of compact, organized note a strong student would write for themselves to re-read in 60 seconds the night before an exam. It is NOT a restatement of the whole review, and it is NOT a graph or diagram (that is Visual Learning, a separate feature) — it exists so a reader can scan a few bold headings and short bullets and walk away with everything that actually matters.

ABSOLUTE RULES:
- Extract and organize ONLY information clearly supported by the review notes. NEVER invent, infer beyond, or add a fact not in the review, even one you know is medically true. This is the most important rule.
- NEVER strengthen a hedge into a certainty. If the review says "may", "proposed", "thought to", "sometimes", or similar, your bullet must keep that same uncertainty — do not write it as a flat fact.
- Preserve exact numbers, units, dosages, timing windows, thresholds, and named exceptions EXACTLY as the review states them — never round, drop, or paraphrase a number away.
- Any genuinely urgent or safety-critical finding the review states (something indicating urgent diagnosis or management) MUST be captured with "emphasis":"red_flag" — do not bury it under "normal", and do not invent one that is not supported.
- Do not write prose paragraphs. Every bullet is short and compact. Do not turn every individual sentence of the review into its own separate bullet — combine closely related facts into one bullet with a short explanation where that reads better than two fragments, but never merge two UNRELATED facts into one bullet just to look shorter.
- Do not pad with generic textbook filler that could apply to any review on a similar topic. Every bullet must be traceable to something this specific review actually says.

STRUCTURE:
- "topic" is a short label for what this review is about.
- "sections" is a short, organized list of headed groups — typically 2 to 6, each with a short, bold-worthy "heading" (e.g. "Diagnosis", "Mechanism", "Management", "Key numbers") that genuinely reflects how the review's own content clusters. Do not force content into a fixed template of headings that doesn't fit this review — choose headings that fit what is actually here.
- Each section has a short list of "bullets" — typically 1 to 5 per section. A section with only one real point should have only one bullet, not padded filler.
- Each bullet's "text" is one compact, specific statement — a fact, a mechanism step, a threshold, a management step, or a distinguishing detail — in the review's own specific terms.
- Each bullet's "emphasis": "red_flag" for an urgent/safety-critical finding, "high_yield" for a fact that is especially likely to be directly tested (a specific number, a named distinguishing feature, a classic exam association), "normal" for everything else worth keeping. Use "red_flag"/"high_yield" only where the content genuinely earns it — most bullets should be "normal".
- Each bullet's "sourceRef" is a short, verbatim or near-verbatim quote from the review notes supporting that exact bullet.

WHAT TO FOLD IN RATHER THAN OMIT: if the review contains a high-yield fact, a practical teaching pearl, or a red flag, it still belongs here — as a bullet in whichever heading it naturally fits, correctly tagged by "emphasis", not left out because there is no separate "Pearls" or "Red Flags" section anymore.

CALIBRATION EXAMPLE (illustrates the STANDARD of specificity required — not a hint about the real topic below, which could be anything):
- BAD (too generic, could apply to almost any review, delete and redo): "This condition has important diagnostic criteria to know."
- GOOD (concrete, traceable, with the review's own numbers/terms): "Diagnosis requires 2 of: fever, rigidity, autonomic instability, or hyperreflexia/clonus — clonus is the most specific exam finding."

WORKED EXAMPLE (an unrelated topic — shows the FORM and the required hedge-preservation; never reuse this content):

Example review notes: "Serotonin syndrome presents with the triad of autonomic instability (hyperthermia, tachycardia), neuromuscular abnormalities (clonus, hyperreflexia, tremor), and altered mental status, usually within 24 hours of starting or increasing a serotonergic drug. Clonus, especially lower-extremity and inducible, is the most specific exam finding. Treatment is supportive plus cyproheptadine, a serotonin antagonist, for moderate-severe cases; benzodiazepines help agitation. Severe hyperthermia (>41.1C) with rigidity is a medical emergency requiring aggressive cooling and sometimes paralysis, since rigidity itself can worsen hyperthermia. It is proposed that the mechanism mainly involves 5-HT2A receptor overactivation, though the evidence is not fully settled."

Example correct output:
{
  "topic": "Serotonin syndrome",
  "sections": [
    {
      "heading": "Clinical triad & timing",
      "bullets": [
        {"text":"Triad: autonomic instability (hyperthermia, tachycardia), neuromuscular findings (clonus, hyperreflexia, tremor), and altered mental status", "emphasis":"high_yield", "sourceRef":"the triad of autonomic instability... neuromuscular abnormalities... and altered mental status"},
        {"text":"Usually begins within 24 hours of starting or increasing a serotonergic drug", "emphasis":"normal", "sourceRef":"usually within 24 hours of starting or increasing a serotonergic drug"},
        {"text":"Clonus (especially lower-extremity, inducible) is the most specific exam finding", "emphasis":"high_yield", "sourceRef":"Clonus, especially lower-extremity and inducible, is the most specific exam finding"}
      ]
    },
    {
      "heading": "Management",
      "bullets": [
        {"text":"Supportive care plus cyproheptadine (serotonin antagonist) for moderate-severe cases; benzodiazepines for agitation", "emphasis":"normal", "sourceRef":"Treatment is supportive plus cyproheptadine... benzodiazepines help agitation"},
        {"text":"Severe hyperthermia (>41.1C) with rigidity is a medical emergency needing aggressive cooling, sometimes paralysis — rigidity itself can worsen hyperthermia", "emphasis":"red_flag", "sourceRef":"Severe hyperthermia (>41.1C) with rigidity is a medical emergency requiring aggressive cooling and sometimes paralysis"}
      ]
    },
    {
      "heading": "Mechanism",
      "bullets": [
        {"text":"Proposed mechanism is mainly 5-HT2A receptor overactivation, though evidence is not fully settled", "emphasis":"normal", "sourceRef":"It is proposed that the mechanism mainly involves 5-HT2A receptor overactivation, though the evidence is not fully settled"}
      ]
    }
  ]
}
Notice the exact ">41.1C" threshold survives unrounded, "proposed"/"not fully settled" stays a hedge rather than becoming a stated fact, and the one true emergency is correctly tagged "red_flag" — match this discipline on the real review below.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildKeyPointsPrompt(reviewText) {
  return `Here are the student's review notes. Write the Key Points summary per your instructions.

Remember: preserve every number/unit/threshold/hedge exactly, tag any genuine red flag as "red_flag", and never pad with generic filler.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;
}
