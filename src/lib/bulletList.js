// Rich-paste + bullet-list authoring helpers for the Review Notes editor —
// a contentEditable surface, NOT a plain <textarea>. The storage format
// hasn't changed: `notes` is still a plain string, with the SAME lightweight
// marker syntax a rich paste has always produced — **bold**, {{i}}…{{/i}}
// for italic, {{sm}}/{{lg}}/{{xl}}…{{/…}} for relative size — nothing about
// the DB column, search, or highlight-offset math changed. What changed is
// the EDIT surface itself: it used to be a <textarea> that showed those
// markers as literal "**"/"{{lg}}" characters while editing (a plain
// <textarea> can't render inline formatting at all); it's now a real
// contentEditable div that shows actual bold/italic/resized text WHILE
// YOU TYPE OR PASTE, via the exact same RenderedNotes/RichRuns.js
// rendering the read-only view already uses (through markedTextToHtml, in
// lib/highlights.js) — so there's no more "looks right only after you
// leave edit mode" gap.
//
// Because the DOM now shows rendered (marker-stripped) content instead of
// the raw marker-string, every function in this file that used to read
// `ta.value`/`ta.selectionStart` against that raw string now instead:
//   - serializes the live DOM back into the raw marker-string on demand
//     (inlineTextWithMarks, walking real <strong>/<em>/sized <span>
//     elements the SAME way RenderedNotes produces them — not a second,
//     separate "how do markers work" implementation); and
//   - maps between a raw-string offset and a DOM (node, offset) position
//     in both directions (locateInMarkedText / domPositionAt) wherever it
//     needs to inspect or move the actual caret/selection.
// useHighlight.js's edit-mode highlight capture uses the same two
// functions, for the same reason DetailView.js's view-mode capture needed
// fixing earlier: a selection made in rendered, marker-stripped DOM has to
// be translated back into raw-string coordinates before it's stored,
// or it silently lands on the wrong text once replayed.
//
// handleRichPaste reads the clipboard's HTML flavour (or, lacking that —
// a native chat app rather than a browser tab — markdown syntax directly
// in its plain-text flavour) and reconstructs that marker-string exactly
// as before, then converts it to real HTML (richMarkersToHtml) and inserts
// THAT at the caret via execCommand('insertHTML', …), instead of inserting
// the marker-string as literal text the way the old textarea version did.
//
// The rest of this file is the bullet AUTHORING side: continuing a bullet
// on Enter, indenting a sub-bullet with Tab, and a one-click way to turn
// line(s) into bullets without typing the marker by hand. Unrelated to
// pasting — these fire on user keystrokes/clicks, not clipboard content.
//
// Edits go through document.execCommand('insertText'/'insertHTML', …)
// rather than touching React state directly — the same technique GitHub's
// own markdown-toolbar uses for its list/bold/etc. buttons. It keeps the
// browser's native undo (Ctrl+Z) stack intact and fires a real 'input'
// event, so the editor's own onInput handler (which re-serializes the DOM
// into `notes` state — see AddEntry.js/DetailView.js) picks up the edit
// automatically; nothing here needs to know how that state gets used.
import { richMarkersToHtml } from './highlights';

const BULLET_RE = /^([ \t]*)([•\-*])(\s+)(.*)$/;
const INDENT = '  ';

