// lib/ratingOutbox.js
//
// Instant ratings / local-first sync — one shared durable queue used by
// every place a card or entry gets rated (Review Queue, SystemReview,
// DetailView's "mark reviewed", Imported Decks/Favorites/My Cards'
// StudySession). The whole point: tapping a rating never waits on the
// network. The caller computes the new schedule locally (the schedulers
// are plain JS), updates its own in-memory/session state and renders the
// next card in the SAME frame, then calls enqueueRating() — which is
// itself synchronous (a localStorage write) — and moves on. Everything
// network-related happens afterward, in the background, never awaited by
// the tap handler.
//
// STORAGE CHOICE — localStorage, not IndexedDB. A queued item is a few
// hundred bytes (scheduling fields + a uuid + a timestamp); even a 500-
// item offline backlog is ~150KB, nowhere near localStorage's limits.
// localStorage's write is synchronous, which is exactly what "never
// re-enters an async layer on the tap path" needs — IndexedDB's own API
// is asynchronous by design, which would buy nothing at these sizes while
// reintroducing exactly the kind of async indirection this feature exists
// to remove. This also matches the app's own existing precedent:
// studySessionStore.js already relies on synchronous localStorage writes
// for the same "must survive reload/kill" guarantee.
//
// IDEMPOTENCY — every item carries a client-generated uuid as `id`. For
// review_log/flashcard_review_log that id becomes the log row's own
// primary key (both already `uuid default gen_random_uuid()`, so a
// client-supplied value is accepted as-is); imported_review_log's `id` is
// a bigint sequence, so a separate `client_id uuid unique` column carries
// it instead (SUPABASE_MIGRATION_RATING_OUTBOX.sql). The server-side
// apply_*_ratings() functions insert with `ON CONFLICT (...) DO NOTHING`
// on that key — plain SQL inside the function body, not a supabase-js
// `.upsert(..., {onConflict, ignoreDuplicates})` call. See
// lib/media/MediaService.js's own documented history for why that
// specific client-level option is not trusted in this project: it looked
// correct and still produced a duplicate-key crash in production. A
// retry or a double flush of the same item is therefore always safe —
// at worst it's a wasted round trip, never a duplicate row.
//
// STALENESS PROTECTION — the matching state-table UPDATE inside each
// apply_*_ratings() function only applies when the incoming reviewed_at
// is strictly newer than what's already stored (or nothing is stored
// yet). An out-of-order replay (e.g. a backlog from another device, or a
// retry racing a newer rating that already landed) can never overwrite
// newer state with older state.

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

const VERSION = 'v1';
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

function storageKey(userId) {
  return `medbook_rating_outbox_${VERSION}_${userId}`;
}

