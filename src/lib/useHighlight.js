import { useState, useRef, useCallback } from 'react';
import { getTextareaSelection, adjustHighlights } from './highlights';

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

/**
 * useHighlight — manages highlights for a textarea ref.
 */
export function useHighlight(taRef, initialHighlights = []) {
  const [highlights, setHighlights] = useState(initialHighlights);
  const [hasSel, setHasSel]         = useState(false);
  const textRef                      = useRef('');

  const onSelChange = useCallback(() => {
    const sel = getTextareaSelection(taRef.current);
    setHasSel(!!sel);
  }, [taRef]);

  const applyHL = useCallback((color) => {
    const sel = getTextareaSelection(taRef.current);
    if (!sel) return;
    setHighlights(prev => {
      // Clear whatever was under the selection first, so applying a second
      // colour REPLACES the old one instead of being hidden behind it
      // (and so the array can't grow without bound).
      const cleared = clearRange(prev, sel.start, sel.end);
      return [...cleared, { start: sel.start, end: sel.end, color }]
        .sort((a, b) => a.start - b.start);
    });
    const ta = taRef.current;
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus();
        // Collapse the selection (don't re-select). Re-selecting kept the OS
        // "Copy / Select all" bubble up and left the text visibly highlighted-blue
        // after applying a colour — which looked like the tool was stuck.
        const end = sel.end;
        ta.setSelectionRange(end, end);
      });
    }
  }, [taRef]);

  const removeHL = useCallback(() => {
    const sel = getTextareaSelection(taRef.current);
    // NO SELECTION => do nothing. Previously this wiped every highlight in the
    // entry with no warning, which was easy to trigger by accident.
    if (!sel) return;
    setHighlights(prev => clearRange(prev, sel.start, sel.end));
  }, [taRef]);

  /** Explicit, deliberate "remove every highlight" — requires confirmation. */
  const clearAllHL = useCallback(() => {
    setHighlights(prev => {
      if (prev.length === 0) return prev;
      if (!window.confirm(`Remove all ${prev.length} highlight${prev.length !== 1 ? 's' : ''}?`)) return prev;
      return [];
    });
  }, []);

  const handleTextChange = useCallback((oldText, newText) => {
    textRef.current = newText;
    setHighlights(prev => adjustHighlights(oldText, newText, prev));
  }, []);

  return { highlights, setHighlights, hasSel, onSelChange, applyHL, removeHL, clearAllHL, handleTextChange };
}
