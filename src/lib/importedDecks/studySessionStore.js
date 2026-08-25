// lib/importedDecks/studySessionStore.js
//
// Critical Bug Fix Batch 1 — persisted, resumable study-session state.
//
// ROOT CAUSE this exists to fix (see the diagnosis in StudySession.js's own
// comment for the full trace):
//
//   1. The active study session — which cards, in what order, and where the
//      user was in that order — lived ONLY in React component state, plus a
//      partial (idx/total only) sessionStorage snapshot. Normal mobile
//      lifecycle events (backgrounding for a notification/call, the device
//      sleeping, switching apps) can cause a mobile browser to discard and
//      later recreate the tab's whole JS context — sessionStorage's actual
//      contract ("top-level browsing context lifetime") is exactly the
//      ambiguous case that falls into on iOS Safari and some Android
//      browsers under memory pressure, so the one thing that WAS persisted
//      could vanish along with everything else.
//   2. Even when something survived, re-entering Study called
//      api.getSessionCards() again from scratch. That query has no stable
//      ORDER BY on its "new" portion and its "due" portion depends on the
//      current wall-clock time and today's already-studied counts — so two
//      calls minutes apart can legitimately return a different SET of
//      cards, not just a different order. The old restore logic only
//      checked `saved.total === cards.length` (an array-length sanity
//      check) before trusting a saved index — which says nothing about
//      whether card #3 in the freshly-fetched list is the SAME card #3 the
//      user was previously looking at. That's the actual mechanism behind
//      "reopening the deck shuffles the cards and starts over."
//
// FIX: once a session exists, its card ORDER is frozen — persisted as an
// ordered list of card ids (never full card payloads: a 50-card id list is
// a couple KB, nothing like the ~7,000-card deck itself). Resuming re-fetches
// CURRENT row data for exactly those ids (so flags/state/scheduling stay
// live) but never re-runs the query that built the set in the first place.
// getSessionCards()/getFavoriteCards() are only ever called once, at the
// moment a session is actually created — not on every remount.
//
// STORAGE CHOICE: localStorage, not sessionStorage — deliberately, since
// surviving exactly the mobile-lifecycle events above is the whole point,
// and localStorage's contract (persists for the origin regardless of tab/
// process lifecycle) is the one that actually holds up under them.
// Server-side (Supabase) persistence was considered and rejected for this
// fix: every reproduction case here is a same-device interruption, adding a
// migration + RLS policy + a round trip on every card advance would trade
// real complexity for a cross-device-sync capability nobody asked for here.
// Namespaced by userId (in the key itself, not just trusted from a prop) so
// a shared device can never resume a different signed-in user's session —
// see loadSession's own note on this.
//
// EXPIRATION: 24 hours. Long enough that "got interrupted, resumed a few
// hours later" (the whole point of this fix) always works; short enough
// that a session from days ago — whose due/new composition has since
// drifted far from what it was — doesn't get silently resurrected instead
// of a fresh, accurate one. loadSession() also opportunistically deletes an
// expired/completed entry the moment it's read, so old sessions don't just
// accumulate in localStorage forever.

const VERSION = 'v1';
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h — see the doc comment above

function sessionKey(userId, deckKey) {
  return `medbook_study_session_${VERSION}_${userId}_${deckKey}`;
}

/** A stable per-study-target key: real decks by id; Study Favorites by the
 *  fixed '__favorites__' marker PLUS onlyCardId when set, so "study every
 *  favorite" and "study just this one favorited card" never share a saved
 *  session (they used to collide under plain deck.id, a pre-existing but
 *  never-noticed bug — deck.id is '__favorites__' either way). */
export function deckKeyFor(deck) {
  if (!deck.isFavorites) return deck.id;
  return deck.onlyCardId ? `__favorites__:${deck.onlyCardId}` : '__favorites__';
}

export function newSessionId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns the saved session object, or null if none exists, it's expired,
 *  or it's already marked completed. Never throws — a corrupt/unreadable
 *  entry is treated the same as "no session", not a crash. */
export function loadSession(userId, deckKey) {
  if (!userId) return null;
  const k = sessionKey(userId, deckKey);
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
export function saveSession(userId, deckKey, session) {
  if (!userId) return;
  try {
    localStorage.setItem(sessionKey(userId, deckKey),
      JSON.stringify({ ...session, lastActiveAt: new Date().toISOString() }));
  } catch { /* localStorage full/unavailable (private mode) — session just won't survive a reload */ }
}

export function clearSession(userId, deckKey) {
  if (!userId) return;
  try { localStorage.removeItem(sessionKey(userId, deckKey)); } catch {}
}

/* ------------------------------------------------------------------ */
/* "What was I actively studying" — one small pointer per user, read at */
/* FlashCards' own mount so a reload lands back in the study session    */
/* instead of always booting to the Flashcards homepage. Deliberately   */
/* separate from the session object above: this is pure UI-navigation  */
/* state (which screen to show), not study data, and there's at most   */
/* one of these per user regardless of how many decks have their own   */
/* saved session.                                                       */
/* ------------------------------------------------------------------ */

function activeKey(userId) {
  return `medbook_active_study_${VERSION}_${userId}`;
}

export function loadActiveStudy(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(activeKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveActiveStudy(userId, pointer) {
  if (!userId) return;
  try { localStorage.setItem(activeKey(userId), JSON.stringify(pointer)); } catch {}
}

export function clearActiveStudy(userId) {
  if (!userId) return;
  try { localStorage.removeItem(activeKey(userId)); } catch {}
}
