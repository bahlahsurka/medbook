// lib/reviewSessionStore.js
//
// Persisted, resumable review sessions for Review Queue and System Review —
// the same fix importedDecks/studySessionStore.js already applied to
// imported-deck study sessions (see that file's own header comment for the
// full root-cause writeup), ported here because these two screens had the
// exact same gap: queue/idx/elapsed-time lived ONLY in React component
// state, so backgrounding the app for a notification/call, the device
// sleeping, or switching apps on mobile — any of which can make a mobile
// browser discard and later recreate the tab's whole JS context — silently
// threw the entire in-progress session away.
//
// Unlike imported decks, MedBook's own entries are never re-fetched here:
// `allEntries`/`entries` is already the single live in-memory source of
// truth both review screens read from (kept current by the same
// onReviewed() callback that already updates it after every rating), so
// resuming just re-maps the session's frozen, ordered list of entry ids
// back onto whatever's currently there — dropping any id that's since been
// deleted — instead of a second network round trip.
//
// STORAGE/EXPIRATION/KEYING choices mirror studySessionStore.js exactly —
// see that file's header comment for the reasoning, which applies here
// unchanged: localStorage (not sessionStorage) because surviving exactly
// the mobile-lifecycle events above is the whole point; 24h expiry so a
// session from days ago — whose due/new composition has since drifted far
// from what it was — doesn't get silently resurrected instead of a fresh,
// accurate one; namespaced by userId (in the key itself) so a shared
// device can never resume a different signed-in user's session.
//
// `scope` distinguishes the two callers under one shared key format:
// ReviewQueue.js always uses the fixed scope 'queue' (one global session),
// SystemReview.js uses `system:<system name>` (one independent session per
// system, since its modal can be opened for any system at any time).

const VERSION = 'v1';
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h — see the doc comment above

function sessionKey(userId, scope) {
  return `medbook_review_session_${VERSION}_${userId}_${scope}`;
}

export function newSessionId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns the saved session object, or null if none exists, it's expired,
 *  or it's already marked completed. Never throws — a corrupt/unreadable
 *  entry is treated the same as "no session", not a crash. */
export function loadSession(userId, scope) {
  if (!userId) return null;
  const k = sessionKey(userId, scope);
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const stale = !s || s.status === 'completed'
      || (Date.now() - new Date(s.lastActiveAt || 0).getTime() > EXPIRY_MS);
    if (stale) { localStorage.removeItem(k); return null; }
    return s;
  } catch { return null; }
}

/** Write (or overwrite) the session. `lastActiveAt` is always stamped here,
 *  not left to the caller — every write IS "activity", by definition. */
export function saveSession(userId, scope, session) {
  if (!userId) return;
  try {
    localStorage.setItem(sessionKey(userId, scope),
      JSON.stringify({ ...session, lastActiveAt: new Date().toISOString() }));
  } catch { /* localStorage full/unavailable (private mode) — session just won't survive a reload */ }
}

export function clearSession(userId, scope) {
  if (!userId) return;
  try { localStorage.removeItem(sessionKey(userId, scope)); } catch {}
}
