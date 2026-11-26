// Intrinsic image sizes (naturalWidth/naturalHeight), cached per URL for the
// session so the Review Queue layout can plan around real image shapes
// without re-measuring. preloadImageDims() warms the cache for upcoming cards
// (the browser cache then serves the actual <img> without a second download).
import { useEffect, useState } from 'react';

const cache = new Map();      // url -> { w, h } | 'error'
const pending = new Map();    // url -> Promise
const CACHE_LIMIT = 500;

function measure(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (pending.has(url)) return pending.get(url);
  const p = new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve('error'); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : 'error');
    img.onerror = () => resolve('error');
    img.src = url;
  }).then((v) => {
    cache.set(url, v);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    pending.delete(url);
    return v;
  });
  pending.set(url, p);
  return p;
}

export function getCachedImageDims(url) {
  const v = cache.get(url);
  return v && v !== 'error' ? v : null;
}

export function preloadImageDims(urls) {
  for (const u of urls || []) if (u) measure(u);
}

/** Array aligned with `urls`: { w, h } once known, else null. */
export default function useImageDims(urls) {
  const key = (urls || []).join('\n');
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    const list = key ? key.split('\n') : [];
    const missing = list.filter(u => !cache.has(u));
    if (missing.length) Promise.all(missing.map(measure)).then(() => { if (alive) bump(n => n + 1); });
    return () => { alive = false; };
  }, [key]);
  return (urls || []).map(getCachedImageDims);
}
