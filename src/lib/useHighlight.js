import { useState, useCallback } from 'react';
import { adjustHighlights, matchHighlightShortcutEditing, markedTextToHtml } from './highlights';
import { inlineTextWithMarks, locateInMarkedText, domPositionAt } from './bulletList';

/**
 * Remove any part of existing highlights that overlaps [start,end).
 * Splits a highlight in two if the new range sits inside it.
 * This is what makes re-highlighting a range with a NEW colour actually work.
 */
export function clearRange(highlights, start, end) {
  const out = [];
  for (const h of highlights) {
    if (h.end <= start || h.start >= end) { out.push(h); continue; } // no overlap
    if (h.start < start) out.push({ ...h, end: start });             // keep left part
    if (h.end > end)     out.push({ ...h, start: end });             // keep right part
    // fully covered -> dropped
  }
  return out.filter(h => h.end > h.start);
}

// Reads the current DOM selection as marker-string offsets — the Review
// Notes editor is a contentEditable div showing rendered (marker-stripped)
// content, same as the read-only view, so a raw window.getSelection() Range
// has to be translated via locateInMarkedText the same way DetailView.js's
// view-mode capture does, or an applied highlight lands on the wrong text
// the moment it's replayed against the raw stored string (see the
// highlight-offset bug this exact mapping fixed, in DetailView.js).
function getEditableSelection(root) {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const a = locateInMarkedText(root, range.startContainer, range.startOffset);
  const b = locateInMarkedText(root, range.endContainer, range.endOffset);
  if (a == null || b == null || a === b) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

// Rebuilds root's DOM content from the current marker-string + highlights
// (markedTextToHtml — the SAME conversion the editor's initial render and
// RenderedNotes/RichRuns.js use everywhere else) and restores a collapsed
// caret at `caretAt` (a raw marker-string offset) afterward. Only called
// right after a highlight is applied/removed/cleared — a discrete,
// infrequent action, not on every keystroke — so this brief rebuild is an
// acceptable, standard tradeoff for guaranteeing the DOM's highlight
// colouring always matches the highlights array exactly, rather than
// trying to patch styling into the live DOM in place. Deferred a frame,
// same as the original textarea version's own selection-collapse: doing
// it immediately left a mobile OS's "Copy/Select All" bubble lingering
// over the (now stale) old selection.
function rebuild(root, notes, highlights, theme, caretAt) {
  requestAnimationFrame(() => {
    if (!root) return;
    root.innerHTML = markedTextToHtml(notes, highlights, theme.textColor, theme.isDark);
    root.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const { node, offset } = domPositionAt(root, caretAt);
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

/**
 * useHighlight — manages highlights for the Review Notes contentEditable
 * (`rootRef`). `theme` is `{ textColor, isDark }` — needed only to rebuild
 * the editor's DOM with correctly-coloured highlights after apply/remove/
 * clear; nothing else here depends on it.
 */
export function useHighlight(rootRef, initialHighlights = [], theme) {
  const [highlights, setHighlights] = useState(initialHighlights);
  const [hasSel, setHasSel]         = useState(false);

  const onSelChange = useCallback(() => {
    setHasSel(!!getEditableSelection(rootRef.current));
  }, [rootRef]);

  const applyHL = useCallback((color) => {
    const root = rootRef.current;
    const sel = getEditableSelection(root);
    if (!sel) return;
    // Clear whatever was under the selection first, so applying a second
    // colour REPLACES the old one instead of being hidden behind it (and
    // so the array can't grow without bound).
    const cleared = clearRange(highlights, sel.start, sel.end);
    const next = [...cleared, { start: sel.start, end: sel.end, color }].sort((a, b) => a.start - b.start);
    rebuild(root, inlineTextWithMarks(root), next, theme, sel.end);
    setHighlights(next);
  }, [rootRef, theme, highlights]);

  const removeHL = useCallback(() => {
    const root = rootRef.current;
    const sel = getEditableSelection(root);
    // NO SELECTION => do nothing. Previously this wiped every highlight in the
    // entry with no warning, which was easy to trigger by accident.
    if (!sel) return;
    const next = clearRange(highlights, sel.start, sel.end);
    rebuild(root, inlineTextWithMarks(root), next, theme, sel.end);
    setHighlights(next);
  }, [rootRef, theme, highlights]);

  /** Explicit, deliberate "remove every highlight" — requires confirmation. */
  const clearAllHL = useCallback(() => {
    if (highlights.length === 0) return;
    if (!window.confirm(`Remove all ${highlights.length} highlight${highlights.length !== 1 ? 's' : ''}?`)) return;
    const root = rootRef.current;
    if (root) {
      const notes = inlineTextWithMarks(root);
      rebuild(root, notes, [], theme, notes.length);
    }
    setHighlights([]);
  }, [rootRef, theme, highlights]);

  const handleTextChange = useCallback((oldText, newText) => {
    setHighlights(prev => adjustHighlights(oldText, newText, prev));
  }, []);

  // Ready to wire straight to the editable's onKeyDown (compose with
  // handleBulletKeyDown the same way the editor already composes its
  // other keydown behaviour — see AddEntry/DetailView). A no-op, un-
  // prevented keydown whenever the chord doesn't match, exactly like
  // handleBulletKeyDown's own "not my key, don't touch it" contract.
  const handleShortcut = useCallback((e) => {
    const m = matchHighlightShortcutEditing(e);
    if (!m) return;
    e.preventDefault();
    if (m.remove) removeHL(); else applyHL(m.color);
  }, [applyHL, removeHL]);

  return { highlights, setHighlights, hasSel, onSelChange, applyHL, removeHL, clearAllHL, handleTextChange, handleShortcut };
}
