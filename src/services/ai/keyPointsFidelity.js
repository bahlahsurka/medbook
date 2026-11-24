// services/ai/keyPointsFidelity.js
//
// Phase 5: practical, cheap (no extra AI calls) source-fidelity checks for
// a generated Key Points summary against the original entry notes. Reuses
// sourceCoverage.js's pure string-matching primitives (significantWords/
// overlapRatio/splitIntoClauses/CLINICAL_SIGNAL_RE — exported additively
// from that file for exactly this reuse) rather than duplicating them, but
// does NOT touch sourceCoverage.js's own findUncoveredStatements behavior —
// this module adds its OWN checks, specific to Key Points' bullet/sourceRef
// shape and to two things Visual Learning's own coverage check doesn't
// look for: altered/unsourced NUMBERS specifically, and missing URGENT/
// safety-related language (CLINICAL_SIGNAL_RE's own word list is numeric/
// hedge/temporal, not urgency vocabulary like "hypotension" or "shock").
//
// IMPORTANT — same disclaimer every heuristic check in this app carries:
// this is keyword/number/word-overlap matching, not clinical review. It
// can miss a real discrepancy and can flag something that IS actually
// fine, just phrased differently. api/key-points.mjs always returns this
// disclaimer alongside any flagged warnings so it is never presented as a
// guarantee of accuracy.
import { significantWords, overlapRatio, splitIntoClauses, CLINICAL_SIGNAL_RE } from './sourceCoverage.js';

export const KEY_POINTS_FIDELITY_DISCLAIMER =
  'Heuristic check only (keyword, number, and word-overlap matching between the review and Key Points). It can miss real discrepancies, ' +
  'and it can flag something that IS actually represented correctly in different words. This is not a guarantee of medical accuracy or ' +
  'completeness — structural validation and text matching cannot replace clinical review. Use these as prompts to double-check, not verdicts.';

// Generic, domain-general urgency/safety vocabulary — deliberately broad
// (same "over-inclusive beats precise" philosophy sourceCoverage.js's own
// CLINICAL_SIGNAL_RE documents) and not tied to any specific topic, so it
// works the same way for a cardiology review as a dermatology one. This is
// intentionally NOT merged into CLINICAL_SIGNAL_RE itself — that would
// change Visual Learning's own already-shipped coverage-flagging behavior
// for every one of its six types, which is out of scope for this phase.
const URGENCY_RE = /\b(emergen(cy|t)|urgent(ly)?|immediately|life[- ]threatening|stat\b|critical(ly)?|hypotensi\w*|shock\b|respiratory (failure|distress|arrest)|cardiac arrest|altered mental status|anaphylax\w*|hemorrhag\w*|septic\w*)\b/i;

const NUMBER_RE = /\d+(\.\d+)?/g;

function extractNumbers(text) {
  return (String(text || '').match(NUMBER_RE) || []).map(n => n.replace(/^0+(?=\d)/, ''));
}

function allBulletTexts(keyPoints) {
  return (keyPoints?.sections || []).flatMap(s => (s.bullets || []).map(b => b.text));
}
function allBulletPairs(keyPoints) {
  return (keyPoints?.sections || []).flatMap(s => (s.bullets || []).map(b => [b.text, b.sourceRef]));
}

/**
 * Numbers that appear in a clinically-signal-bearing clause of the
 * original notes but don't appear ANYWHERE in the generated bullets —
 * "this value may not have made it into Key Points."
 */
function findMissingNumerics(notes, keyPoints) {
  const bulletNumbers = new Set(allBulletTexts(keyPoints).flatMap(extractNumbers));
  const flagged = [];
  for (const clause of splitIntoClauses(notes)) {
    if (!CLINICAL_SIGNAL_RE.test(clause)) continue;
    const nums = extractNumbers(clause);
    if (nums.length === 0) continue;
    if (nums.some(n => !bulletNumbers.has(n))) flagged.push(clause);
    if (flagged.length >= 5) break;
  }
  return flagged;
}

