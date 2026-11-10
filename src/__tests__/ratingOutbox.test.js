// Instant ratings / local-first sync (lib/ratingOutbox.js) — covers the
// acceptance tests from the brief that are reachable without a live
// Supabase project: offline queuing + reconnect delivery, a kill/reopen
// (localStorage survives this process exiting — nothing here needs to
// simulate the process boundary itself, just that nothing but a
// successful flush ever removes a queued item), never more than one
// flush in flight at a time (serialization + batching under load), and
// the section-5 overlay/undo helpers. Mocks `../lib/supabase` entirely —
// this module's only network surface is `supabase.rpc()` — so none of
// this depends on real Supabase credentials.
import {
  enqueueRating, newRatingId, flushNow, getPendingCount, getPendingRating,
  dropPendingRating, mergeOutboxIntoRows, subscribePendingCount, subscribeSynced,
  flushKeepalive,
} from '../lib/ratingOutbox';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

// Each test gets its own userId rather than sharing one 'user-1' constant.
// ratingOutbox.js keeps a module-level `drivers` Map keyed by userId that
// outlives any one test (by design — it's what makes one in-flight flush
// per user real across the whole app) — sharing a userId across tests
// would let one test's unresolved mock promise (several below use
// `new Promise(() => {})` to model "still in flight") leave that driver's
// `flushing` flag stuck forever, silently short-circuiting every later
// test's own flush() calls. A fresh userId per test is complete isolation
// without needing to reach into (or reset) that internal state.
let USER;
beforeEach(() => { USER = `user-${Math.random().toString(36).slice(2)}`; });

function flushMicrotasks() { return new Promise(r => setTimeout(r, 0)); }

// Polls flushMicrotasks() until the outbox drains (or a sane cap), so
// these tests don't depend on guessing exactly how many microtask/
// macrotask ticks a particular chain of chained flush() calls needs.
async function waitUntilDrained(userId, { getPendingCount: getCount }) {
  for (let i = 0; i < 20 && getCount(userId) > 0; i++) await flushMicrotasks();
}

function makeItem(itemId, rating = 'good', overrides = {}) {
  return {
    id: newRatingId(),
    kind: 'entry',
    itemId,
    rating,
    reviewedAt: new Date().toISOString(),
    newFields: { review_count: 1 },
    logFields: { system: 'Cardiology' },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  supabase.rpc.mockReset();
});

// Several tests below deliberately exercise flush()'s failure path, which
// logs via console.warn outside production — expected noise from this
// suite's own design, not something to silence a real bug.
let warnSpy;
beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe('enqueueRating / getPendingCount — durable, synchronous queue', () => {
  test('a rating survives being read back without any network call', () => {
    supabase.rpc.mockReturnValue(new Promise(() => {})); // never resolves — flush must not block this assertion
    enqueueRating(USER, makeItem('card-1'));
    expect(getPendingCount(USER)).toBe(1);
    expect(getPendingRating(USER, 'entry', 'card-1')).toBeTruthy();
  });

  test('newRatingId never collides across 1000 calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRatingId()));
    expect(ids.size).toBe(1000);
  });
});

describe('acceptance test 2 — offline queue, reconnect delivers all, no duplicates', () => {
  test('15 ratings made while offline all flush in one batched RPC call once back online', async () => {
    // Sustained offline, not just one failed attempt: supabase-js's own
    // `.rpc()` rejects outright on a real connectivity failure (as
    // opposed to resolving with a PostgREST-shaped {error}) — this is
    // exactly the case flush()'s try/catch around the rpc call exists
    // for (see its own comment).
    supabase.rpc.mockRejectedValue(new Error('network unreachable'));
    for (let i = 0; i < 15; i++) enqueueRating(USER, makeItem(`card-${i}`));
    await flushMicrotasks(); // lets the failing attempt(s) run their course
    await flushMicrotasks();
    expect(getPendingCount(USER)).toBe(15); // nothing lost while offline

    supabase.rpc.mockReset();
    supabase.rpc.mockResolvedValue({ error: null }); // "reconnected" — mockReset also clears the failed-attempt call history, isolating this assertion to just the reconnect flush
    await flushNow(USER);
    await flushMicrotasks();

    expect(getPendingCount(USER)).toBe(0);
    const calls = supabase.rpc.mock.calls.filter(c => c[0] === 'apply_entry_ratings');
    expect(calls).toHaveLength(1); // one batched request, not 15
    expect(calls[0][1].p_items).toHaveLength(15);
    const ids = calls[0][1].p_items.map(it => it.item_id);
    expect(new Set(ids).size).toBe(15); // every card present exactly once
  });
});