function loadQueue(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveQueue(userId, queue) {
  if (!userId) return;
  try { localStorage.setItem(storageKey(userId), JSON.stringify(queue)); } catch { /* storage full/unavailable — a rating just won't survive a kill, same degraded mode as any other localStorage use in this app */ }
}

export function newRatingId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const RPC_BY_KIND = {
  entry: 'apply_entry_ratings',
  imported_card: 'apply_imported_card_ratings',
  own_card: 'apply_own_card_ratings',
};

// Per-user driver state — one tab studying as one user needs only one
// in-flight flush and one backoff timer, not one per call site.
const drivers = new Map(); // userId -> { flushing, pendingAgain, retryTimer, failCount, listeners }

function driverFor(userId) {
  if (!drivers.has(userId)) {
    drivers.set(userId, { flushing: false, pendingAgain: false, retryTimer: null, failCount: 0, listeners: new Set(), syncedListeners: new Set() });
  }
  return drivers.get(userId);
}

function notify(userId) {
  const d = driverFor(userId);
  if (!d.listeners.size) return;
  const status = { count: loadQueue(userId).length, failing: d.failCount > 0 }; // every queued item counts as "pending", undo included
  d.listeners.forEach(fn => { try { fn(status); } catch { /* a bad listener must never break the outbox */ } });
}

/** Subscribe to this user's pending-count/failing-state changes — the
 *  minimal UI indicator's (PendingSyncIndicator.js) only data source.
 *  Calls `fn` once immediately with the current `{ count, failing }`,
 *  then again on every enqueue/flush/retry. `failing` is true only once
 *  at least one flush attempt has actually failed (not merely "something
 *  is queued") — see PendingSyncIndicator.js for how that's combined with
 *  a "been pending a while" delay into section 6's "only when something
 *  is pending for a long time or failing." Returns an unsubscribe
 *  function. */
export function subscribePendingCount(userId, fn) {
  if (!userId) return () => {};
  const d = driverFor(userId);
  d.listeners.add(fn);
  fn({ count: loadQueue(userId).length, failing: d.failCount > 0 });
  return () => d.listeners.delete(fn);
}

export function getPendingCount(userId) {
  return loadQueue(userId).length;
}

/**
 * Notified with the actual outbox items (not the RPC wire shape) for `kind`
 * the moment a flush confirms them as applied server-side — never on mere
 * enqueue. Imported Decks' denormalized deck counts (total/new/due_cards
 * on imported_decks) can only be correctly recomputed once the server's
 * own imported_cards row reflects the rating, so StudySession.js uses this
 * (rather than the general pending-count listener above) to know exactly
 * when it's safe to re-run that rollup — see StudySession.js's own comment
 * at its call site. Returns an unsubscribe function.
 */
export function subscribeSynced(userId, kind, fn) {
  if (!userId) return () => {};
  const d = driverFor(userId);
  const entry = { kind, fn };
  d.syncedListeners.add(entry);
  return () => d.syncedListeners.delete(entry);
}

/** The still-queued (not yet synced) rating for this exact item, if any —
 *  what Undo checks first to decide "just drop it" vs "enqueue a
 *  correction". Never matches an undo item itself. */
export function getPendingRating(userId, kind, itemId) {
  return loadQueue(userId).find(it => it.kind === kind && it.itemId === itemId && !it.isUndo) || null;
}

/**
 * Append a rating (or an undo-correction — same shape, `isUndo: true`) to
 * the durable queue and kick the background flusher. Synchronous: this is
 * the only outbox call a tap handler ever makes, and it never blocks on
 * anything beyond a localStorage write.
 *
 * `item`: { id, kind, itemId, rating, reviewedAt, newFields, logFields,
 *           isUndo?, undoOf? } — see each call site for the exact
 * newFields/logFields shape its own table pair needs.
 */
export function enqueueRating(userId, item) {
  if (!userId) return;
  const queue = loadQueue(userId);
  queue.push(item);
  saveQueue(userId, queue);
  notify(userId);
  scheduleFlush(userId);
}

/** Undo of a rating that hasn't synced yet — drop it outright, no network
 *  call at all. Returns true if something was actually removed (the
 *  caller uses this to tell "it was local-only" apart from "it had
 *  already synced, go write a correction instead"). */
export function dropPendingRating(userId, kind, itemId) {
  if (!userId) return false;
  const queue = loadQueue(userId);
  const idx = queue.findIndex(it => it.kind === kind && it.itemId === itemId && !it.isUndo);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  saveQueue(userId, queue);
  notify(userId);
  return true;
}

function scheduleFlush(userId) {
  // Fire-and-forget — intentionally not returned/awaited by enqueueRating.
  // The .catch is belt-and-suspenders: flush() itself already catches
  // every rejection it can reach (see its own comment), but nothing here
  // may ever surface as an unhandled rejection regardless.
  Promise.resolve().then(() => flush(userId)).catch(() => {});
}

function toRpcItem(it) {
  return {
    id: it.id,
    item_id: it.itemId,
    rating: it.rating,
    reviewed_at: it.reviewedAt,
    new_fields: it.newFields || {},
    log_fields: it.logFields || {},
    is_undo: !!it.isUndo,
    undo_of: it.undoOf || null,
  };
}

/**
 * Drain whatever's currently queued, grouped by kind into one RPC call
 * per kind (the "prefer one batched request over one per rating" the
 * brief asks for) — never more than one flush cycle in flight at a time
 * per user; a new rating that arrives mid-flush just marks `pendingAgain`
 * so the NEXT cycle picks up everything accumulated since this one
 * started, rather than racing it.
 */
async function flush(userId) {
  if (!userId) return;
  const d = driverFor(userId);
  if (d.flushing) { d.pendingAgain = true; return; }
  d.flushing = true;
  try {
    const queue = loadQueue(userId);
    if (!queue.length) return;
    const byKind = {};
    queue.forEach(it => { (byKind[it.kind] ||= []).push(it); });

    const succeededIds = new Set();
    let anyFailed = false;
    for (const [kind, items] of Object.entries(byKind)) {
      const rpc = RPC_BY_KIND[kind];
      if (!rpc) continue; // unknown kind — never silently drop it, just skip this cycle
      // Genuinely offline (acceptance test 2) means the underlying fetch
      // itself rejects, not that supabase-js resolves with {error} — the
      // two look identical to every caller of flush() (same anyFailed/
      // retry-with-backoff path), but only a try/catch here catches the
      // first kind. Letting a rejection propagate out of this loop would
      // skip the retry scheduling below entirely, stranding the queue
      // with no automatic retry until some unrelated flush trigger
      // (another rating, a visibility change, app start) happened to
      // fire — found by this module's own test suite, not by inspection.
      let error;
      try {
        ({ error } = await supabase.rpc(rpc, { p_items: items.map(toRpcItem) }));
      } catch (e) {
        error = e;
      }
      if (error) {
        anyFailed = true;
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn(`[ratingOutbox] flush(${kind}) failed — has SUPABASE_MIGRATION_RATING_OUTBOX.sql been run?`, error.message);
        }
      } else {
        items.forEach(it => succeededIds.add(it.id));
        d.syncedListeners.forEach(({ kind: k, fn }) => {
          if (k !== kind) return;
          try { fn(items); } catch { /* a bad listener must never break the outbox */ }
        });
      }
    }
    if (succeededIds.size) {
      const remaining = loadQueue(userId).filter(it => !succeededIds.has(it.id));
      saveQueue(userId, remaining);
    }
    if (anyFailed) {
      d.failCount++;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (d.failCount - 1));
      clearTimeout(d.retryTimer);
      d.retryTimer = setTimeout(() => flush(userId), delay);
    } else {
      d.failCount = 0;
      clearTimeout(d.retryTimer);
    }
    // Always notify once per cycle (not just on success) — PendingSyncIndicator.js's
    // `failing` flag needs to flip on either edge: a fresh failure (0 -> 1)
    // and a recovery (back to 0) alike.
    notify(userId);
  } finally {
    d.flushing = false;
    if (d.pendingAgain) {
      d.pendingAgain = false;
      scheduleFlush(userId);
    }
  }
}

