// services/ai/VisualSummaryValidator.js
//
// Structural validation for Visual Summary. Does NOT use
// validateCommonNodes/validateCommonEdges — Visual Summary is a flat list
// of highlight cards with no edges at all (see VisualSummaryPromptBuilder.js's
// own header). Still reuses the generic stripToJson/nonEmptyString/
// VisualizationValidationError.
import { VisualizationValidationError, stripToJson, nonEmptyString } from './visualizationValidationHelpers.js';
import { VISUAL_SUMMARY_IMPORTANCE, VISUAL_SUMMARY_CATEGORIES } from './VisualSummaryPromptBuilder.js';

const IMPORTANCE_SET = new Set(VISUAL_SUMMARY_IMPORTANCE);
const CATEGORY_SET = new Set(VISUAL_SUMMARY_CATEGORIES);

export function validateVisualSummary(rawText, { allowAiContext = false } = {}) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new VisualizationValidationError('The model returned malformed JSON. Nothing was saved.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format. Nothing was saved.');
  }
  if (!nonEmptyString(obj.topic)) throw new VisualizationValidationError('The visual summary is missing its topic.');
  if (!Array.isArray(obj.highlights)) throw new VisualizationValidationError('The visual summary is missing its highlights.');
  if (obj.highlights.length === 0) throw new VisualizationValidationError('The visual summary has no highlights — nothing usable was generated.');

  const seenIds = new Set();
  const highlights = obj.highlights.map((h, i) => {
    if (!h || typeof h !== 'object') throw new VisualizationValidationError(`Highlight at index ${i} is malformed.`);
    const { id, headline, detail, importance, category, sourceType, sourceRef } = h;
    if (!nonEmptyString(id)) throw new VisualizationValidationError(`Highlight at index ${i} is missing a valid id.`);
    if (seenIds.has(id)) throw new VisualizationValidationError(`Duplicate highlight id "${id}".`);
    seenIds.add(id);
    if (!nonEmptyString(headline)) throw new VisualizationValidationError(`Highlight "${id}" is missing a headline.`);
    if (!nonEmptyString(detail)) throw new VisualizationValidationError(`Highlight "${id}" is missing a detail sentence.`);
    if (!IMPORTANCE_SET.has(importance)) throw new VisualizationValidationError(`Highlight "${id}" has an unrecognized importance "${importance}".`);
    if (!CATEGORY_SET.has(category)) throw new VisualizationValidationError(`Highlight "${id}" has an unrecognized category "${category}".`);
    if (sourceType !== 'entry' && sourceType !== 'ai_context') {
      throw new VisualizationValidationError(`Highlight "${id}" has an unrecognized source classification "${sourceType}".`);
    }
    if (!nonEmptyString(sourceRef)) throw new VisualizationValidationError(`Highlight "${id}" is missing its supporting source reference.`);
    if (sourceType === 'ai_context' && !allowAiContext) {
      throw new VisualizationValidationError(`Highlight "${id}" is marked as additional AI context, but no additional context was requested for this generation.`);
    }
    return {
      id: id.trim(), headline: headline.trim(), detail: detail.trim(),
      importance, category, sourceType, sourceRef: sourceRef.trim(),
    };
  });

  return { topic: obj.topic.trim(), highlights };
}