/**
 * Numbers that appear in a Key Points bullet but don't appear ANYWHERE in
 * the original notes — "this bullet contains a number not found in the
 * source; it may have been altered or added." A cheap proxy for a changed/
 * fabricated value, not a guarantee one way or the other.
 */
function findUnsourcedNumerics(notes, keyPoints) {
  const notesNumbers = new Set(extractNumbers(notes));
  const flagged = [];
  for (const text of allBulletTexts(keyPoints)) {
    const nums = extractNumbers(text);
    const bad = nums.filter(n => !notesNumbers.has(n));
    if (bad.length > 0) flagged.push(text);
    if (flagged.length >= 5) break;
  }
  return flagged;
}

/**
 * Urgency/safety-sounding clauses in the original notes with no word-
 * overlap match anywhere in Key Points' bullets — "a potentially urgent
 * or safety-related statement may not be reflected." This is the one
 * check specifically aimed at "important clinical findings or safety
 * warnings omitted" and "red flags must never be lost" from the brief.
 */
function findMissingUrgentFindings(notes, keyPoints, threshold = 0.3) {
  const bulletWordSets = allBulletTexts(keyPoints).map(t => significantWords(t));
  if (bulletWordSets.length === 0) return [];
  const flagged = [];
  for (const clause of splitIntoClauses(notes)) {
    if (!URGENCY_RE.test(clause)) continue;
    const clauseWords = significantWords(clause);
    const covered = bulletWordSets.some(bw => overlapRatio(clauseWords, bw) >= threshold);
    if (!covered) flagged.push(clause);
    if (flagged.length >= 5) break;
  }
  return flagged;
}

/**
 * A bullet whose OWN quoted sourceRef doesn't meaningfully word-overlap
 * the actual review notes at all — "this claim's cited source doesn't
 * look like it's really from this review," the closest cheap proxy for
 * "claims that cannot be traced back to the source."
 */
function findUnsourcedBullets(notes, keyPoints, threshold = 0.3) {
  const notesWords = significantWords(notes);
  const flagged = [];
  for (const [text, sourceRef] of allBulletPairs(keyPoints)) {
    const refWords = significantWords(sourceRef);
    if (refWords.size > 0 && overlapRatio(refWords, notesWords) < threshold) {
      flagged.push(text);
    }
    if (flagged.length >= 5) break;
  }
  return flagged;
}

/**
 * Runs every check and returns a flat, de-duplicated, capped list of
 * plain-language warnings a human can act on — never more than a handful,
 * so this stays a prompt to double-check rather than a wall of noise.
 *
 * @param {string} notes — the original, untouched entry text.
 * @param {{topic:string, sections:Array}} keyPoints — a validated Key Points object.
 * @returns {{warnings:string[], disclaimer:string}}
 */
export function checkKeyPointsFidelity(notes, keyPoints) {
  const warnings = [];

  for (const clause of findMissingUrgentFindings(notes, keyPoints)) {
    warnings.push(`A potentially urgent or safety-related statement may not be reflected in Key Points: "${clause}"`);
  }
  for (const clause of findMissingNumerics(notes, keyPoints)) {
    warnings.push(`A numeric value/threshold in the review may be missing from Key Points: "${clause}"`);
  }
  for (const text of findUnsourcedNumerics(notes, keyPoints)) {
    warnings.push(`A number in this Key Points bullet wasn't found anywhere in the original review — it may have been altered or added: "${text}"`);
  }
  for (const text of findUnsourcedBullets(notes, keyPoints)) {
    warnings.push(`This bullet's cited source doesn't clearly match the review text — it may not be well-traced: "${text}"`);
  }

  return { warnings: warnings.slice(0, 8), disclaimer: KEY_POINTS_FIDELITY_DISCLAIMER };
}
