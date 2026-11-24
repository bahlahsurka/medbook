// Universal text zoom (the magnifier in the app's top bar).
//
// The zoom multiplies the app-wide text scale: every inline font size is
// calc(Npx * var(--mb-fs)) (see fs() in lib/theme.js), and public/index.html
// defines --mb-fs = --mb-fs-base (per screen size) × --mb-zoom (this file).
// So zooming scales the text of every component the same way, while images,
// diagrams and page layouts stay intact.
//
// The choice is saved to the signed-in user's account (Supabase auth
// user_metadata.ui_zoom — no table or migration) so it follows them to every
// device, and cached in localStorage so it applies instantly on load, before
// the session is known.
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

export const ZOOM_STEPS = [0.9, 1, 1.1, 1.25, 1.4, 1.5];
export const DEFAULT_ZOOM = 1;
const STORAGE_KEY = 'medbook_ui_zoom';
const META_KEY = 'ui_zoom';
const SYNC_DELAY_MS = 600;

/** Snap any value to the nearest allowed step (bad input → 100%). */
export function normalizeZoom(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return DEFAULT_ZOOM;
  return ZOOM_STEPS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), DEFAULT_ZOOM);
}

function readCached() {
  try { return normalizeZoom(localStorage.getItem(STORAGE_KEY)); } catch { return DEFAULT_ZOOM; }
}

let zoom = readCached();
const listeners = new Set();
let syncTimer = null;

function applyToDocument() {
  try { document.documentElement.style.setProperty('--mb-zoom', String(zoom)); } catch { /* no DOM */ }
}
applyToDocument();

function setLocal(next) {
  zoom = next;
  try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* storage blocked */ }
  applyToDocument();
  listeners.forEach(fn => { try { fn(); } catch { /* listener errors are not ours */ } });
}

function scheduleAccountSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) return; // signed out: the device cache is enough
      await supabase.auth.updateUser({ data: { [META_KEY]: zoom } });
    } catch { /* offline etc. — the device keeps it; next change retries */ }
  }, SYNC_DELAY_MS);
}

export function getZoom() { return zoom; }

/** Set the zoom (snapped to a step), apply it, cache it, and sync it to the account. */
export function setZoom(value) {
  const next = normalizeZoom(value);
  if (next === zoom) return;
  setLocal(next);
  scheduleAccountSync();
}

export function zoomIn() {
  const i = ZOOM_STEPS.indexOf(zoom);
  if (i < ZOOM_STEPS.length - 1) setZoom(ZOOM_STEPS[i + 1]);
}

export function zoomOut() {
  const i = ZOOM_STEPS.indexOf(zoom);
  if (i > 0) setZoom(ZOOM_STEPS[i - 1]);
}

export function resetZoom() { setZoom(DEFAULT_ZOOM); }

/**
 * Adopt the zoom saved on the account (called whenever the session/user
 * changes). A change made on this device that hasn't been sent yet wins;
 * an account with no saved zoom leaves this device's choice as it is.
 */
export function syncZoomFromUser(user) {
  const saved = user?.user_metadata?.[META_KEY];
  if (saved === undefined || saved === null || syncTimer) return;
  const next = normalizeZoom(saved);
  if (next !== zoom) setLocal(next);
}

export function useUiZoom() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getZoom,
    getZoom,
  );
}
