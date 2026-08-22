-- ============================================================
-- MedBook — Imported Decks: flags + per-day review limits
-- Run this entire script in Supabase → SQL Editor → New Query
--
-- Two Anki features raised as missing from the Imported Decks study
-- flow, both needing real schema (not derivable from existing columns):
--   - flag: mark a card while studying (Anki's 7-color flag system),
--     filterable later in Browse.
--   - new_cards_per_day / max_reviews_per_day: per-deck caps on how many
--     new cards and how many due reviews a session pulls in, tracked
--     cumulatively across the actual calendar day (not just "this one
--     session") — matches Anki's real daily-limit behavior, not a
--     session-only cap.
-- ============================================================

-- 1. FLAGS — one column, 0 (none) through 7, matching Anki's own flag
--    numbering exactly so nothing here has to invent a new palette.
alter table imported_cards
  add column if not exists flag smallint not null default 0
  check (flag between 0 and 7);

-- Browse's flag filter scans this per user — cheap composite index.
create index if not exists imported_cards_user_flag_idx
  on imported_cards (user_id, flag) where flag > 0;

-- 2. PER-DAY LIMITS — nullable = unlimited (existing decks are
--    unaffected until someone actually opens Deck Options and sets a
--    number, same "opt-in" spirit as every other Imported Decks setting
--    so far). Applied to whichever deck node a study session is started
--    from — see getSessionCards in lib/importedDecks/api.js for how the
--    "already done today" count is computed.
alter table imported_decks
  add column if not exists new_cards_per_day integer check (new_cards_per_day is null or new_cards_per_day >= 0),
  add column if not exists max_reviews_per_day integer check (max_reviews_per_day is null or max_reviews_per_day >= 0);
