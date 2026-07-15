import { useState, useEffect } from 'react';

/**
 * useDebouncedValue — returns `value` only after it has stopped changing for
 * `delay` ms. Used so the search box stays instantly responsive to typing while
 * the expensive filtering over hundreds of entries runs at most once per pause.
 */
export function useDebouncedValue(value, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
