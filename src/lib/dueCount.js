// lib/dueCount.js
//
// Display-only cap for a "due" headline count — a literal count in the
// hundreds reads as alarming/overwhelming rather than useful, so anything
// past DUE_DISPLAY_CAP shows as "50+" instead of the exact number. Purely
// cosmetic: whatever real dueCount this is derived from is untouched, so a
// Due session still pulls every card that's actually due, exactly as
// before — only the headline readout is capped. Shared by Review Queue
// (the masthead number and the "Due (N)" mode button label) and the
// Dashboard (the "Due Today" tile and Today's Focus headline), so the two
// screens can never show a different cap or disagree on the threshold.
export const DUE_DISPLAY_CAP = 50;

export function formatDueCount(n) {
  return n > DUE_DISPLAY_CAP ? `${DUE_DISPLAY_CAP}+` : String(n);
}
