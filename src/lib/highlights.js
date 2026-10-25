// Splits text containing bold/italic/size markers (written by
// lib/bulletList.js's rich-paste handler, never by hand-typed notes unless
// the user types the markers themselves — which renders the same way, same
// as any markdown tool) into runs of {t, bold, italic, size, start}. size is
// null or one of 'sm'/'lg'/'xl'. This is the ONE place that parses markers —
// buildFormattedParts below (used everywhere formatting and a highlight
// colour need to compose together — see RichRuns.js and markedTextToHtml)
// always calls this on the FULL text first, then slices its runs by
// highlight boundaries, never the other way around (slicing text by
// highlight boundary BEFORE parsing markers can cut a **bold**/{{i}}…{{/i}}
// run's opening and closing tokens into two independently-parsed strings —
// see that function's own comment for the corruption that caused).
//
// `start` is the run's own offset into the exact string passed in — not a
// separately-recomputed position, just `last` (where the previous token
// left off) at the moment each run is pushed, which is already,
// unavoidably, that run's position in the untouched input. DetailView.js's
// view-mode highlight capture (readSelection) uses this (added to the
// enclosing buildFormattedParts part's own `start`) to map a selection
// in the RENDERED, marker-stripped DOM back to the matching offset in the
// RAW stored string — see the data-raw-start annotation in RichRuns.js.
// Reusing this file's own parse position, rather than a second pass that
// re-derives "where markers were" by walking the rendered DOM, is what
// keeps that mapping structurally unable to drift from this parser: there
// is only one piece of code that knows where a marker sits in the raw
// string, and both the renderer and the selection-capture read it.
//
// Each marker toggles (bold, italic) or sets/clears (size) its own
// independent flag as it's scanned, rather than building a nested tree —
// so a run's active formatting is always the union of whatever markers
// are currently open, regardless of the order they were nested in by the
// source HTML. That's sufficient for rendering (multiple attributes just
// become multiple style props on the same run) and avoids needing to
// resolve crossing/overlapping tags, which bulletList.js's encoder never
// produces anyway (its markers always nest cleanly, mirroring the DOM).
const RICH_TOKEN_RE = /\*\*|\{\{(\/?)(i|sm|lg|xl)\}\}/g;
export function splitRich(text) {
  if (!text) return [];
  const out = [];
  let bold = false, italic = false, size = null;
  let last = 0;
  let m;
  RICH_TOKEN_RE.lastIndex = 0;
  while ((m = RICH_TOKEN_RE.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), bold, italic, size, start: last });
    if (m[0] === '**') {
      bold = !bold;
    } else {
      const closing = m[1] === '/';
      const kind = m[2];
      if (kind === 'i') italic = !closing;
      else size = closing ? null : kind;
    }
    last = RICH_TOKEN_RE.lastIndex;
  }
  if (last < text.length) out.push({ t: text.slice(last), bold, italic, size, start: last });
  return out;
}

// em-relative (not px) so a resized run still scales with the surrounding
// context instead of a fixed pixel size — see detectSize in bulletList.js.
// lg/xl also carry their own weight so a pasted heading actually reads as
// a heading (bigger AND bolder), not just scaled-up regular text; sm stays
// regular weight — fine print isn't meant to stand out, just read smaller.
// Colour is applied by the renderer (DetailView.js/ReviewQueue.js/
// SystemReview.js), which has the current theme's token to pick a properly
// high-contrast one from — this file stays theme-agnostic.
export const RICH_SIZE_STYLE = {
  sm: { fontSize: '0.92em' },
  lg: { fontSize: '1.3em', fontWeight: 600 },
  xl: { fontSize: '1.6em', fontWeight: 700 },
};

export const HL_COLORS = [
  { bg:'#fef08a', text:'#713f12', label:'Yellow' },
  { bg:'#bbf7d0', text:'#14532d', label:'Green'  },
  { bg:'#bfdbfe', text:'#1e3a8a', label:'Blue'   },
  { bg:'#fbcfe8', text:'#831843', label:'Pink'   },
  { bg:'#fed7aa', text:'#7c2d12', label:'Orange' },
];

// Dark-mode equivalents, keyed by each colour's light background.
// In dark mode the note text is near-white, so pale pastel highlights make it
// unreadable ("white/opaque/shabby"). These use translucent dark-friendly tints
// with light text instead, so the highlight reads cleanly on a dark surface.
const HL_DARK = {
  '#fef08a': { bg:'rgba(250,204,21,0.30)', text:'#fef9c3' },
  '#bbf7d0': { bg:'rgba(34,197,94,0.30)',  text:'#dcfce7' },
  '#bfdbfe': { bg:'rgba(96,165,250,0.32)', text:'#dbeafe' },
  '#fbcfe8': { bg:'rgba(244,114,182,0.30)',text:'#fce7f3' },
  '#fed7aa': { bg:'rgba(251,146,60,0.30)', text:'#ffedd5' },
};