/** Explicit flush — session paused/completed, visibilitychange, app start.
 *  Fire-and-forget from every call site; nothing here is ever awaited by
 *  UI code (callers that want to know when it's done may await the
 *  returned promise themselves, but none of this feature's UI paths do). */
export function flushNow(userId) {
  return flush(userId);
}

/**
 * Merge still-queued (not yet synced) patches onto a freshly fetched
 * array of rows — section 5's "merge pending outbox items into what's
 * displayed" choice, applied consistently everywhere a fresh read could
 * otherwise show a just-rated card as if it had never been rated (a new
 * session's own composition query, folder/deck counts after a remount).
 * The LATEST queued item per itemId wins (the queue is oldest-first).
 * Undo items are included in that "latest wins" resolution too, since an
 * undo's own newFields is the restored pre-rating snapshot — exactly the
 * state a fresh read should show while it's still unsynced.
 */
export function mergeOutboxIntoRows(userId, kind, rows, idField = 'id') {
  const queue = loadQueue(userId).filter(it => it.kind === kind);
  if (!queue.length) return rows;
  const latestByItem = new Map();
  queue.forEach(it => latestByItem.set(it.itemId, it));
  return rows.map(row => {
    const pending = latestByItem.get(row[idField]);
    return pending ? { ...row, ...pending.newFields } : row;
  });
}

