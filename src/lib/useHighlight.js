import { useState, useRef, useCallback } from 'react';
import { getTextareaSelection, adjustHighlights } from './highlights';

/**
 * useHighlight — manages highlights for a textarea ref.
 *
 * Returns:
 *   highlights     — array of { start, end, color }
 *   setHighlights  — direct setter
 *   hasSel         — bool, true when textarea has active selection
 *   onSelChange    — attach to onSelect / onMouseUp / onKeyUp / onTouchEnd
 *   applyHL        — call with HL_COLORS[i] to highlight current selection
 *   removeHL       — removes highlights overlapping current selection
 *   handleTextChange — call instead of setNotes so highlights adjust
 */
export function useHighlight(taRef, initialHighlights = []) {
  const [highlights, setHighlights] = useState(initialHighlights);
  const [hasSel, setHasSel]         = useState(false);
  const textRef                      = useRef(''); // tracks current text for adjustHighlights

  const onSelChange = useCallback(() => {
    const sel = getTextareaSelection(taRef.current);
    setHasSel(!!sel);
  }, [taRef]);

  const applyHL = useCallback((color) => {
    const sel = getTextareaSelection(taRef.current);
    if (!sel) return;
    setHighlights(prev => [...prev, { start: sel.start, end: sel.end, color }]);
    // Keep selection visible after applying
    // (browser may clear it — restore it)
    const ta = taRef.current;
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(sel.start, sel.end);
      });
    }
  }, [taRef]);

  const removeHL = useCallback(() => {
    const sel = getTextareaSelection(taRef.current);
    if (!sel) { setHighlights([]); return; }
    setHighlights(prev =>
      prev.filter(h => !(h.start < sel.end && h.end > sel.start))
    );
  }, [taRef]);

  const handleTextChange = useCallback((oldText, newText) => {
    textRef.current = newText;
    setHighlights(prev => adjustHighlights(oldText, newText, prev));
  }, []);

  return { highlights, setHighlights, hasSel, onSelChange, applyHL, removeHL, handleTextChange };
}
