import { useEffect } from 'react';

/**
 * Watches the service worker public/index.html already registers (outside
 * React, as early as possible) for a new version finishing its install, and
 * calls `onUpdateReady` once when that happens.
 *
 * Why this matters: public/sw.js caches the JS bundle cache-first by its
 * exact hashed filename, so a fresh deploy's new bundle is only ever
 * fetched once a NEW page load asks for it. A tab/PWA left open for a long
 * study session — exactly how this app is meant to be used — keeps running
 * whatever bundle was in memory when it was last opened, indefinitely, with
 * nothing visibly wrong (Supabase calls still work fine) even though a
 * newer version, possibly with real bug fixes, is one reload away. This
 * surfaces that instead of leaving it silent — confirmed as a real source
 * of confusion during this app's own recent bug-fix rounds, where a report
 * of "still broken" turned out to be a stale, pre-fix bundle still running.
 */
export function useServiceWorkerUpdate(onUpdateReady) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;

    const notifyOnInstalled = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // 'installed' + an existing controller means a new version finished
        // installing ALONGSIDE the one already running this page — a real
        // update. The very first install (no page controlled yet) also
        // reaches 'installed', but there's nothing to prompt a reload for.
        if (worker.state === 'installed' && navigator.serviceWorker.controller && !cancelled) {
          onUpdateReady?.();
        }
      });
    };

    const watch = (reg) => {
      if (!reg) return;
      // A new worker may already be sitting there waiting (e.g. this tab
      // was backgrounded through an update cycle) — not just one that
      // installs while we're watching.
      if (reg.waiting && navigator.serviceWorker.controller) { onUpdateReady?.(); return; }
      notifyOnInstalled(reg.installing);
      reg.addEventListener('updatefound', () => notifyOnInstalled(reg.installing));
    };

    if (window.__medbookSWReg) watch(window.__medbookSWReg);
    else navigator.serviceWorker.getRegistration().then(reg => { if (!cancelled) watch(reg); }).catch(() => {});

    return () => { cancelled = true; };
  }, [onUpdateReady]);
}