// Resolve a stored highlight colour to the right {bg,text} for the active theme.
// Stored highlights keep their original light-mode object, so we map at render time
// (no data migration needed).
export function resolveHL(color, isDark) {
  if (!color) return null;
  if (isDark && HL_DARK[color.bg]) return HL_DARK[color.bg];
  return { bg: color.bg, text: color.text };
}

// Defensive clamp/sort shared by buildFormattedParts below — never let a
// stale/out-of-range highlight (e.g. one saved against a since-shortened
// note) crash a render.
function cleanHighlights(highlights, textLength) {
  if (!highlights || highlights.length === 0) return [];
  return highlights
    .filter(h => h && Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start)
    .map(h => ({ ...h, start: Math.max(0, h.start), end: Math.min(textLength, h.end) }))
    .filter(h => h.end > h.start)
    .sort((a, b) => a.start - b.start);
}

// Splits `text` into atomic runs that are each a SINGLE, definite
// combination of (bold, italic, size) formatting AND highlight colour (or
// none) — the join of splitRich's marker parsing and a highlight-colour
// slice, instead of doing them as two independent passes.
//
// That used to be exactly two passes — slice the raw marker string by
// highlight start/end first (the old buildHighlightParts), then run each
// resulting slice through its own fresh splitRich/richMarkersToHtml call —
// and it was wrong whenever a highlight's boundary fell INSIDE a
// **bold**/{{i}}…{{/i}}/{{lg}}…{{/lg}} run rather than exactly on one of
// its edges (completely ordinary — selecting "bold wor" out of "a **bold
// word**" for a highlight, say). The run's own opening and closing marker
// tokens end up in DIFFERENT slices, each parsed independently with no
// memory of the other: splitRich on a slice with only a closing (or only
// an opening) token has no partner to pair it with, so depending on exactly
// where the cut fell, the formatting either vanishes from the text it
// belonged to, or "leaks" onto whatever unrelated text follows within that
// same slice (a dangling unmatched token one slice treats as its own
// opening toggle) — which is exactly the reported bug: bold jumping onto
// adjacent words, or a bold run losing its own styling, around wherever a
// highlight happened to end.
//
// The fix: parse the FULL text for markers ONCE (splitRich already does
// this correctly end-to-end, since it's a single scan with no artificial
// cut points) — then, for each resulting run, slice ONLY that run's own
// plain content by whatever highlight(s) overlap it. A run's raw-offset
// span is exactly [run.start, run.start + run.t.length) — no markers can
// fall inside it (that's what makes it a "run") — so intersecting it
// against highlight offsets (also raw-string offsets) is a plain, correct
// substring op with no risk of ever separating a marker from its partner.
export function buildFormattedParts(text, highlights) {
  if (!text) return [];
  const runs = splitRich(text);
  const sorted = cleanHighlights(highlights, text.length);
  if (sorted.length === 0) return runs.map(r => ({ ...r, hl: null }));

  const parts = [];
  for (const run of runs) {
    const runStart = run.start;
    const runEnd = run.start + run.t.length;
    // Every highlight boundary that falls strictly inside this run becomes
    // an extra cut point, alongside the run's own start/end — so this run
    // gets split only where a highlight genuinely starts/ends within it,
    // never anywhere a marker could have been.
    const cuts = new Set([runStart, runEnd]);
    for (const h of sorted) {
      if (h.start > runStart && h.start < runEnd) cuts.add(h.start);
      if (h.end > runStart && h.end < runEnd) cuts.add(h.end);
    }
    const points = Array.from(cuts).sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i], segEnd = points[i + 1];
      if (segEnd <= segStart) continue;
      const covering = sorted.find(h => h.start <= segStart && h.end > segStart);
      parts.push({
        t: run.t.slice(segStart - runStart, segEnd - runStart),
        bold: run.bold, italic: run.italic, size: run.size,
        start: segStart,
        hl: covering ? covering.color : null,
      });
    }
  }
  return parts;
}

// Escapes text before injecting into an HTML string. Without this, a note
// containing "<", ">" or "&" (e.g. "CD4 < 200", "T&C") corrupts the markup.
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function sizeStyleAttr(size) {
  const s = RICH_SIZE_STYLE[size];
  return s.fontWeight ? `font-size:${s.fontSize};font-weight:${s.fontWeight}` : `font-size:${s.fontSize}`;
}

