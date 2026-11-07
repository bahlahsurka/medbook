// lib/ownCards/settings.js
//
// Engram brief's own "Defaults" section: "user can change later; make
// them settings, not constants scattered in code." No settings SCREEN
// exists yet (not one of the numbered items in any stage) — this is the
// one place those values live today, so a future settings UI has a
// single object to read/write instead of hunting down magic numbers
// across FlashCards.js/StudySession.js/lib/ownCards/api.js.
export const OWN_CARDS_DEFAULTS = {
  // "Study by time" duration choices and default (Stage 3 item 7).
  studyTimeChoicesMinutes: [15, 30, 45],
  defaultStudyMinutes: 30,

  // New cards pulled into a session per day, across every study entry
  // point (Stage 1 item 1's daily new-card limit).
  newCardsPerDay: 20,

  // Fixed card-count planning rate for "Study by time" — 40 seconds per
  // card, PERMANENTLY. Never swapped for a measured per-user time; see
  // Stage 3 item 7's own comment in api.js for why.
  planningRateSeconds: 40,

  // Jump to source (Stage 3 item 8) — on by default.
  jumpToSourceEnabled: true,

  // Weak spots (Stage 3 item 9) — a system needs at least this many
  // graded reviews before its retention is considered meaningful enough
  // to rank and show.
  weakSpotMinReviews: 20,
};

/** floor(minutes * 60 / planningRateSeconds) — the one place this math
 *  happens, so the picker's displayed count and the actual session's
 *  query limit can never drift apart from each other. */
export function studyMinutesToCardBudget(minutes, planningRateSeconds = OWN_CARDS_DEFAULTS.planningRateSeconds) {
  return Math.floor((minutes * 60) / planningRateSeconds);
}
