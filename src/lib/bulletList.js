// Rich-paste + bullet-list authoring helpers for a plain <textarea>
// (Review Notes).
//
// A native <textarea> keeps whatever's on the clipboard's plain-text
// flavour verbatim, and notes render with `white-space: pre-wrap` — so if
// the source's plain text already contains literal "•"/"-"/"*" characters,
// they show up exactly as copied with zero code. But most rich sources
// (ChatGPT, Claude, Gemini, Word, Google Docs, Notion, a webpage) carry
// their REAL formatting only as HTML — bold/italic as <strong>/<em> (or
// <b>/<i>), relative size as a heading tag or an inline font-size, lists as
// real <li> markup, paragraphs as separate <p> tags — and put none of that
// in the plain-text clipboard flavour at all. Pasting from those with a
// plain <textarea> either loses all of it or (depending on the source)
// also collapses every paragraph break into one monotone run of text.
//
// handleRichPaste below reads the clipboard's HTML flavour instead and
// reconstructs a lightweight markdown-ish plain-text equivalent: **bold**
// around anything that was <strong>/<b>, {{i}}…{{/i}} for <em>/<i>,
// {{sm}}/{{lg}}/{{xl}}…{{/…}} for a relative font size, "• " markers for
// real <li> structure (as before), and a blank line between paragraph-level
// blocks so pasted prose still reads in paragraphs. Colour is deliberately
// not captured (see inlineTextWithMarks below). That's still plain text in
// the `notes` column — nothing about storage, highlight-offset math, or
// search changes — only RenderedNotes (DetailView.js/ReviewQueue.js/
// SystemReview.js) parses the markers back out into real formatting when
// DISPLAYING a saved entry. While editing, the textarea shows the raw
// markers as-is, the same way any plain-text markdown editor does.
//
// The rest of this file is the bullet AUTHORING side: continuing a bullet
// on Enter, indenting a sub-bullet with Tab, and a one-click way to turn
// line(s) into bullets without typing the marker by hand. Unrelated to
// pasting — these fire on user keystrokes/clicks, not clipboard content.
//
// Edits go through document.execCommand('insertText', …) rather than
// touching React state directly — the same technique GitHub's own
// markdown-toolbar uses for its list/bold/etc. buttons. It keeps the
// browser's native undo (Ctrl+Z) stack intact and fires a real 'input'
// event, so the existing `hl.handleTextChange(old,new); setNotes(new)`
// onChange wiring in AddEntry/DetailView picks up the edit automatically —
// nothing downstream needs to know a bullet helper touched the text.

const BULLET_RE = /^([ \t]*)([•\-*])(\s+)(.*)$/;
const INDENT = '  ';

function lineStartOf(text, pos) {
  return text.lastIndexOf('\n', pos - 1) + 1;
}
function lineEndOf(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl === -1 ? text.length : nl;
}
function insert(ta, str) {
  return !!(document.execCommand && document.execCommand('insertText', false, str));
}

/**
 * Keydown handler for Enter/Tab list behaviour — wire directly to a
 * textarea's onKeyDown. No-ops (and does NOT call preventDefault) on any
 * line that isn't already a recognised bullet line, so normal typing and
 * Tab-to-move-focus are completely untouched everywhere else.
 */
export function handleBulletKeyDown(e) {
  if (e.key !== 'Enter' && e.key !== 'Tab') return;
  const ta = e.target;
  if (ta.selectionStart !== ta.selectionEnd) return; // only a collapsed caret

  const text = ta.value, pos = ta.selectionStart;
  const lineStart = lineStartOf(text, pos);
  const lineEnd = lineEndOf(text, pos);
  const m = text.slice(lineStart, lineEnd).match(BULLET_RE);
  if (!m) return;
  const [, indent, marker, , content] = m;

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (content.trim() === '' && pos === lineEnd) {
      // Second Enter on an empty bullet exits the list — drop the marker
      // (and its indent) and land on a plain blank line, rather than
      // piling up another empty bullet underneath it.
      ta.setSelectionRange(lineStart, lineEnd);
      insert(ta, '\n');
    } else {
      insert(ta, `\n${indent}${marker} `);
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      if (!indent.startsWith(INDENT)) return; // nothing to outdent
      ta.setSelectionRange(lineStart, lineStart + INDENT.length);
      insert(ta, '');
    } else {
      ta.setSelectionRange(lineStart, lineStart);
      insert(ta, INDENT);
    }
  }
}

/**
 * Toolbar action — toggle a "• " marker on the current line, or on every
 * line the current selection touches. Mirrors how useHighlight's applyHL
 * drives the textarea: read the selection, mutate, done.
 */
export function toggleBulletLines(ta) {
  if (!ta) return;
  const text = ta.value;
  const selStart = ta.selectionStart, selEnd = ta.selectionEnd;
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
  ta.focus();
  ta.setSelectionRange(blockStart, blockEnd);
  insert(ta, next);
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
function wrapMarks(el, inner) {
  const tag = el.tagName.toLowerCase();
  if (BOLD_TAGS.test(tag)) {
    const t = inner.replace(/\s+/g, ' ').trim();
    if (t) inner = `**${t}**`;
  } else if (ITALIC_TAGS.test(tag)) {
    const t = inner.replace(/\s+/g, ' ').trim();
    if (t) inner = `{{i}}${t}{{/i}}`;
  }
  const size = detectSize(el);
  if (size) {
    const t = inner.replace(/\s+/g, ' ').trim();
    if (t) inner = `{{${size}}}${t}{{/${size}}}`;
  }
  return inner;
}

function inlineTextWithMarks(node) {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') continue;
    out += wrapMarks(child, inlineTextWithMarks(child));
  }
  return out;
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
 * Paste handler — wire to a textarea's onPaste. Reconstructs bold/italic/
 * relative size, paragraph spacing, and "• " bullets either from the
 * clipboard's real HTML structure, or — when a source (e.g. a native chat
 * app) carries no HTML flavour at all — from markdown syntax recognized
 * directly in its plain-text flavour. Never touches an ordinary plain-text
 * paste that is neither of those.
 */
export function handleRichPaste(e) {
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

  const ta = e.target;
  const text = ta.value;
  const start = ta.selectionStart, end = ta.selectionEnd;
  // Keep the pasted content on its own line(s) instead of fusing into
  // whatever text sits right before/after the cursor — without this,
  // pasting mid-sentence runs the last line straight into the following
  // text ("• Yafter") instead of a new line ("• Y\nafter").
  if (start > 0 && text[start - 1] !== '\n') block = '\n' + block;
  if (end < text.length && text[end] !== '\n') block += '\n';

  e.preventDefault();
  insert(ta, block);
}
