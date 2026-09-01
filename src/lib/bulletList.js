// Bullet-list authoring helpers for a plain <textarea> (Review Notes).
//
// A native <textarea> keeps whatever's on the clipboard's plain-text
// flavour verbatim, and notes render with `white-space: pre-wrap` — so if
// the source's plain text already contains literal "•"/"-"/"*" characters,
// they show up exactly as copied with zero code. But most rich sources
// (Word, Google Docs, Notion, a webpage) represent a bullet list as real
// <li> markup and DON'T put a bullet character in their plain-text
// clipboard flavour at all — pasting from those gives you the list's text
// with no marker in sight. handleBulletPaste below reads the clipboard's
// HTML flavour instead and reconstructs "• " markers from the actual <li>
// structure, so lists come in bulleted the way they looked at the source.
//
// The rest of this file is the AUTHORING side: continuing a bullet on
// Enter, indenting a sub-bullet with Tab, and a one-click way to turn
// line(s) into bullets without typing the marker by hand.
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

// A <li>'s "own" text — everything inside it EXCEPT a nested <ul>/<ol>
// (those get walked separately as their own indented lines below), with
// whatever inline markup it contains (spans, bold, a Google-Docs-style
// wrapper <p> — Docs nests a <p> inside every <li>) flattened to plain text.
function liOwnText(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll('ul, ol').forEach(n => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

const BLOCK_TAGS = /^(p|div|h[1-6]|blockquote|section|article|li)$/;

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
      collectLines(child, depth, lines);
    } else if (BLOCK_TAGS.test(tag)) {
      if (child.querySelector('li')) {
        collectLines(child, depth, lines); // a wrapper div/p around a list
      } else {
        const t = child.textContent.replace(/\s+/g, ' ').trim();
        if (t) lines.push(t);
      }
    } else {
      collectLines(child, depth, lines); // inline wrapper (span/b/a/font/…)
    }
  }
}

/**
 * Paste handler — wire to a textarea's onPaste. Only intervenes when the
 * clipboard carries HTML with an actual <li> in it; anything else (plain
 * text, rich text with no lists) falls straight through to the browser's
 * normal paste, untouched.
 */
export function handleBulletPaste(e) {
  const html = e.clipboardData && e.clipboardData.getData('text/html');
  if (!html || !/<li[\s>]/i.test(html)) return;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines = [];
  collectLines(doc.body, 0, lines);
  if (lines.length === 0) return;

  const ta = e.target;
  const text = ta.value;
  const start = ta.selectionStart, end = ta.selectionEnd;
  let block = lines.join('\n');
  // Keep the pasted list on its own line(s) instead of fusing into
  // whatever text sits right before/after the cursor — without this,
  // pasting a list mid-sentence runs the last item straight into the
  // following text ("• Yafter") instead of a new line ("• Y\nafter").
  if (start > 0 && text[start - 1] !== '\n') block = '\n' + block;
  if (end < text.length && text[end] !== '\n') block += '\n';

  e.preventDefault();
  insert(ta, block);
}