describe('acceptance test 3 — kill test: nothing is removed except on a confirmed success', () => {
  test('a rating stays queued across a simulated kill (module re-import) until it actually syncs', async () => {
    supabase.rpc.mockReturnValue(new Promise(() => {})); // in flight, never resolves before "kill"
    enqueueRating(USER, makeItem('card-x'));
    await flushMicrotasks();
    expect(getPendingCount(USER)).toBe(1);

    // "Kill": nothing but localStorage survives. Re-requiring the module
    // (with a fresh supabase mock, since a real app restart gets a fresh
    // client too) simulates a fresh app start reading whatever's still on
    // disk.
    jest.resetModules();
    jest.doMock('../lib/supabase', () => ({ supabase: { rpc: jest.fn().mockResolvedValue({ error: null }) } }));
    const fresh = require('../lib/ratingOutbox');
    expect(fresh.getPendingCount(USER)).toBe(1); // the rating was never lost

    await fresh.flushNow(USER);
    await flushMicrotasks();
    expect(fresh.getPendingCount(USER)).toBe(0); // exactly one successful flush clears it
  });
});

describe('acceptance test 4 — double flush never duplicates', () => {
  test('forcing the same batch to flush twice sends the identical item id both times (server ON CONFLICT DO NOTHING is what dedups it — see SUPABASE_MIGRATION_RATING_OUTBOX.sql)', async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    const item = makeItem('card-dup');
    enqueueRating(USER, item);
    await flushMicrotasks(); // first send succeeds, removed from the queue

    // A second flush after the queue is already empty is a client-side
    // no-op — forcing the actual double-send means re-queuing the exact
    // same item (same id), which is the real "same batch sent twice"
    // scenario a retry/backoff double-flush would also produce.
    enqueueRating(USER, item);
    await flushMicrotasks();

    const sentIds = supabase.rpc.mock.calls
      .filter(c => c[0] === 'apply_entry_ratings')
      .flatMap(c => c[1].p_items.map(it => it.id));
    expect(sentIds).toEqual([item.id, item.id]); // identical id both times — exactly what ON CONFLICT (id) DO NOTHING needs to collapse to one row
  });
});

describe('acceptance test 6 — rapid skim: serialized, batched, never one request per rating', () => {
  test('30 ratings enqueued while a flush is in flight go out as a bounded number of batches, in order, each exactly once', async () => {
    let resolveFirst;
    supabase.rpc.mockImplementationOnce(() => new Promise(res => { resolveFirst = res; }));
    supabase.rpc.mockResolvedValue({ error: null });

    enqueueRating(USER, makeItem('card-0')); // kicks off the first (slow) flush
    await flushMicrotasks();

    // The rest land while that first RPC call is still in flight.
    for (let i = 1; i < 30; i++) enqueueRating(USER, makeItem(`card-${i}`));
    await flushMicrotasks();

    resolveFirst({ error: null }); // first batch (just card-0) now succeeds
    await waitUntilDrained(USER, { getPendingCount }); // let the pendingAgain-triggered second cycle run

    expect(getPendingCount(USER)).toBe(0);
    const calls = supabase.rpc.mock.calls.filter(c => c[0] === 'apply_entry_ratings');
    // Not 30 separate requests — the in-flight one, plus everything that
    // piled up behind it going out together as the next cycle's batch.
    expect(calls.length).toBeLessThan(5);
    const allIds = calls.flatMap(c => c[1].p_items.map(it => it.item_id));
    expect(allIds).toHaveLength(30);
    expect(new Set(allIds).size).toBe(30); // each card exactly once, none skipped or doubled
  });
});

describe('section 5 — merge pending outbox items into what\'s displayed', () => {
  test('a still-unsynced rating overlays onto a freshly fetched row', () => {
    enqueueRating(USER, { ...makeItem('card-7'), newFields: { review_count: 3, next_review: '2030-01-01' } });
    const serverRows = [{ id: 'card-7', review_count: 0, next_review: null }, { id: 'card-8', review_count: 5 }];
    const merged = mergeOutboxIntoRows(USER, 'entry', serverRows, 'id');
    expect(merged.find(r => r.id === 'card-7')).toEqual({ id: 'card-7', review_count: 3, next_review: '2030-01-01' });
    expect(merged.find(r => r.id === 'card-8')).toEqual({ id: 'card-8', review_count: 5 }); // untouched — nothing queued for it
  });

  test('the latest of two queued ratings for the same item wins', () => {
    enqueueRating(USER, { ...makeItem('card-9'), newFields: { review_count: 1 } });
    enqueueRating(USER, { ...makeItem('card-9'), newFields: { review_count: 2 } });
    const merged = mergeOutboxIntoRows(USER, 'entry', [{ id: 'card-9', review_count: 0 }], 'id');
    expect(merged[0].review_count).toBe(2);
  });
});

