// services/ai/ResponseParser.js
//
// Turns Gemini's raw text into trustworthy application data — or throws.
// It never returns a partial/garbled object, because callers write the result
// straight to the database and a half-parsed blob would corrupt an entry.

import { LIMITS } from './PromptBuilder';

export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

export const SECTION_KEYS = [
  'keyLearningPoints',
  'highYield',
  'clinicalPearls',
  'redFlags',
  'relatedTopics',
  'flashcards',
];

/** An all-empty result — a valid, meaningful outcome ("nothing was supported"). */
export function emptySections() {
  return {
    keyLearningPoints: [],
    highYield: [],
    clinicalPearls: [],
    redFlags: [],
    relatedTopics: [],
    flashcards: [],
  };
}

/**
 * Models sometimes wrap JSON in markdown fences or add a stray sentence,
 * even when asked not to. Strip that before parsing.
 */
function stripToJson(raw) {
  let s = String(raw || '').trim();

  // ```json … ``` or ``` … ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  // Fall back to the outermost { … } if there's leading/trailing chatter.
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
  }
  return s.trim();
}

/** Coerce to a clean array of non-empty strings, capped at `max`. */
function toStringList(value, max) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : v == null ? '' : String(v)))
    .map(v => v.replace(/^[-•*]\s*/, '').trim()) // drop stray bullet chars
    .filter(v => v.length > 0)
    .slice(0, max);
}

/** Flashcards must be {front, back} pairs with both sides present. */
function toFlashcards(value, max) {
  if (!Array.isArray(value)) return [];
  return value
    .map(c => ({
      front: typeof c?.front === 'string' ? c.front.trim() : '',
      back: typeof c?.back === 'string' ? c.back.trim() : '',
    }))
    .filter(c => c.front && c.back)
    .slice(0, max);
}

/**
 * Parse + validate. Throws ParseError on anything unusable so the caller can
 * show an error and leave the saved entry untouched.
 */
export function parseAnalysis(rawText) {
  const jsonText = stripToJson(rawText);
  if (!jsonText) throw new ParseError('Gemini returned nothing usable.');

  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    throw new ParseError('Gemini returned malformed JSON. Nothing was saved — try Analyze again.');
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ParseError('Gemini returned an unexpected format. Nothing was saved.');
  }

  // At least one known section must be present, otherwise this isn't our shape
  // at all (and silently returning six empty arrays would be misleading).
  const hasAnyKey = SECTION_KEYS.some(k => k in obj);
  if (!hasAnyKey) {
    throw new ParseError('Gemini\'s response did not contain any expected sections. Nothing was saved.');
  }

  return {
    keyLearningPoints: toStringList(obj.keyLearningPoints, LIMITS.keyLearningPoints),
    highYield:         toStringList(obj.highYield,         LIMITS.highYield),
    clinicalPearls:    toStringList(obj.clinicalPearls,    LIMITS.clinicalPearls),
    redFlags:          toStringList(obj.redFlags,          LIMITS.redFlags),
    relatedTopics:     toStringList(obj.relatedTopics,     LIMITS.relatedTopics),
    flashcards:        toFlashcards(obj.flashcards,        LIMITS.flashcards),
  };
}

/** True if every section came back empty (valid, but worth telling the user). */
export function isAllEmpty(sections) {
  if (!sections) return true;
  return SECTION_KEYS.every(k => !Array.isArray(sections[k]) || sections[k].length === 0);
}

/** Normalise anything loaded from the DB, so old/partial rows can't crash the UI. */
export function normalizeSections(stored) {
  const base = emptySections();
  if (!stored || typeof stored !== 'object') return base;
  return {
    keyLearningPoints: toStringList(stored.keyLearningPoints, LIMITS.keyLearningPoints),
    highYield:         toStringList(stored.highYield,         LIMITS.highYield),
    clinicalPearls:    toStringList(stored.clinicalPearls,    LIMITS.clinicalPearls),
    redFlags:          toStringList(stored.redFlags,          LIMITS.redFlags),
    relatedTopics:     toStringList(stored.relatedTopics,     LIMITS.relatedTopics),
    flashcards:        toFlashcards(stored.flashcards,        LIMITS.flashcards),
  };
}
