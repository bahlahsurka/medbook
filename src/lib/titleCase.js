// lib/titleCase.js
//
// Converts an entry title to Title Case, applied once the user finishes
// typing it (onBlur, or Enter — see AddEntry.js/DetailView.js's title
// inputs), not live as they type: transforming mid-keystroke would mangle
// a word the user hasn't finished yet (e.g. catching "mRNA" partway
// through as "Mrna"). This transforms the actual title STRING (the one
// that gets saved), not a CSS-only text-transform — so a title typed here
// reads correctly cased everywhere else the saved value is shown
// (DetailView's own view mode, EntryCard, ReviewQueue, SystemReview, …)
// with no separate logic needed there.
//
// Minor words (articles/conjunctions/short prepositions) are lowercased
// UNLESS they're the first or last word — the standard title-case
// convention ("Digoxin Toxicity of the Heart", not "... Of The Heart").
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'en', 'for', 'if', 'in', 'nor',
  'of', 'on', 'or', 'per', 'so', 'the', 'to', 'v', 'vs', 'via', 'with',
]);

// Deliberately does NOT split on hyphens or apostrophes — "ST-segment"
// becomes two words ("ST", "segment") so "ST" (if typed as a real acronym)
// can be preserved independently of "segment" getting capitalized; an
// apostrophe ("Crohn's") stays part of its own word so it isn't split into
// "Crohn" + "S".
const WORD_RE = /[A-Za-z0-9']+/g;

export function toTitleCase(str) {
  if (!str) return str;
  const matches = [...str.matchAll(WORD_RE)];
  if (matches.length === 0) return str;

  // A medical note's title legitimately contains real acronyms (ECG, COPD,
  // DNA, …) that must NOT be lowercased into "Ecg"/"Copd"/"Dna". Those are
  // indistinguishable, word by word, from a title typed with caps lock on
  // by accident — so the call is made for the title AS A WHOLE: only when
  // EVERY multi-letter word is already all-caps is this treated as a
  // caps-lock accident (and title-cased normally); otherwise any all-caps
  // word is assumed to be a deliberate acronym and left untouched.
  const multiLetterWords = matches.map(m => m[0]).filter(w => /[A-Za-z]{2,}/.test(w));
  const looksLikeCapsLockAccident = multiLetterWords.length > 0
    && multiLetterWords.every(w => w === w.toUpperCase());

  const firstStart = matches[0].index;
  const lastStart = matches[matches.length - 1].index;

  return str.replace(WORD_RE, (word, offset) => {
    if (!looksLikeCapsLockAccident) {
      // Already ALL CAPS (2+ letters) — a deliberate acronym; leave as-is.
      if (word.length > 1 && word === word.toUpperCase() && /[A-Za-z]/.test(word)) return word;
      // Already capitalized somewhere past the first letter (mRNA, McDonald,
      // iPhone-style) — leave as-is rather than flatten meaningful casing.
      if (/[A-Z]/.test(word.slice(1))) return word;
    }
    const lower = word.toLowerCase();
    const isEdgeWord = offset === firstStart || offset === lastStart;
    if (!isEdgeWord && MINOR_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}
