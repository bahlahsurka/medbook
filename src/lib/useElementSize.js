import { useLayoutEffect, useState } from 'react';

// Live content width of an element (follows sidebar open/close, window
// resizes, etc.). Measured in a layout effect so the first paint already
// uses the real width. Falls back to the window width where layout isn't
// available (e.g. tests).
export function useElementWidth(el) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const read = () => {
      const w = Math.round(el.getBoundingClientRect().width || el.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0));
      setWidth(prev => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

export function useViewportHeight() {
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useLayoutEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}