describe('undo — drop if unsynced, else the caller enqueues a correction', () => {
  test('dropPendingRating removes an unsynced rating with zero network call', async () => {
    supabase.rpc.mockReturnValue(new Promise(() => {}));
    const item = makeItem('card-undo');
    enqueueRating(USER, item);
    expect(getPendingRating(USER, 'entry', 'card-undo').id).toBe(item.id);
    const dropped = dropPendingRating(USER, 'entry', 'card-undo');
    expect(dropped).toBe(true);
    expect(getPendingCount(USER)).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('dropPendingRating is a no-op (returns false) once the rating already synced', async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    enqueueRating(USER, makeItem('card-synced'));
    await flushNow(USER);
    await flushMicrotasks();
    expect(getPendingRating(USER, 'entry', 'card-synced')).toBeNull();
    expect(dropPendingRating(USER, 'entry', 'card-synced')).toBe(false);
  });
});

describe('subscribePendingCount — the minimal indicator\'s only data source', () => {
  test('reports count immediately, then again on enqueue/flush, and flags `failing` only after an actual failure', async () => {
    const seen = [];
    const unsub = subscribePendingCount(USER, s => seen.push({ ...s }));
    expect(seen[0]).toEqual({ count: 0, failing: false });

    supabase.rpc.mockRejectedValueOnce(new Error('offline'));
    enqueueRating(USER, makeItem('card-f'));
    await flushMicrotasks();
    expect(seen.some(s => s.count === 1 && s.failing)).toBe(true);

    supabase.rpc.mockResolvedValue({ error: null });
    await flushNow(USER);
    await flushMicrotasks();
    expect(seen[seen.length - 1]).toEqual({ count: 0, failing: false });
    unsub();
  });
});

describe('subscribeSynced — Imported Decks\' deck-count refresh trigger', () => {
  test('fires only on confirmed sync for the matching kind, with the real outbox items (not the RPC wire shape)', async () => {
    supabase.rpc.mockResolvedValue({ error: null });
    const synced = [];
    const unsub = subscribeSynced(USER, 'imported_card', items => synced.push(...items));
    const entryItem = makeItem('e-1');
    const cardItem = { ...makeItem('c-1', 'good', { kind: 'imported_card', logFields: { deck_id: 'deck-9' } }) };
    enqueueRating(USER, entryItem);
    enqueueRating(USER, cardItem);
    await flushNow(USER);
    await flushMicrotasks();

    expect(synced).toHaveLength(1);
    expect(synced[0].itemId).toBe('c-1');
    expect(synced[0].logFields.deck_id).toBe('deck-9');
    unsub();
  });
});

describe('flushKeepalive — teardown-safe flush, chunked under the combined 64KB cap', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon-key';
  });

  test('sends every queued item via keepalive fetch and never removes anything from the queue', () => {
    for (let i = 0; i < 5; i++) enqueueRating(USER, makeItem(`k-${i}`));
    flushKeepalive(USER, 'access-token-123');

    expect(global.fetch).toHaveBeenCalled();
    global.fetch.mock.calls.forEach(([url, opts]) => {
      expect(opts.keepalive).toBe(true);
      expect(opts.headers.Authorization).toBe('Bearer access-token-123');
    });
    const sentIds = global.fetch.mock.calls.flatMap(([, opts]) => JSON.parse(opts.body).p_items.map(it => it.id));
    expect(sentIds).toHaveLength(5);
    expect(getPendingCount(USER)).toBe(5); // never cleared here — only a real flush() success does that
  });

  test('chunks a large batch into multiple requests, each under the combined keepalive cap', () => {
    // logFields big enough that ~30 items can't fit in one 48KB chunk.
    const padding = 'x'.repeat(2000);
    for (let i = 0; i < 30; i++) enqueueRating(USER, makeItem(`big-${i}`, 'good', { logFields: { system: padding } }));
    flushKeepalive(USER, 'access-token-123');

    expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
    global.fetch.mock.calls.forEach(([, opts]) => {
      expect(opts.body.length).toBeLessThan(64 * 1024);
    });
    const sentIds = new Set(global.fetch.mock.calls.flatMap(([, opts]) => JSON.parse(opts.body).p_items.map(it => it.id)));
    expect(sentIds.size).toBe(30); // nothing dropped by chunking
  });
});
