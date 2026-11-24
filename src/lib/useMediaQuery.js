import { useSyncExternalStore } from 'react';

// Live boolean for a CSS media query (e.g. '(min-width: 1024px)').
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener ? mql.addEventListener('change', onChange) : mql.addListener(onChange);
      return () => (mql.removeEventListener ? mql.removeEventListener('change', onChange) : mql.removeListener(onChange));
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches),
    () => false,
  );
}
