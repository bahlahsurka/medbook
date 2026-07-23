// lib/reviewQueue.js
//
// Shared queue-composition logic for both the global Review Queue and the
// per-system SystemReview. Pulled into one place deliberately — these two
// screens had nearly-identical due/fresh logic before, duplicated in two
// files, and duplication is exactly what caused them to drift apart and
// develop two different bugs earlier in this project. One function, used
// by both, so a fix here fixes both screens at once.
//
// COMPOSITION (per explicit request): ~30 new cards, then ~15 due cards,
// repeating that cycle until both pools are exhausted — NOT capped to a
// fixed session size that forces a restart. Cards within each chunk are
// randomly shuffled, not sorted by date. The queue naturally ends when
// there's genuinely nothing left; the user can also end early at any time.

export const NEW_CHUNK = 30;
export const DUE_CHUNK = 15;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a cycling review queue: newChunk new cards, dueChunk due cards,
 * repeat, until both pools run out. Both pools are shuffled once up front
 * (a stable random order for this session) — this is NOT re-shuffled as you
 * progress, so the snapshot stays stable while you work through it (same
 * anti-skip protection the frozen-queue fix relied on earlier).
 */
export function buildCycledQueue(entries, { newChunk = NEW_CHUNK, dueChunk = DUE_CHUNK } = {}) {
  const now = new Date();
  const due = shuffle(entries.filter(e => e.next_review && new Date(e.next_review) <= now));
  const fresh = shuffle(entries.filter(e => !e.next_review));

  const queue = [];
  let ni = 0, di = 0;
  while (ni < fresh.length || di < due.length) {
    const newSlice = fresh.slice(ni, ni + newChunk);
    queue.push(...newSlice); ni += newSlice.length;

    const dueSlice = due.slice(di, di + dueChunk);
    queue.push(...dueSlice); di += dueSlice.length;

    // Safety net against an infinite loop — shouldn't be reachable given the
    // while condition, but costs nothing to guard explicitly.
    if (newSlice.length === 0 && dueSlice.length === 0) break;
  }
  return queue;
}

/**
 * Same cycling composition, with a third phase appended: cards scheduled for
 * later (already reviewed at least once, not yet due), shuffled. Used only
 * by SystemReview's "Review all anyway" re-drill — due+new stay the primary
 * cycle, scheduled cards are extra material once those run out.
 */
export function buildCycledQueueWithScheduled(entries, opts) {
  const now = new Date();
  const base = buildCycledQueue(entries, opts);
  const scheduled = shuffle(entries.filter(e => e.next_review && new Date(e.next_review) > now));
  return [...base, ...scheduled];
}
