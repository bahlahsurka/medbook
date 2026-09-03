// lib/importedDecks/pendingImport.js
//
// Durable stash for a picked-but-not-yet-uploaded .apkg file — the same
// "mobile lifecycle can discard the whole JS context" problem
// studySessionStore.js already documents and fixes for study sessions,
// showing up one step earlier in the Import flow.
//
// Reported concretely: on an Android tablet, picking a .apkg from the file
// picker made the tab go blank and come back with no state — no error, just
// a silent reload — and it happened again on the very next attempt, because
// re-picking the file walks straight back through the same moment that got
// it discarded. Without somewhere durable to land, EVERY attempt to import
// starts back at zero.
//
// IndexedDB, not localStorage, because it's the one browser storage that
// can hold a File/Blob object directly via structured clone — no need to
// read the whole file into a data URL first (which would mean doing exactly
// the kind of full-file, memory-heavy read this fix exists to avoid).
//
// TIMING: the very first save() attempt reported the crash as happening
// "immediately" after the file was chosen — before an interval-based or
// effect-scheduled save would even get a chance to run. Two things here are
// aimed squarely at that window:
//   1. warmPendingImportDB() opens (and caches) the IndexedDB connection
//      proactively, on mount, well before any file is picked — so the
//      actual save at pick time is just a transaction + put, not also an
//      open()/onupgradeneeded round trip.
//   2. The caller (ImportWizard's pickFile) fires savePendingImport()
//      synchronously in the SAME event-handler tick as the picker's change
//      event, not from a useEffect — an effect only runs after React
//      commits and paints, which is exactly the extra delay that isn't
//      affordable if the tab can be discarded this fast.
//
// One record per user, always overwritten — a single in-flight "did you
// mean to finish importing this?" slot, not a history. Namespaced by userId
// so a shared device never resurfaces a different signed-in user's pick.

const DB_NAME = 'medbook_pending_import';
const STORE = 'files';
const VERSION = 1;
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h — same window studySessionStore.js uses

// Cached across calls (and reused by warmPendingImportDB) so a save at pick
// time never pays for opening the connection from scratch.
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // A failed open shouldn't wedge every future call into rejecting forever —
  // clear the cache so the next call gets a fresh attempt.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** Open (and cache) the IndexedDB connection ahead of time. Call this once,
 *  as early as convenient (e.g. on mount) — see the TIMING note above for
 *  why the connection being ready in advance is what actually matters. */
export function warmPendingImportDB() {
  openDB().catch(() => {});
}

/** Stash the picked file the instant it's chosen — well before Start Import
 *  is even tapped, since that's exactly when it's been observed getting
 *  discarded. Best-effort: storage being full/unavailable (private
 *  browsing) never blocks the actual import, it just means this particular
 *  attempt won't be recoverable if interrupted. */
export async function savePendingImport(userId, { file, importMedia }) {
  if (!userId) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ file, importMedia, savedAt: Date.now() }, userId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best-effort */ }
}

/** Returns { file, importMedia } for this user, or null if there's nothing
 *  stashed or it's stale. Opportunistically clears an expired entry the
 *  moment it's read, same as studySessionStore.loadSession. Never throws —
 *  a corrupt/unreadable entry is treated the same as "nothing stashed". */
export async function loadPendingImport(userId) {
  if (!userId) return null;
  try {
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    if (Date.now() - (record.savedAt || 0) > EXPIRY_MS) { clearPendingImport(userId); return null; }
    return record;
  } catch { return null; }
}

export async function clearPendingImport(userId) {
  if (!userId) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(userId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best-effort */ }
}
