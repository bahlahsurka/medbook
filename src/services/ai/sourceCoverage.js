// services/ai/sourceCoverage.js
//
// A heuristic, best-effort check: does every clinically-meaningful-looking
// statement in the ORIGINAL entry notes have SOME word overlap with
// something in the generated diagram? It cannot know whether a statement
// is actually represented in different words, and it cannot know whether
// the diagram is medically correct — it only measures vocabulary overlap.
// See SOURCE_COVERAGE_DISCLAIMER below, which api/visualize.mjs always
// returns alongside any flagged statements so this is never presented as
// a completeness guarantee.
//
// Exists because "the visualization loses important details" (a timing
// window, a dose, a hedge like 'proposed'/'used with some success') is
// exactly the failure mode real testing surfaced, and a prompt instruction
// alone is advisory — this is a second, independent, programmatic signal
// a human can act on, the same spirit as VisualizationValidator.js's
// structural checks but for CONTENT coverage instead of shape.

export const SOURCE_COVERAGE_DISCLAIMER =
  'Heuristic check only (keyword + word-overlap matching between the review and the diagram). It can miss real gaps, and it can flag ' +
  'something that IS actually represented in different words. This is not a guarantee of medical completeness or correctness — use it ' +
  'as a prompt to double-check, not as a verdict.';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were',
  'be', 'been', 'this', 'that', 'it', 'as', 'by', 'at', 'from', 'has', 'have', 'had', 'not', 'but',
  'if', 'than', 'then', 'into', 'their', 'its', 'also', 'can', 'will', 'such', 'these', 'those',
]);

// Deliberately broad and over-inclusive rather than precise — a false
// positive here just means one extra clause a human glances at and
// dismisses; a false negative means a real gap goes unflagged, which is
// the worse failure for a safety-adjacent check like this one. Covers
// three rough categories: numeric/dosage/timing values and units, explicit
// temporal framing ("starting at", "until"), and hedge/qualifier language
// ("proposed", "used with some success") — exactly the kind of detail the
// real-world testing that motivated this module found going missing.
const CLINICAL_SIGNAL_RE = new RegExp(
  '\\b\\d+(\\.\\d+)?\\s*(mg|mcg|g|kg|mmol|meq|mmhg|%|percent|weeks?|wk|days?|hours?|hr|months?|years?|ml|l|units?)\\b' +
  '|\\b(until|starting|start(ed|ing)?|before|after|history\\s+of|risk\\s+(for|of)|contraindicat\\w*' +
  '|should\\s+not|avoid|unless|except|proposed|suggests?|thought\\s+to|believed|may\\b|sometimes' +
  '|usually|often|typically|some\\s+success|modest|efficacy|effective|ineffective|benefit|inconsistent|inhibit\\w*)\\b',
  'i'
);

// Exported (Phase 5) purely so keyPointsFidelity.js can reuse these exact
// string-matching primitives for Key Points' own fidelity checks without
// duplicating them — a pure, additive export with zero change to any
// existing behavior or caller here. CLINICAL_SIGNAL_RE/splitIntoClauses/
// significantWords/overlapRatio are unchanged; findUncoveredStatements
// below still behaves identically for every Visual Learning caller.
export function splitIntoClauses(text) {
  return String(text || '')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 12); // skip fragments too short to be a standalone statement
}

export function significantWords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(words.filter(w => w.length > 2 && !STOPWORDS.has(w)));
}

export function overlapRatio(clauseWords, nodeWords) {
  if (clauseWords.size === 0) return 0;
  let hits = 0;
  for (const w of clauseWords) if (nodeWords.has(w)) hits++;
  return hits / clauseWords.size;
}

export { CLINICAL_SIGNAL_RE };

// Default extractor: the {nodes:[{explanation,sourceRef}]} shape Mind Map,
// Knowledge Network, Clinical Flowchart, and Mechanism Diagram all share.
// Comparison Map and Visual Summary have genuinely different shapes (a
// table, a flat highlight list) — api/visualize.mjs passes its own
// `extractPairs` for those instead of forcing them into this shape.
function defaultExtractPairs(diagram) {
  return (diagram?.nodes || []).map(n => [n.explanation, n.sourceRef]);
}

/**
 * @param {string} notes — the original, untouched entry text.
 * @param {object} diagram — a validated diagram of ANY visualization type.
 * @param {{threshold?:number, extractPairs?:(diagram)=>Array<[string,string]>}} [options]
 *   `threshold` (default 0.35): minimum word-overlap ratio against some
 *   pair's combined text for a clause to count as "represented". Loose on
 *   purpose — see this module's own header. `extractPairs`: pulls
 *   [explanation-like, sourceRef-like] text pairs out of a diagram shape
 *   other than the default {nodes:[...]} one — see comparisonMapValidator.js/
 *   visualSummaryValidator.js's own callers for the two cases that need this.
 * @returns {string[]} up to 8 clauses from `notes` that look clinically
 *   meaningful and don't clear the overlap threshold against any pair.
 */
export function findUncoveredStatements(notes, diagram, options = {}) {
  const threshold = options.threshold ?? 0.35;
  const extractPairs = options.extractPairs || defaultExtractPairs;

  const pairWordSets = extractPairs(diagram).map(([a, b]) => significantWords(`${a || ''} ${b || ''}`));
  if (pairWordSets.length === 0) return [];

  const flagged = [];
  for (const clause of splitIntoClauses(notes)) {
    if (!CLINICAL_SIGNAL_RE.test(clause)) continue;
    const clauseWords = significantWords(clause);
    const covered = pairWordSets.some(pw => overlapRatio(clauseWords, pw) >= threshold);
    if (!covered) flagged.push(clause);
    if (flagged.length >= 8) break; // a long, cluttered list stops being useful to a human
  }
  return flagged;
}
