// lib/importedDecks/flags.js
//
// Anki's 7-color flag system (SUPABASE_MIGRATION_STUDY_CONTROLS.sql —
// imported_cards.flag, 0-7). Colors/names match Anki's own defaults so
// anyone coming from Anki recognizes them immediately; index 0 is
// deliberately absent from FLAGS below (it means "no flag", not a color).

export const FLAG_COLORS = {
  1: '#dc2626', // red
  2: '#ea580c', // orange
  3: '#16a34a', // green
  4: '#2563eb', // blue
  5: '#db2777', // pink
  6: '#0d9488', // turquoise
  7: '#9333ea', // purple
};

export const FLAG_NAMES = {
  0: 'No flag',
  1: 'Red', 2: 'Orange', 3: 'Green', 4: 'Blue', 5: 'Pink', 6: 'Turquoise', 7: 'Purple',
};

/** [1,2,3,4,5,6,7] — every real flag, in display order. Excludes 0 (none). */
export const FLAGS = Object.keys(FLAG_COLORS).map(Number);