// ─── Teardown-safe flush (visibilitychange/pagehide) ───────────────────
//
// Mirrors useStudySession.js's own raw-fetch + keepalive pattern: a plain
// fetch (what the supabase-js client issues internally, including for
// .rpc()) can be silently cancelled mid-flight by the same navigation/
// close event that triggered it. `keepalive: true` is the browser's
// mechanism for "finish sending this even though the page is being torn
// down right now" — exactly the situation this is called from. Its ~64KB
// cap is COMBINED across all in-flight keepalive requests, so large
// queues are chunked well under that per request.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const KEEPALIVE_CHUNK_BYTES = 48 * 1024; // headroom under the 64KB combined cap

/**
 * Best-effort, fire-and-forget. Deliberately does NOT remove anything
 * from the queue — a keepalive request's response is never observed (the
 * tab may already be gone by the time it would arrive), so success can't
 * be confirmed here. The next normal flush (app start, or this same
 * driver if the tab actually survives) re-sends everything still queued;
 * server-side ON CONFLICT DO NOTHING makes re-sending an item that
 * already landed via keepalive a guaranteed no-op, never a duplicate.
 */
export function flushKeepalive(userId, accessToken) {
  if (!userId || !accessToken) return;
  const queue = loadQueue(userId);
  if (!queue.length) return;
  const byKind = {};
  queue.forEach(it => { (byKind[it.kind] ||= []).push(it); });

  Object.entries(byKind).forEach(([kind, items]) => {
    const rpc = RPC_BY_KIND[kind];
    if (!rpc) return;
    let chunk = [], chunkBytes = 0;
    const sendChunk = () => {
      if (!chunk.length) return;
      const body = JSON.stringify({ p_items: chunk.map(toRpcItem) });
      fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'return=minimal',
        },
        body,
      }).catch(() => { /* fire-and-forget, nothing to react to */ });
      chunk = []; chunkBytes = 0;
    };
    items.forEach(it => {
      const size = JSON.stringify(toRpcItem(it)).length;
      if (chunk.length && chunkBytes + size > KEEPALIVE_CHUNK_BYTES) sendChunk();
      chunk.push(it);
      chunkBytes += size;
    });
    sendChunk();
  });
}

/**
 * Mounted once, app-wide (same convention as useStudySession) — wires the
 * three safety nets that are never tied to any one study screen:
 *   - app start: flush whatever a previous session/kill left queued,
 *     before (in parallel with) anything else loads.
 *   - tab hidden (visibilitychange): a teardown-safe keepalive flush —
 *     Android discarding a backgrounded PWA tab is exactly the case this
 *     guards, same motivation as useStudySession.js's own flush-on-hide.
 *   - tab visible again: a normal flush, in case the keepalive send from
 *     last time either didn't go out or its outcome was never observed.
 * pagehide is belt-and-suspenders alongside visibilitychange, same
 * reasoning useStudySession.js's own comment gives: some mobile browsers
 * fire pagehide but not (or not promptly) visibilitychange.
 * Per-screen flush-on-pause/-complete is each call site's own job (a
 * plain flushNow(userId) call) — this hook only covers what no single
 * screen can see coming.
 */
export function useRatingOutboxSync(active, userId, accessToken) {
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  useEffect(() => {
    if (!active || !userId) return;
    flushNow(userId);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushKeepalive(userId, tokenRef.current);
      else flushNow(userId);
    };
    const onPageHide = () => flushKeepalive(userId, tokenRef.current);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [active, userId]);
}
