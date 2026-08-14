// lib/importedDecks/templateRender.js
//
// Pure, framework-free Anki template substitution — shared by all three
// CardType renderers (Phase J), not a generic front/back renderer itself.
// The type-specific behavior (which field masks as the answer, how cloze
// deletions work) lives in CardRenderer.js; this module only knows how to
// fill in {{FieldName}} placeholders and handle Anki's cloze/conditional
// syntax, which is genuinely shared machinery across Basic, Cloze, and
// Image Occlusion note types in real Anki too.

/** {{FieldName}} → the field's HTML value. {{FrontSide}} is substituted by the caller. */
export function renderTemplate(template, fields) {
  if (!template) return '';
  let out = template;

  // Conditional sections: {{#Field}}...{{/Field}} shows only if Field is
  // non-empty; {{^Field}}...{{/Field}} shows only if Field IS empty.
  // Common in real Anki templates (e.g. optional "Extra" sections).
  out = out.replace(/\{\{#(\w[\w\d :]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, inner) =>
    (fields[name.trim()] || '').trim() ? inner : '');
  out = out.replace(/\{\{\^(\w[\w\d :]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, inner) =>
    (fields[name.trim()] || '').trim() ? '' : inner);

  // Plain field references, including the {{cloze:Field}} form (cloze
  // handling itself happens before this call — by the time this runs,
  // "cloze:Text" already resolves to the Text field's masked/revealed HTML).
  out = out.replace(/\{\{([\w\d :]+)\}\}/g, (_, name) => {
    const key = name.trim();
    if (key.startsWith('cloze:')) return fields[key.slice(6).trim()] ?? '';
    if (key.startsWith('type:')) return ''; // {{type:Field}} needs live user input — not supported (documented gap)
    return fields[key] ?? '';
  });

  return out;
}

const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

/**
 * Renders one note's Text field for cloze card #ord (0-indexed template_ord
 * -> Anki cloze number ord+1). Every {{cN::...}} with matching N is
 * masked/revealed together (real Anki behavior: one cloze number can
 * appear multiple times in the same field and all instances move as one).
 * {{cN::...}} for OTHER cloze numbers always shows its answer text plainly
 * — it belongs to a different card, not this one.
 */
export function renderCloze(text, ord, revealed) {
  const targetN = ord + 1;
  return String(text || '').replace(CLOZE_RE, (_, nStr, answer, hint) => {
    const n = parseInt(nStr, 10);
    if (n !== targetN) return answer; // a different cloze card's blank — always shown
    if (revealed) {
      return `<span class="cloze-reveal">${answer}</span>`;
    }
    const label = hint ? `[${hint}]` : '[...]';
    return `<span class="cloze-blank">${label}</span>`;
  });
}

/** How many distinct cloze numbers a Text field defines — used to build one card per cloze number. */
export function countClozes(text) {
  const seen = new Set();
  let m;
  const re = new RegExp(CLOZE_RE);
  while ((m = re.exec(text || ''))) seen.add(m[1]);
  return seen.size;
}

const IMG_RE = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SOUND_RE = /\[sound:([^\]]+)\]/gi;

/**
 * Substitutes Anki media references with resolved URLs (Phase J3/J4).
 * resolvedMap is exactly MediaService.resolveMany()'s shape: filename -> url|null.
 * A null/missing entry degrades gracefully (Phase J4) rather than leaving a
 * broken reference or crashing the card.
 */
export function substituteMedia(html, resolvedMap) {
  let out = String(html || '');

  out = out.replace(IMG_RE, (full, src) => {
    const url = resolvedMap[src];
    if (url) return full.replace(src, url);
    return `<span class="media-missing" title="${escapeAttr(src)}">🖼 image unavailable</span>`;
  });

  out = out.replace(SOUND_RE, (_, filename) => {
    const url = resolvedMap[filename];
    if (url) return `<audio controls src="${url}" style="max-width:100%;height:32px;"></audio>`;
    return `<span class="media-missing" title="${escapeAttr(filename)}">🔊 audio unavailable</span>`;
  });

  return out;
}

/** Every filename an HTML fragment references — feeds resolveMany(). */
export function extractMediaFilenames(html) {
  const names = new Set();
  let m;
  const imgRe = new RegExp(IMG_RE);
  while ((m = imgRe.exec(html || ''))) names.add(m[1]);
  const sndRe = new RegExp(SOUND_RE);
  while ((m = sndRe.exec(html || ''))) names.add(m[1]);
  return [...names];
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