function lineStartOf(text, pos) {
  return text.lastIndexOf('\n', pos - 1) + 1;
}
function lineEndOf(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl === -1 ? text.length : nl;
}
// execCommand operates on whatever the DOM selection currently is,
// regardless of which element that selection lives in — callers below
// always set it (via setSelectionRange, or it's simply wherever the
// keydown's own caret already was) immediately before calling this.
function insert(str) {
  return !!(document.execCommand && document.execCommand('insertText', false, str));
}
// Builds a Range over [start,end) — marker-string offsets, mapped to DOM
// positions via domPositionAt (see above) — and makes it the live DOM
// selection, so the execCommand call right after actually affects that
// span instead of wherever the selection happened to already be.
function setSelectionRange(root, start, end) {
  const sel = window.getSelection();
  if (!sel) return;
  const a = domPositionAt(root, start);
  const b = start === end ? a : domPositionAt(root, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Keydown handler for the rich editor — wire to the contentEditable's
 * onKeyDown. Handles Enter on EVERY line (not just a bullet one): the
 * browser's own default contentEditable Enter behaviour wraps content in
 * new <div>/<p> elements, which this editor's "\n"-only line-break model
 * (matching the plain-text storage format exactly — the same model a
 * plain <textarea> already gave for free, which is why the old version of
 * this function only ever intervened on an already-recognised bullet line)
 * can't represent, so every Enter press is intercepted and turned into a
 * literal "\n" character — continuing a bullet's indent+marker first, if
 * the current line is one. Tab still only acts on an already-recognised
 * bullet line (indent/outdent); on any other line it's left alone
 * entirely, so Tab-to-move-focus keeps working everywhere else, same as
 * before.
 *
 * Operates on the marker-string serialization of root's current content
 * (inlineTextWithMarks) and maps raw-string positions back to DOM
 * positions via domPositionAt to build the Range execCommand needs —
 * never a second, separate "what's on this line" implementation.
 */
export function handleBulletKeyDown(e) {
  if (e.key !== 'Enter' && e.key !== 'Tab') return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return; // only a collapsed caret
  const root = e.currentTarget;
  if (!root.contains(range.startContainer)) return;

  const text = inlineTextWithMarks(root);
  const pos = locateInMarkedText(root, range.startContainer, range.startOffset);
  if (pos == null) return;
  const lineStart = lineStartOf(text, pos);
  const lineEnd = lineEndOf(text, pos);
  const m = text.slice(lineStart, lineEnd).match(BULLET_RE);

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (m) {
      const [, indent, marker, , content] = m;
      if (content.trim() === '' && pos === lineEnd) {
        // Second Enter on an empty bullet exits the list — drop the marker
        // (and its indent) and land on a plain blank line, rather than
        // piling up another empty bullet underneath it.
        setSelectionRange(root, lineStart, lineEnd);
        insert('\n');
      } else {
        insert(`\n${indent}${marker} `);
      }
    } else {
      insert('\n');
    }
    return;
  }

  if (e.key === 'Tab') {
    if (!m) return; // not a bullet line — leave Tab (focus-move) alone
    e.preventDefault();
    const [, indent] = m;
    if (e.shiftKey) {
      if (!indent.startsWith(INDENT)) return; // nothing to outdent
      setSelectionRange(root, lineStart, lineStart + INDENT.length);
      insert('');
    } else {
      setSelectionRange(root, lineStart, lineStart);
      insert(INDENT);
    }
  }
}

/**
 * Toolbar action — toggle a "• " marker on the current line, or on every
 * line the current selection touches. Mirrors how useHighlight's applyHL
 * drives the editable surface: read the selection, mutate, done.
 */
export function toggleBulletLines(root) {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const text = inlineTextWithMarks(root);
  const a = locateInMarkedText(root, range.startContainer, range.startOffset);
  const b = locateInMarkedText(root, range.endContainer, range.endOffset);
  if (a == null || b == null) return;
  const selStart = Math.min(a, b), selEnd = Math.max(a, b);

  const blockStart = lineStartOf(text, selStart);
  const blockEnd = lineEndOf(text, Math.max(selEnd - 1, selStart));
  const block = text.slice(blockStart, blockEnd);
  const lines = block.split('\n');

  const contentLines = lines.filter(l => l.trim() !== '');
  const allBulleted = contentLines.length > 0 && contentLines.every(l => BULLET_RE.test(l));

  const next = lines.map(l => {
    if (l.trim() === '') return l;
    const m = l.match(BULLET_RE);
    if (allBulleted) return m ? `${m[1]}${m[4]}` : l; // strip markers
    return m ? l : `• ${l}`;                            // add markers
  }).join('\n');

  if (next === block) return;
  root.focus();
  setSelectionRange(root, blockStart, blockEnd);
  insert(next);
}

// Inline text extraction that keeps formatting as plain-text markers
// instead of flattening it away: <strong>/<b> as **bold**, <em>/<i> as
// {{i}}…{{/i}}, and a relative font size (from a heading tag or an inline
// font-size style/attribute) as {{sm}}/{{lg}}/{{xl}}…{{/…}}. Colour is
// deliberately NOT captured — a colour authored for the source's light
// background can be unreadable against this app's dark mode (or vice
// versa), so notes always render in the current theme's text colour,
// same as everywhere else. Brackets (not markdown's `_italic_`) are used
// for italic/size so a plain underscore typed in a note (gene names,
// snake_case) is never mistaken for a marker. <ul>/<ol> are skipped here —
// callers that need nested-list handling (liOwnText) strip them beforehand
// and walk them separately via collectLines.
const BOLD_TAGS = /^(strong|b)$/i;
const ITALIC_TAGS = /^(em|i)$/i;

// A size is only recorded as "small/large/extra-large" relative to normal
// body text — never the source's literal pixel value, which could be
// sized for a full-width webpage and look oversized or tiny in the notes
// panel. Headings fall back to their well-known default relative sizes
// (DOMParser's detached document never computes CSS, so h1..h6 carry no
// resolvable style of their own); <small>/<big> are checked the same way.
function fontSizeToPx(value) {
  if (!value) return null;
  const m = /^([\d.]+)(px|pt|em|rem|%)?$/.exec(String(value).trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return null;
  switch (m[2]) {
    case 'pt': return num * (96 / 72);
    case 'em': case 'rem': return num * 16;
    case '%': return num * 16 / 100;
    default: return num; // px, or a bare unitless number
  }
}
const HEADING_SIZE = { h1: 'xl', h2: 'xl', h3: 'lg', h5: 'sm', h6: 'sm', small: 'sm', big: 'lg' };
function detectSize(el) {
  const tag = el.tagName.toLowerCase();
  if (HEADING_SIZE[tag]) return HEADING_SIZE[tag];
  const px = fontSizeToPx(el.style && el.style.fontSize);
  if (px == null) return null;
  const ratio = px / 16;
  if (ratio >= 1.5) return 'xl';
  if (ratio >= 1.15) return 'lg';
  if (ratio <= 0.85) return 'sm';
  return null;
}

// Wraps `inner` (el's already-computed inner text) in whatever markers
// el's OWN tag/style call for — bold/italic from its tag, size from either
// its tag (a heading) or its inline style. Used both for an inline child
// (inlineTextWithMarks) and for a block-level element's own text
// (collectLines' BLOCK_TAGS branch) — a block tag's own formatting
// (e.g. a plain <h2>, with no nested <strong> inside it) would otherwise
// never be captured, since nothing else ever looks at that element itself.
//
// Collapses internal whitespace RUNS to a single space (cleans up messy
// pasted HTML — e.g. a Google-Docs-style <strong>\n  text  \n</strong>) but
// deliberately does NOT trim a single leading/trailing space. A `<strong>`
// (etc) can legitimately have one of those at an edge and mean it: a
// highlight whose boundary falls partway through a bold run splits that
// run into adjacent <strong> elements at exactly that boundary (see
// buildFormattedParts in lib/highlights.js), and whichever side's own text
// happens to start or end on a space depends only on where the highlight
// was drawn — trimming it here used to silently eat the space between two
// now-adjacent words the moment that bold run was next re-serialized
// (e.g. on the very next keystroke, or the next highlight action).
function wrapMarks(el, inner) {
  const tag = el.tagName.toLowerCase();
  if (BOLD_TAGS.test(tag)) {
    const t = inner.replace(/\s+/g, ' ');
    if (t) inner = `**${t}**`;
  } else if (ITALIC_TAGS.test(tag)) {
    const t = inner.replace(/\s+/g, ' ');
    if (t) inner = `{{i}}${t}{{/i}}`;
  }
  const size = detectSize(el);
  if (size) {
    const t = inner.replace(/\s+/g, ' ');
    if (t) inner = `{{${size}}}${t}{{/${size}}}`;
  }
  return inner;
}

// Returns this element's own marker opening length — e.g. 2 for a <strong>
// ("**"), 6 for a heading-sized <span> ("{{xl}}"), 8 for both combined
// ("{{xl}}**") — WITHOUT depending on its real inner text (whose leading/
// trailing whitespace wrapMarks may trim, which would make measuring the
// prefix via indexOf-into-the-real-content unreliable). A one-character
// sentinel has no whitespace to trim, so it survives wrapMarks unchanged
// and always sits exactly after whatever prefix was added.
const MARKER_SENTINEL = '\u0001';
function openingMarkerLength(el) {
  const idx = wrapMarks(el, MARKER_SENTINEL).indexOf(MARKER_SENTINEL);
  return idx === -1 ? 0 : idx;
}

// The one walk that both inlineTextWithMarks (serialize) and
// locateInMarkedText (locate a DOM position within the serialized result)
// are built from — so there is exactly one place that knows how a marker
// string position corresponds to a DOM position, not two that could drift
// apart from each other. `targetNode`/`targetOffset` are a Range boundary
// (as in Range.startContainer/startOffset — targetOffset is a character
// offset when targetNode is a text node, a CHILD INDEX when it's an
// element, per Range semantics) to locate within this subtree; pass null
// to just serialize. Returns { text, foundAt } — foundAt is the marker-
// string offset of that boundary, or null if it wasn't found here (either
// not passed, or genuinely outside this subtree).
function walkAndLocate(node, targetNode, targetOffset) {
  let text = '';
  let foundAt = null;
  const children = Array.from(node.childNodes);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (foundAt === null && targetNode === node && targetOffset === i) foundAt = text.length;

    if (child.nodeType === Node.TEXT_NODE) {
      if (foundAt === null && child === targetNode) {
        foundAt = text.length + Math.min(targetOffset, child.textContent.length);
      }
      text += child.textContent;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') continue;
    // Despite this editor explicitly inserting "\n" itself for Enter (see
    // handleBulletKeyDown below) and calling preventDefault, real Chrome/
    // Safari normalize that into their OWN idea of a line break instead of
    // keeping a literal "\n" text character: each new line becomes its own
    // <div> (confirmed empirically — a jsdom-mocked execCommand doesn't
    // reproduce this, so this was only caught by testing against a real
    // browser), with a wholly empty line rendered as <div><br></div> (a
    // bare <br> is the only way to make an empty block visible/selectable
    // at all). So a <div>/<p> here is treated as implying a "\n" before its
    // own content — except for the FIRST child overall (nothing precedes
    // it to separate from). The <br> INSIDE such a div is then skipped
    // entirely when it's that div's one and only child: it's pure
    // rendering filler for the empty line the div's own leading "\n"
    // already accounts for, not a second, real line break — counting both
    // would turn one empty line into two. A <br> anywhere else (a genuine
    // embedded soft break, e.g. from Shift+Enter within one block, or a
    // bare <br> this editor never produces itself but a different native
    // mutation path might) still counts as its own "\n".
    if (tag === 'br') {
      const soleChildOfLine = children.length === 1 && node.nodeType === Node.ELEMENT_NODE &&
        /^(div|p)$/i.test(node.tagName);
      if (!soleChildOfLine) text += '\n';
      continue;
    }
    if ((tag === 'div' || tag === 'p') && i > 0) text += '\n';

    const inner = walkAndLocate(child, targetNode, targetOffset);
    const wrapped = wrapMarks(child, inner.text);
    if (foundAt === null && inner.foundAt !== null) {
      foundAt = text.length + openingMarkerLength(child) + inner.foundAt;
    }
    text += wrapped;
  }
  if (foundAt === null && targetNode === node && targetOffset === children.length) foundAt = text.length;
  return { text, foundAt };
}

export function inlineTextWithMarks(node) {
  return walkAndLocate(node, null, -1).text;
}

/**
 * Locates a Range boundary (container, offset — e.g. from
 * range.startContainer/range.startOffset) within the marker-string that
 * `root`'s current DOM content would serialize to, returning that marker-
 * string offset (or null if the boundary isn't inside root at all). Used
 * below (the editable keydown/paste handlers) and by useHighlight.js to
 * translate a live selection made in the EDITABLE, already-formatted DOM —
 * which has every marker already rendered away into real <strong>/<em>/
 * sized <span> elements, exactly like the read-only view — into the same
 * raw marker-string coordinates storage and every other render already
 * use. Unlike DetailView.js's rawOffsetAt (which reads a data-raw-start
 * annotation stamped once at render time, valid because that DOM is
 * read-only and never changes underneath it), this re-walks the DOM fresh
 * on every call: an editable surface's DOM mutates on every keystroke, so
 * a stamped annotation would go stale immediately — recomputing from
 * scratch is the only way to stay correct, and notes are short enough
 * that this is cheap.
 */
export function locateInMarkedText(root, targetNode, targetOffset) {
  return walkAndLocate(root, targetNode, targetOffset).foundAt;
}

// The inverse of locateInMarkedText — given a marker-string offset, finds
// the (node, offset) DOM position it corresponds to in root's current
// content. Used below for bullet indent/outdent (always a line start/end
// or just inside a line's leading indent — always plain, unformatted
// text) and by useHighlight.js to restore the caret after it rebuilds
// root's DOM from a freshly-changed highlights array. That caret position
// CAN occasionally land inside a marker-wrapped run (a highlight ending
// mid-word inside a **bold** run) — this doesn't support pointing INSIDE
// a <strong>/<em>/sized <span> precisely, it clamps to that element's
// start instead, which just means the caret lands at the nearest run
// boundary rather than the exact character in that rare case, not
// anything worse.
export function domPositionAt(root, targetOffset) {
  let acc = 0;
  // Returns a position, or null if targetOffset isn't within this
  // particular subtree — by which point `acc` has already been advanced by
  // this whole subtree's length, so the caller's own loop accounting stays
  // correct either way. See walkAndLocate above for why div/p and the
  // sole-child <br> case need this handling: real Chrome/Safari wrap each
  // new line in its own <div> instead of using a literal "\n" character.
  function walk(node) {
    const children = Array.from(node.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === Node.TEXT_NODE) {
        const len = child.textContent.length;
        if (acc + len >= targetOffset) return { node: child, offset: targetOffset - acc };
        acc += len;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') continue;
      if (tag === 'br') {
        const soleChildOfLine = children.length === 1 && node.nodeType === Node.ELEMENT_NODE &&
          /^(div|p)$/i.test(node.tagName);
        if (soleChildOfLine) continue; // pure rendering filler — see walkAndLocate
        if (acc + 1 >= targetOffset) return { node, offset: i + 1 };
        acc += 1;
        continue;
      }
      if (tag === 'div' || tag === 'p') {
        if (i > 0) acc += 1; // the implicit "\n" this line boundary represents
        // Recurse INTO it (not the opaque "clamp to this element's start"
        // treatment used below for a marker-wrapped run) — a position can
        // legitimately need to land anywhere inside a specific line's own
        // content, e.g. a bullet's own line-start/line-end.
        const found = walk(child);
        if (found) return found;
        continue;
      }
      const wrapped = wrapMarks(child, inlineTextWithMarks(child));
      // Exactly at this run's end (the common case right after applying a
      // highlight that ends here) points AFTER the element, in the parent —
      // not offset:0 inside it, which would instead land at its START.
      if (acc + wrapped.length === targetOffset) return { node, offset: i + 1 };
      if (acc + wrapped.length > targetOffset) return { node: child, offset: 0 };
      acc += wrapped.length;
    }
    return null;
  }
  return walk(root) || { node: root, offset: root.childNodes.length };
}

// A <li>'s "own" text — everything inside it EXCEPT a nested <ul>/<ol>
// (those get walked separately as their own indented lines below), with
// formatting preserved (inlineTextWithMarks) and everything else (spans, a
// Google-Docs-style wrapper <p> — Docs nests a <p> inside every <li>)
// flattened to plain text.
function liOwnText(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll('ul, ol').forEach(n => n.remove());
  return wrapMarks(clone, inlineTextWithMarks(clone)).replace(/\s+/g, ' ').trim();
}

const BLOCK_TAGS = /^(p|div|h[1-6]|blockquote|section|article|li)$/;

// A blank line between paragraph-level blocks, so pasted prose still reads
// in paragraphs instead of every block running together — but never a
// leading blank, and never two in a row (a wrapper div around a single
// paragraph would otherwise double up).
function pushParagraphBreak(lines) {
  if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
}

// Walk a parsed clipboard fragment, emitting one plain-text line per list
// item (bulleted, indented by nesting depth) and per paragraph/block —
// mirrors how the source actually reads, not a soup of inline tags.
function collectLines(node, depth, lines) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent.replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toLowerCase();

    if (tag === 'li') {
      const text = liOwnText(child);
      if (text) lines.push(`${INDENT.repeat(depth)}• ${text}`);
      Array.from(child.children)
        .filter(c => /^(ul|ol)$/i.test(c.tagName))
        .forEach(list => collectLines(list, depth + 1, lines));
    } else if (tag === 'ul' || tag === 'ol') {
      // Only a genuinely top-level list (depth 0) gets paragraph spacing
      // before it — a NESTED sub-list (reached via the `li` branch above,
      // which recurses with depth + 1) stays tight under its parent bullet.
      if (depth === 0) pushParagraphBreak(lines);
      collectLines(child, depth, lines);
    } else if (BLOCK_TAGS.test(tag)) {
      if (child.querySelector('li')) {
        collectLines(child, depth, lines); // a wrapper div/p around a list
      } else {
        const t = wrapMarks(child, inlineTextWithMarks(child)).replace(/\s+/g, ' ').trim();
        if (t) { pushParagraphBreak(lines); lines.push(t); }
      }
    } else {
      collectLines(child, depth, lines); // inline wrapper (span/b/a/font/…)
    }
  }
}