// Converts marker-string text (no highlight slicing) into an HTML string
// with real <strong>/<em>/sized <span> tags — escaping first (so a note's
// own literal < > & are always safe) means the markers this converts
// afterward can only ever be ones this app itself wrote, never something
// pasted into the note's own text. `textColor`, if given, is set explicitly
// on bold/lg/xl runs (matching RichRuns.js's full-contrast bump for an
// active theme) — sm (fine print) never gets one, same as RichRuns, since
// it's meant to read smaller, not louder. Shared by the rich editor's
// initial/paste HTML (lib/richEditor.js) and DetailView.js's PDF export
// (escWithBold) — one definition of "what HTML does a marker become," not
// two that could render differently from each other.
export function richMarkersToHtml(text, textColor) {
  let s = escHtml(text);
  const colorAttr = textColor ? `;color:${textColor}` : '';
  s = s.replace(/\{\{xl\}\}([\s\S]*?)\{\{\/xl\}\}/g, `<span style="${sizeStyleAttr('xl')}${colorAttr}">$1</span>`);
  s = s.replace(/\{\{lg\}\}([\s\S]*?)\{\{\/lg\}\}/g, `<span style="${sizeStyleAttr('lg')}${colorAttr}">$1</span>`);
  s = s.replace(/\{\{sm\}\}([\s\S]*?)\{\{\/sm\}\}/g, `<span style="${sizeStyleAttr('sm')}">$1</span>`);
  s = s.replace(/\{\{i\}\}([\s\S]*?)\{\{\/i\}\}/g, '<em>$1</em>');
  s = s.replace(/\*\*([^*]+)\*\*/g, textColor ? `<strong style="color:${textColor}">$1</strong>` : '<strong>$1</strong>');
  return s;
}

// A single atomic part (from buildFormattedParts — already a definite
// bold/italic/size combination, never literal marker text) to an HTML
// string. Same attribute/colour precedence richMarkersToHtml used to apply
// via its sequential regex replacements (size innermost... no — size
// carries its own colour attr, italic plain, bold outermost gets the
// colour when no size is present) — see RICH_SIZE_STYLE's own comment for
// why sm never gets a colour bump.
function formattedPartToHtml(p, textColor) {
  let inner = escHtml(p.t);
  if (p.size) {
    const colorAttr = (textColor && p.size !== 'sm') ? `;color:${textColor}` : '';
    inner = `<span style="${sizeStyleAttr(p.size)}${colorAttr}">${inner}</span>`;
  }
  if (p.italic) inner = `<em>${inner}</em>`;
  if (p.bold) inner = textColor ? `<strong style="color:${textColor}">${inner}</strong>` : `<strong>${inner}</strong>`;
  return inner;
}

// Full HTML for a marker-string PLUS highlight colour bands — the rich
// editor's initial render and its paste-insertion both use this, so a note
// (and any highlights already on it) shows up in edit mode looking exactly
// like RenderedNotes already renders it everywhere else. `isDark` resolves
// each highlight's colour the same way RenderedNotes does (resolveHL).
//
// Built from buildFormattedParts (never buildHighlightParts+richMarkersToHtml
// independently per slice — see buildFormattedParts' own comment for why
// that used to corrupt bold/italic/size runs a highlight boundary cut
// through), so a highlight landing anywhere inside a **bold**/{{i}}…{{/i}}/
// {{lg}}…{{/lg}} run can never separate that run's own opening and closing
// markers into two independently-parsed strings.
export function markedTextToHtml(text, highlights, textColor, isDark) {
  const parts = buildFormattedParts(text, highlights);
  // Group consecutive parts that share the same highlight (same `color`
  // object — buildFormattedParts reuses it across every part one highlight
  // covers) into a single <mark>, instead of one per part. A highlight
  // crossing a bold/plain (or italic/size) boundary legitimately produces
  // separate parts for each side (see buildFormattedParts' own comment),
  // but each is still visually ONE highlighted phrase — one <mark> per part
  // put a visible gap (each mark's own `padding: 0 2px`) exactly at that
  // boundary, reading as an extra inserted space. See RichRuns.js's
  // groupByHighlight for the read-only-render half of this same fix.
  const groups = [];
  for (const p of parts) {
    const prev = groups[groups.length - 1];
    if (prev && p.hl && prev.hl === p.hl) prev.parts.push(p);
    else groups.push({ hl: p.hl, parts: [p] });
  }
  return groups.map(g => {
    const inner = g.parts.map(p => formattedPartToHtml(p, textColor)).join('');
    if (!g.hl) return inner;
    const c = resolveHL(g.hl, isDark);
    return `<mark style="background:${c.bg};color:${c.text};border-radius:2px;padding:0 2px">${inner}</mark>`;
  }).join('');
}

