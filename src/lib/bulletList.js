// Bullet-list authoring helpers for a plain <textarea> (Review Notes).
//
// Pasting already works with zero code here: a native <textarea> keeps
// whatever characters were on the clipboard verbatim (including "•"/"-"/"*"
// bullets copied from elsewhere), and every notes display already renders
// with `white-space: pre-wrap`, so pasted bullets and line breaks show up
// exactly as copied. What's missing is the AUTHORING side — continuing a
// bullet on Enter, indenting a sub-bullet with Tab, and a one-click way to
// turn line(s) into bullets without typing the marker by hand.
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
