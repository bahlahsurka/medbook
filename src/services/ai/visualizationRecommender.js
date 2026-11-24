// services/ai/visualizationRecommender.js
//
// Prompt + schema + validator for the optional "Recommend" feature — a
// SEPARATE, lightweight classification request (never a diagram itself)
// that suggests which of the six Visual Learning types best fit an
// entry's Review content. Deliberately its own tiny module rather than
// folded into any one visualization type's own prompt builder: this is a
// different kind of Groq call (classify, not generate-and-structure) with
// its own small schema, and keeping it separate means it can be deleted or
// changed without touching any of the six real generators.
import { SUPPORTED_VIZ_TYPES } from './visualizationRegistry.js';
import { VisualizationValidationError, stripToJson, nonEmptyString } from './visualizationValidationHelpers.js';

const VIZ_TYPE_SET = new Set(SUPPORTED_VIZ_TYPES);

export const GROQ_RECOMMEND_SCHEMA = {
  type: 'object',
  properties: {
    recommended: { type: 'array', items: { type: 'string', enum: SUPPORTED_VIZ_TYPES } },
    rationale: { type: 'string' },
  },
  required: ['recommended', 'rationale'],
  additionalProperties: false,
};

export const RECOMMEND_SYSTEM_INSTRUCTION = `You are helping a medical student pick which of six visual study-diagram formats would best organize their own written review notes. You are NOT building a diagram — only recommending which format(s) fit.

THE SIX FORMATS:
- "mind_map": a central topic with branching subtopics — best for a single self-contained topic with several related facts/categories hanging off it.
- "knowledge_network": a web of interconnected concepts with multiple kinds of relationships — best when the review discusses several concepts that cross-link to EACH OTHER, not just to one central topic.
- "clinical_flowchart": a sequence of clinical decisions with branches — best when the review describes a step-by-step workup/management pathway with decision points.
- "mechanism_diagram": a cause -> mechanism -> consequence chain — best when the review explains HOW/WHY something happens (pathophysiology), not just what to do about it.
- "comparison_map": a subject x feature grid — best when the review explicitly compares two or more conditions/drugs/treatments against each other.
- "visual_summary": a compact prioritized highlight list — best for a short review, or as a safe general-purpose fallback when nothing else clearly fits better.

RULES:
- Recommend 1 to 3 formats, ordered best-fit first — most reviews genuinely fit well in only one or two formats; do not pad the list.
- Only recommend "clinical_flowchart" if the review actually describes a decision sequence with branches, and only recommend "comparison_map" if it actually compares two or more things.
- "rationale" is one short sentence explaining the TOP recommendation's fit — plain language, no jargon about the formats themselves.
- Base this purely on the review's own content and structure, not on what would look most impressive.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildRecommendPrompt(reviewText) {
  return `Here are the student's review notes. Recommend which visualization format(s) fit best.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;
}

export function validateRecommendation(rawText) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new VisualizationValidationError('The model returned malformed JSON.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format.');
  }
  if (!Array.isArray(obj.recommended) || obj.recommended.length === 0) {
    throw new VisualizationValidationError('The model recommended nothing.');
  }
  if (!nonEmptyString(obj.rationale)) throw new VisualizationValidationError('The recommendation is missing a rationale.');

  const seen = new Set();
  const recommended = [];
  for (const type of obj.recommended) {
    if (!VIZ_TYPE_SET.has(type)) throw new VisualizationValidationError(`Unrecognized recommended type "${type}".`);
    if (seen.has(type)) continue; // dedupe rather than reject — harmless model redundancy
    seen.add(type);
    recommended.push(type);
    if (recommended.length >= 3) break; // never surface more than 3, even if the model over-produced
  }

  return { recommended, rationale: obj.rationale.trim() };
}