/**
 * Diff-based highlight adjustment.
 * Finds the single edited region (common prefix / common suffix trick — correct
 * for normal typing/deleting/pasting) and shifts, grows, trims, or drops each
 * highlight relative to that edit — instead of discarding every highlight whose
 * exact old offsets no longer match verbatim.
 */
export function adjustHighlights(oldText, newText, highlights) {
  if (!highlights || highlights.length === 0) return [];
  if (oldText === newText) return highlights;

  const oldLen = oldText.length, newLen = newText.length;

  let prefix = 0;
  const maxPrefix = Math.min(oldLen, newLen);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(oldLen, newLen) - prefix;
  while (suffix < maxSuffix &&
         oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]) suffix++;

  const oldEditStart = prefix;
  const oldEditEnd   = oldLen - suffix;
  const delta        = newLen - oldLen;

  const result = [];
  for (const h of highlights) {
    if (!h || !Number.isFinite(h.start) || !Number.isFinite(h.end) || h.end <= h.start) continue;

    if (h.end <= oldEditStart) {
      // Entirely before the edit — untouched
      result.push(h);
    } else if (h.start >= oldEditEnd) {
      // Entirely after the edit — shift with it
      const ns = h.start + delta, ne = h.end + delta;
      if (ne > ns) result.push({ ...h, start: ns, end: ne });
    } else if (h.start <= oldEditStart && h.end >= oldEditEnd) {
      // Edit happened inside the highlighted range — grow/shrink with it
      // (typing inside a highlight keeps extending the highlight, which matches
      // what most people expect while actively highlighting-and-typing)
      const ne = h.end + delta;
      if (ne > h.start) result.push({ ...h, end: ne });
    } else if (h.start < oldEditStart) {
      // Overlaps the edit on its right edge only — trim to before the edit
      if (oldEditStart > h.start) result.push({ ...h, end: oldEditStart });
    } else {
      // Overlaps the edit on its left edge only — trim to after the edit, then shift
      const ns = oldEditEnd + delta, ne = h.end + delta;
      if (ne > ns) result.push({ ...h, start: ns, end: ne });
    }
  }

  // Final safety clamp — guarantees nothing downstream ever sees an
  // out-of-range or inverted highlight, even if an edge case slipped through.
  return result
    .map(h => ({ ...h, start: Math.max(0, h.start), end: Math.min(newLen, h.end) }))
    .filter(h => h.end > h.start);
}

// Keyboard shortcuts for applying/removing a highlight — mnemonic first
// letters (Y)ellow/(G)reen/(B)lue/(P)ink/(O)range, (R)emove, built straight
// from HL_COLORS' own labels so the mapping can never drift out of sync
// with the actual colour list. Two variants, because the same bare letter
// can't mean the same thing in both places it's used:
//   - matchHighlightShortcutEditing: a plain `y` would just type the letter
//     into the textarea, so this one requires Alt held (Alt+Y, Alt+G, …).
//   - matchHighlightShortcutView: the saved-entry notes aren't editable in
//     view mode — selecting text and pressing a key can't mean "type a
//     character" there — so the bare letter alone IS the shortcut, same as
//     a Kindle/Hypothesis-style reading-mode shortcut.
// Both return null (and leave the keydown alone) for anything else,
// including a Shift/Ctrl/Cmd chord riding along, so a capital-letter
// keyboard shortcut from some other feature, or genuine typing, is never
// swallowed by accident.
const HL_LETTER_INDEX = Object.fromEntries(HL_COLORS.map((c, i) => [c.label[0].toLowerCase(), i]));

function matchHighlightLetter(e) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'r') return { remove: true };
  const i = HL_LETTER_INDEX[key];
  return i === undefined ? null : { color: HL_COLORS[i] };
}

export function matchHighlightShortcutEditing(e) {
  if (!e.altKey) return null;
  return matchHighlightLetter(e);
}

export function matchHighlightShortcutView(e) {
  if (e.altKey) return null;
  return matchHighlightLetter(e);
}

// Get selection offsets from a textarea — works on all platforms
export function getTextareaSelection(ta) {
  if (!ta) return null;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  if (start === end) return null;
  return { start, end };
}