// --- Plain-text markdown fallback ----------------------------------------
// Some sources put ONLY their raw markdown source on the clipboard, with no
// "text/html" flavour at all — notably native chat apps (the iOS/iPadOS
// Claude app, among others) rather than a browser tab. Without this
// fallback, collectLines above never runs (nothing to parse as HTML) and
// the markdown's own "# "/"## "/"- " syntax pastes in completely
// literally; **bold** happens to "work" only by coincidence, since it's
// already our own marker syntax. This recognizes that same markdown
// syntax directly in the plain-text clipboard flavour and converts it to
// the exact same **/{{…}}/• marker scheme the HTML path produces above, so
// both paths render identically afterward.
const MD_HEADING_SIZE = { 1: 'xl', 2: 'xl', 3: 'lg', 4: null, 5: 'sm', 6: 'sm' };

function mdInlineToMarks(text) {
  // __bold__ is CommonMark's other bold syntax — normalise it to **bold**,
  // our own native marker, so splitRich doesn't need to know about it.
  let t = text.replace(/__([^_]+)__/g, '**$1**');
  // Italic: a single * or _, not part of a **/__ pair. The "no space right
  // after the opening marker" rule (and, for *, "preceded by a non-* char
  // or line start") means a bare "3 * 4" or a **bold** pair is never
  // mistaken for emphasis. No lookbehind (older WebKit on a tablet may not
  // support it) — the preceding character is captured and put back instead.
  t = t.replace(/(^|[^*])\*([^\s*][^*]*?)\*(?!\*)/g, '$1{{i}}$2{{/i}}');
  // '_' counts as a word character for \b, so \b never sits between two
  // underscore-adjacent word chars — "snake_case"/"beta_2" are untouched.
  t = t.replace(/\b_([^\s_][^_]*?)_\b/g, '{{i}}$1{{/i}}');
  return t;
}

