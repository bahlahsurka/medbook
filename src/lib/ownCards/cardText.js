// lib/ownCards/cardText.js
//
// Engram Stage 2 item 6 — "Cloze ({{c1::…}}) and images render correctly
// in My Cards study and list... Coordinate with CLAUDE_CODE_AI_ANALYZE_V2.md
// part B — one shared renderer and one shared duplicate check, not two."
//
// That doc does not exist anywhere in this repository (checked at the
// start of this stage: no file, no reference, nothing to coordinate
// against). Rather than block on it or invent a second, parallel
// implementation that would need reconciling later, this reuses the
// ALREADY-shared cloze engine (lib/importedDecks/templateRender.js's
// renderCloze — extended with an `ord === null` mode, see its own
// comment) as the one cloze renderer for both areas, and keeps this
// file's own job narrowly to the part that genuinely differs: `flashcards`
// rows are plain question/answer TEXT, never an Anki note+model, so there
// is no existing HTML-safe rendering path for them at all today (the
// current UI renders question/answer as a plain React text child — safe,
// but also why literal "{{c1::...}}" syntax or a pasted image URL show
// as ugly raw text instead of rendering). If a real "AI Analyze V2" shared
// renderer doc/module appears later, this is the one place My Cards would
// need to repoint at it.
//
// SECURITY: the raw text is HTML-escaped FIRST, before anything else runs.
// Only the markup THIS module deliberately generates afterward (cloze
// spans, recognized image tags) is ever real HTML — arbitrary text the
// user typed, even something that looks like a tag, can never execute or
// render as anything other than the literal characters they typed. This
// is the same trust level the rest of the app already gives a user's own
// authored content (DetailView.js's entry body uses
// dangerouslySetInnerHTML the same way) — not a new, looser model.

import { renderCloze } from '../importedDecks/templateRender';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Bare image URLs typed/pasted directly into a question or answer — the
// one realistic way an image reference can end up in a `flashcards` row
// today, since My Cards has no media-upload pipeline of its own (unlike
// Imported Decks' Anki media, or entries' own `images` array). Matched
// AFTER escaping, so this only ever recognizes a real http(s) URL the
// user actually typed, never something assembled from escaped fragments.
const IMAGE_URL_RE = /https?:\/\/[^\s<>"]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s<>"]*)?/gi;

function renderImageUrls(escapedText) {
  return escapedText.replace(IMAGE_URL_RE, (url) =>
    `<img src="${url}" alt="" style="max-width:100%;border-radius:6px;display:block;margin:6px 0;" />`);
}

/**
 * Renders one side's text (question or answer) of a My Cards flashcard —
 * escape, then recognized images, then cloze. `revealed` controls the
 * cloze mask exactly like the imported side does: unrevealed shows
 * "[...]" (or "[hint]"), revealed shows the real text, highlighted.
 * Caller wraps the result in an element with `white-space: pre-wrap` (no
 * <br/> conversion here) so plain line breaks the user typed still show.
 */
export function renderOwnCardText(text, revealed) {
  const escaped = escapeHtml(text);
  const withImages = renderImageUrls(escaped);
  return renderCloze(withImages, null, revealed);
}

const CLOZE_STRIP_RE = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/g;

/**
 * Plain-text preview for a compact LIST row (folder card list) — same
 * spirit as BrowseDeck/FavoritesScreen's own `stripHtml` snippet
 * convention for Imported Decks' compact rows (strip markup down to
 * readable text, don't actually render it), rather than rendering real
 * HTML/images into a 2-line-clamped row where an inline `<img>` would
 * fight the clamp. Cloze syntax resolves to its plain answer text (no
 * mask, no span — you already own this card, blanking it in your own
 * management list would just look broken); a bare image URL collapses to
 * a small camera glyph. Returns plain text, safe as an ordinary React
 * text child — no HTML, no dangerouslySetInnerHTML needed here.
 */
export function stripOwnCardSyntax(text) {
  return String(text || '')
    .replace(CLOZE_STRIP_RE, (_, answer) => answer)
    .replace(IMAGE_URL_RE, '📷');
}

/** Whether a flashcard's text actually uses cloze syntax — StudySession
 *  needs this to know whether showing an unrevealed QUESTION should even
 *  bother with the mask pass (and, more importantly, whether a question
 *  with ONLY cloze content would otherwise render as an empty-looking
 *  wall of "[...]"  — not handled specially today, just exposed for a
 *  future caller that wants to know). */
export function hasCloze(text) {
  return /\{\{c\d+::/.test(String(text || ''));
}

// ─── Duplicate warning (Stage 2 item 6) ────────────────────────────────
//
// "Warn, never block" — approximate on purpose. Normalizes whitespace/
// case/punctuation and looks for an existing card whose question is
// either an exact normalized match or near-identical (one fully contains
// the other, and they're close enough in length that it's very unlikely
// to be a coincidence) — catches the common real case (resaving the same
// question with a trailing "?" or a typo fix) without the complexity of
// real fuzzy-matching for a feature that must never block saving anyway.
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Returns the first existing card judged a likely duplicate of
 * `question`, or null. `excludeId` lets the Edit form check against every
 * OTHER card without flagging itself.
 */
export function findSimilarCard(question, existingCards, excludeId) {
  const norm = normalize(question);
  if (!norm) return null;
  for (const c of existingCards || []) {
    if (excludeId != null && c.id === excludeId) continue;
    const cNorm = normalize(c.question);
    if (!cNorm) continue;
    if (cNorm === norm) return c;
    const [shorter, longer] = cNorm.length <= norm.length ? [cNorm, norm] : [norm, cNorm];
    if (shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.85) return c;
  }
  return null;
}
