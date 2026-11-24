// services/ai/KeyPointsValidator.js
//
// Structural validation for Key Points — mirrors the exact discipline
// every Visual Learning validator already established (VisualizationValidator.js,
// KnowledgeNetworkValidator.js, etc.): parse, check required fields/enums,
// normalize, throw a typed error on anything unusable so a caller never
// writes a partial/garbled object to entries.ai_sections. A dedicated
// error class rather than reusing VisualizationValidationError — Key
// Points is not a visualization, and that class's `kind` is hardcoded to
// 'invalid_diagram', which would be a misleading label here.
//
// IMPORTANT — same disclaimer every structural validator in this app
// carries: this checks SHAPE (required fields present, emphasis is a
// real enum value, every bullet has a traceable-looking sourceRef) — it
// has no way to confirm the content is medically accurate. That is what
// keyPointsFidelity.js's heuristic checks are for, and even those are
// explicitly disclaimed as text-matching, not clinical review.
import { KEY_POINTS_EMPHASIS } from './KeyPointsPromptBuilder.js';

export class KeyPointsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeyPointsValidationError';
    this.kind = 'invalid_key_points';
  }
}

const EMPHASIS_SET = new Set(KEY_POINTS_EMPHASIS);

function stripToJson(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
  }
  return s.trim();
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Parse + structurally validate a Key Points response. Throws
 * KeyPointsValidationError on anything unusable.
 *
 * @param {string} rawText — raw Groq completion text.
 * @returns {{topic:string, sections:Array<{heading:string, bullets:Array<{text:string, emphasis:string, sourceRef:string}>}>}}
 */
export function validateKeyPoints(rawText) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new KeyPointsValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new KeyPointsValidationError('The model returned malformed JSON. Nothing was saved.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new KeyPointsValidationError('The model returned an unexpected format. Nothing was saved.');
  }
  if (!nonEmptyString(obj.topic)) throw new KeyPointsValidationError('Key Points is missing its topic.');
  if (!Array.isArray(obj.sections)) throw new KeyPointsValidationError('Key Points is missing its sections.');
  if (obj.sections.length === 0) throw new KeyPointsValidationError('Key Points has no sections — nothing usable was generated.');

  let totalBullets = 0;
  const sections = obj.sections.map((s, i) => {
    if (!s || typeof s !== 'object') throw new KeyPointsValidationError(`Section at index ${i} is malformed.`);
    if (!nonEmptyString(s.heading)) throw new KeyPointsValidationError(`Section at index ${i} is missing a heading.`);
    if (!Array.isArray(s.bullets) || s.bullets.length === 0) {
      throw new KeyPointsValidationError(`Section "${s.heading}" has no bullets.`);
    }
    const bullets = s.bullets.map((b, j) => {
      if (!b || typeof b !== 'object') throw new KeyPointsValidationError(`Bullet at index ${j} in section "${s.heading}" is malformed.`);
      if (!nonEmptyString(b.text)) throw new KeyPointsValidationError(`A bullet in section "${s.heading}" is missing its text.`);
      if (!EMPHASIS_SET.has(b.emphasis)) {
        throw new KeyPointsValidationError(`A bullet in section "${s.heading}" has an unrecognized emphasis "${b.emphasis}".`);
      }
      if (!nonEmptyString(b.sourceRef)) {
        throw new KeyPointsValidationError(`A bullet in section "${s.heading}" is missing its supporting source reference.`);
      }
      return { text: b.text.trim(), emphasis: b.emphasis, sourceRef: b.sourceRef.trim() };
    });
    totalBullets += bullets.length;
    return { heading: s.heading.trim(), bullets };
  });

  if (totalBullets === 0) throw new KeyPointsValidationError('Key Points has no bullets — nothing usable was generated.');

  return { topic: obj.topic.trim(), sections };
}