// Only engage this fallback for clipboard text that actually looks like
// markdown — an ordinary plain-text paste (a stray "-" or "*" in normal
// prose) must never be rewritten.
function looksLikeMarkdown(text) {
  return /(^|\n) {0,3}#{1,6} /.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /(^|\n) *[-*•] /.test(text) ||
    /\b_[^\s_][^_]*_\b/.test(text);
}

function markdownPlainTextToMarked(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.map(raw => {
    const heading = /^ {0,3}(#{1,6}) +(.*)$/.exec(raw);
    if (heading) {
      const size = MD_HEADING_SIZE[heading[1].length];
      const content = mdInlineToMarks(heading[2].trim());
      return size ? `{{${size}}}${content}{{/${size}}}` : content;
    }
    const bullet = /^( *)[-*•] +(.*)$/.exec(raw) || /^( *)\d+\. +(.*)$/.exec(raw);
    if (bullet) {
      const depth = Math.floor(bullet[1].length / 2);
      return `${INDENT.repeat(depth)}• ${mdInlineToMarks(bullet[2].trim())}`;
    }
    return mdInlineToMarks(raw);
  }).join('\n');
}

/**
 * Paste handler — wire to the contentEditable's onPaste. Reconstructs
 * bold/italic/relative size, paragraph spacing, and "• " bullets either
 * from the clipboard's real HTML structure, or — when a source (e.g. a
 * native chat app) carries no HTML flavour at all — from markdown syntax
 * recognized directly in its plain-text flavour. Never touches an
 * ordinary plain-text paste that is neither of those.
 *
 * Builds the SAME marker-string the old textarea version inserted as
 * literal text, but — since this editor shows real formatting, not raw
 * markers — converts it to real HTML (richMarkersToHtml, the exact same
 * conversion RenderedNotes' RichRuns.js and PDF export use) and inserts
 * that via execCommand('insertHTML', …) instead, so bold/headings/etc.
 * appear immediately, formatted, right where you pasted — not as literal
 * "**"/"{{lg}}" characters you'd otherwise only see once you left edit
 * mode. `textColor`, if given, matches it to the active theme (see
 * richMarkersToHtml) the same way the read-only view already does.
 */
export function handleRichPaste(e, textColor) {
  const html = e.clipboardData && e.clipboardData.getData('text/html');
  let block;

  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lines = [];
    collectLines(doc.body, 0, lines);
    if (lines.length === 0) return;
    block = lines.join('\n');
  } else {
    const plain = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!plain || !looksLikeMarkdown(plain)) return;
    block = markdownPlainTextToMarked(plain);
  }

  const root = e.currentTarget;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;

  const text = inlineTextWithMarks(root);
  const start = locateInMarkedText(root, range.startContainer, range.startOffset);
  const end = locateInMarkedText(root, range.endContainer, range.endOffset);
  if (start == null || end == null) return;
  // Keep the pasted content on its own line(s) instead of fusing into
  // whatever text sits right before/after the cursor — without this,
  // pasting mid-sentence runs the last line straight into the following
  // text ("• Yafter") instead of a new line ("• Y\nafter").
  if (start > 0 && text[start - 1] !== '\n') block = '\n' + block;
  if (end < text.length && text[end] !== '\n') block += '\n';

  e.preventDefault();
  document.execCommand && document.execCommand('insertHTML', false, richMarkersToHtml(block, textColor));
}

