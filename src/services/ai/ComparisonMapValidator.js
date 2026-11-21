// services/ai/ComparisonMapValidator.js
//
// Structural validation for Comparison Map. Does NOT use
// validateCommonNodes/validateCommonEdges from visualizationValidationHelpers.js
// — those assume the shared {id,label,explanation,category,sourceType,
// sourceRef} node + {source,target,relationship,label} edge shape every
// graph-based Phase 3 type uses, and Comparison Map is deliberately NOT a
// graph (see ComparisonMapPromptBuilder.js's own header). Still reuses the
// generic stripToJson/nonEmptyString/VisualizationValidationError.
import { VisualizationValidationError, stripToJson, nonEmptyString } from './visualizationValidationHelpers.js';

function validateSourceFields(obj, label, ErrorCtor, allowAiContext) {
  // 'user_added' (Phase 4) is never something Groq produces, but this
  // validator also re-validates a user's edited grid before saving it
  // (api/visualize-edit.mjs) — a subject/cell the user typed in directly
  // needs its own honest classification.
  if (obj.sourceType !== 'entry' && obj.sourceType !== 'ai_context' && obj.sourceType !== 'user_added') {
    throw new ErrorCtor(`${label} has an unrecognized source classification "${obj.sourceType}".`);
  }
  if (!nonEmptyString(obj.sourceRef)) throw new ErrorCtor(`${label} is missing its supporting source reference.`);
  if (obj.sourceType === 'ai_context' && !allowAiContext) {
    throw new ErrorCtor(`${label} is marked as additional AI context, but no additional context was requested for this generation.`);
  }
}

export function validateComparisonMap(rawText, { allowAiContext = false } = {}) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new VisualizationValidationError('The model returned nothing usable.');

  let obj;
  try { obj = JSON.parse(jsonText); }
  catch { throw new VisualizationValidationError('The model returned malformed JSON. Nothing was saved.'); }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new VisualizationValidationError('The model returned an unexpected format. Nothing was saved.');
  }
  if (!nonEmptyString(obj.topic)) throw new VisualizationValidationError('The comparison map is missing its topic.');
  if (!Array.isArray(obj.subjects) || !Array.isArray(obj.dimensions) || !Array.isArray(obj.cells)) {
    throw new VisualizationValidationError('The comparison map is missing its subjects, dimensions, or cells.');
  }
  if (obj.subjects.length < 2) {
    throw new VisualizationValidationError(`A comparison needs at least two subjects (found ${obj.subjects.length}).`);
  }
  if (obj.dimensions.length === 0) {
    throw new VisualizationValidationError('The comparison map has no dimensions — nothing usable was generated.');
  }

  const subjectIds = new Set();
  const subjects = obj.subjects.map((s, i) => {
    if (!s || typeof s !== 'object') throw new VisualizationValidationError(`Subject at index ${i} is malformed.`);
    const { id, label } = s;
    if (!nonEmptyString(id)) throw new VisualizationValidationError(`Subject at index ${i} is missing a valid id.`);
    if (subjectIds.has(id)) throw new VisualizationValidationError(`Duplicate subject id "${id}".`);
    subjectIds.add(id);
    if (!nonEmptyString(label)) throw new VisualizationValidationError(`Subject "${id}" is missing a label.`);
    validateSourceFields(s, `Subject "${id}"`, VisualizationValidationError, allowAiContext);
    return { id: id.trim(), label: label.trim(), sourceType: s.sourceType, sourceRef: s.sourceRef.trim() };
  });

  const dimensionIds = new Set();
  const dimensions = obj.dimensions.map((d, i) => {
    if (!d || typeof d !== 'object') throw new VisualizationValidationError(`Dimension at index ${i} is malformed.`);
    const { id, label } = d;
    if (!nonEmptyString(id)) throw new VisualizationValidationError(`Dimension at index ${i} is missing a valid id.`);
    if (dimensionIds.has(id)) throw new VisualizationValidationError(`Duplicate dimension id "${id}".`);
    dimensionIds.add(id);
    if (!nonEmptyString(label)) throw new VisualizationValidationError(`Dimension "${id}" is missing a label.`);
    return { id: id.trim(), label: label.trim() };
  });

  const seenPairs = new Set();
  const touchedSubjects = new Set();
  const touchedDimensions = new Set();
  const cells = obj.cells.map((c, i) => {
    if (!c || typeof c !== 'object') throw new VisualizationValidationError(`Cell at index ${i} is malformed.`);
    const { subjectId, dimensionId, value, distinguishing } = c;
    if (!subjectIds.has(subjectId)) throw new VisualizationValidationError(`Cell at index ${i} references nonexistent subject "${subjectId}".`);
    if (!dimensionIds.has(dimensionId)) throw new VisualizationValidationError(`Cell at index ${i} references nonexistent dimension "${dimensionId}".`);
    const pairKey = `${subjectId}\u0000${dimensionId}`;
    if (seenPairs.has(pairKey)) {
      throw new VisualizationValidationError(`Duplicate cell for subject "${subjectId}" and dimension "${dimensionId}".`);
    }
    seenPairs.add(pairKey);
    if (!nonEmptyString(value)) throw new VisualizationValidationError(`Cell for subject "${subjectId}"/dimension "${dimensionId}" is missing a value.`);
    if (typeof distinguishing !== 'boolean') {
      throw new VisualizationValidationError(`Cell for subject "${subjectId}"/dimension "${dimensionId}" has an invalid "distinguishing" flag.`);
    }
    validateSourceFields(c, `Cell for subject "${subjectId}"/dimension "${dimensionId}"`, VisualizationValidationError, allowAiContext);
    touchedSubjects.add(subjectId);
    touchedDimensions.add(dimensionId);
    return {
      subjectId, dimensionId, value: value.trim(), distinguishing,
      sourceType: c.sourceType, sourceRef: c.sourceRef.trim(),
    };
  });

  if (cells.length === 0) throw new VisualizationValidationError('The comparison map has no cells — nothing usable was generated.');

  const unaddressedSubject = subjects.find(s => !touchedSubjects.has(s.id));
  if (unaddressedSubject) {
    throw new VisualizationValidationError(`Subject "${unaddressedSubject.id}" has no cells comparing it on any dimension.`);
  }
  const unaddressedDimension = dimensions.find(d => !touchedDimensions.has(d.id));
  if (unaddressedDimension) {
    throw new VisualizationValidationError(`Dimension "${unaddressedDimension.id}" has no cells for any subject.`);
  }

  return { topic: obj.topic.trim(), subjects, dimensions, cells };
}
