// lib/srs/Scheduler.js
//
// Spaced-repetition scheduling. Deliberately isolated from React (spec §32/§36)
// so it can be swapped for FSRS later without touching a single component.
//
// EXACT initial intervals, per spec §29 — these are not to be substituted:
//   Again = 6 minutes
//   Hard  = 1 day
//   Good  = 3 days
//   Easy  = 7 days

export const RATINGS = ['again', 'hard', 'good', 'easy'];

/** The intervals shown UNDER each button in the study UI. */
export const INITIAL_INTERVALS = {
  again: { minutes: 6,            label: '6m' },
  hard:  { minutes: 60 * 24,      label: '1d' },
  good:  { minutes: 60 * 24 * 3,  label: '3d' },
  easy:  { minutes: 60 * 24 * 7,  label: '7d' },
};

/**
 * A card that has been reviewed before grows its interval; a brand-new card
 * uses the fixed intervals above. "Again" always resets to 6 minutes and
 * counts as a lapse — that's the whole point of the rating.
 */
export class SimpleScheduler {
  /**
   * @param card  { state, interval_days, ease_factor, review_count, lapse_count }
   * @param rating  'again' | 'hard' | 'good' | 'easy'
   * @param now  Date (injectable, so this is testable without faking clocks)
   * @returns the fields to persist + when the card is next due
   */
  calculateNextReview(card, rating, now = new Date()) {
    if (!RATINGS.includes(rating)) throw new Error(`Unknown rating: ${rating}`);

    const isNew = !card || card.state === 'new' || (card.review_count || 0) === 0;
    let ease = card?.ease_factor ?? 2.5;
    let intervalDays = card?.interval_days ?? 0;
    let lapses = card?.lapse_count ?? 0;

    let nextIntervalMinutes;
    let nextState;

    if (rating === 'again') {
      // Forgotten — back to the short learning step, and remember the lapse.
      nextIntervalMinutes = INITIAL_INTERVALS.again.minutes;
      nextState = 'learning';
      intervalDays = 0;
      lapses += 1;
      ease = Math.max(1.3, ease - 0.2);
    } else if (isNew) {
      // First real answer on a new card — use the fixed, published intervals
      // exactly. No cleverness here; the user was explicit about this.
      nextIntervalMinutes = INITIAL_INTERVALS[rating].minutes;
      intervalDays = nextIntervalMinutes / (60 * 24);
      nextState = 'review';
      if (rating === 'hard') ease = Math.max(1.3, ease - 0.15);
      if (rating === 'easy') ease = Math.min(3.0, ease + 0.15);
    } else {
      // Established card — grow from its current interval.
      const base = Math.max(intervalDays, 1);
      if (rating === 'hard') {
        intervalDays = Math.max(1, Math.round(base * 1.2));
        ease = Math.max(1.3, ease - 0.15);
      } else if (rating === 'good') {
        intervalDays = Math.max(1, Math.round(base * ease));
      } else { // easy
        intervalDays = Math.max(1, Math.round(base * ease * 1.3));
        ease = Math.min(3.0, ease + 0.15);
      }
      nextIntervalMinutes = intervalDays * 60 * 24;
      nextState = 'review';
    }

    const dueAt = new Date(now.getTime() + nextIntervalMinutes * 60 * 1000);

    return {
      state: nextState,
      due_at: dueAt.toISOString(),
      interval_days: Math.round(intervalDays * 100) / 100,
      ease_factor: Math.round(ease * 100) / 100,
      review_count: (card?.review_count || 0) + 1,
      lapse_count: lapses,
      last_reviewed_at: now.toISOString(),
    };
  }

  /**
   * The four labels shown under the buttons. For a NEW card these are the
   * fixed values; for an established card they reflect what will actually
   * happen, so the label never lies to the user (spec §17).
   */
  previewIntervals(card, now = new Date()) {
    const out = {};
    for (const rating of RATINGS) {
      const result = this.calculateNextReview(card, rating, now);
      out[rating] = { label: formatInterval(result.interval_days, rating), dueAt: result.due_at };
    }
    return out;
  }
}

/** Human-readable interval label: 6m / 1d / 3d / 2.1mo etc. */
export function formatInterval(intervalDays, rating) {
  if (rating === 'again') return '6m';
  if (intervalDays < 1) return `${Math.round(intervalDays * 24 * 60)}m`;
  if (intervalDays < 30) return `${Math.round(intervalDays)}d`;
  if (intervalDays < 365) return `${(intervalDays / 30).toFixed(1)}mo`;
  return `${(intervalDays / 365).toFixed(1)}y`;
}

/**
 * Choose the next cards for a study session (spec §31).
 * Deterministic order — due first (most overdue), then learning, then new —
 * so a session never feels like it's jumping around randomly.
 *
 * This builds the QUERY shape; it deliberately does not fetch everything.
 */
export function buildSessionQuery({ deckIds, limit = 50, now = new Date() }) {
  return {
    deckIds,
    limit,
    nowIso: now.toISOString(),
    // Consumed by the data layer as: state<>'suspended'
    //   AND (due_at <= now OR state = 'new')
    //   ORDER BY (state='new') ASC, due_at ASC NULLS LAST
    order: [
      { column: 'state', ascending: true },   // learning/review before new
      { column: 'due_at', ascending: true, nullsFirst: false },
    ],
  };
}

export const scheduler = new SimpleScheduler();