// "Paste as plain text" — the opt-in escape hatch from handleRichPaste's
// auto-formatting, for a source whose structure/markdown-like punctuation
// you don't want carried over (e.g. a PDF/slide export full of stray
// asterisks or odd line breaks). Takes only the clipboard's plain-text
// flavour and inserts it completely literally — no HTML-structure
// reconstruction, no markdown-marker detection, no bullet auto-conversion
// — so it lands exactly like the old plain-textarea editor's paste did,
// leaving the user to format/bullet it manually afterward if they want to.
export function handlePlainPaste(e) {
  const plain = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!plain) return;
  e.preventDefault();
  document.execCommand && document.execCommand('insertText', false, plain);
}

// Strips the two things that make Supabase/PostgREST reject an otherwise-
// fine insert/update with "unsupported Unicode escape sequence": a literal
// NUL character (Postgres text columns reject it outright, in any
// encoding) and a lone/unpaired UTF-16 surrogate (common fallout from
// copy-pasting out of a PDF whose text layer was built with a broken
// font/ligature mapping — the pasted string ends up with half of a
// surrogate pair with no partner). Call this on any free-text field
// (title/notes) right before it's sent to Supabase, regardless of how it
// got into that field (typed, rich-pasted, plain-pasted) — this is the
// backstop, not a replacement for sanitizing at paste time.
// Each alternative is zero-width outside the single surrogate char itself
// (lookahead/lookbehind, never consumed), so adjacent lone surrogates are
// each matched independently — no cross-match consumption bugs from a
// naive "consume the neighbour too" approach.
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function sanitizeForStorage(str) {
  if (!str) return str;
  return str.replace(/\u0000/g, '').replace(LONE_SURROGATE_RE, '');
}
