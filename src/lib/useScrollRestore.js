import { useRef, useEffect, useCallback } from 'react';

/**
 * useScrollRestore
 *
 * Saves and restores the scroll position of a scrollable container
 * keyed by `key` (e.g. the active system name).
 *
 * Usage:
 *   const { scrollRef, saveScroll, restoreScroll } = useScrollRestore(activeSystem);
 *   <div ref={scrollRef} ...>
 *
 * Call saveScroll() before navigating away (e.g. when opening an entry).
 * Call restoreScroll() after returning (e.g. when view changes back to 'list').
 */
export function useScrollRestore() {
  const scrollRef   = useRef(null);
  const positions   = useRef({});  // { [key]: scrollTop }

  const saveScroll = useCallback((key) => {
    if (scrollRef.current && key) {
      positions.current[key] = scrollRef.current.scrollTop;
    }
  }, []);

  const restoreScroll = useCallback((key) => {
    if (scrollRef.current && key && positions.current[key] != null) {
      // Use requestAnimationFrame to wait for list render
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = positions.current[key];
        }
      });
    }
  }, []);

  return { scrollRef, saveScroll, restoreScroll };
}
