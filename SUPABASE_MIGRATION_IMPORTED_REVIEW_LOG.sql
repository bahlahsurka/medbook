-- ============================================================
-- MedBook — Imported Decks: review log for real stats
-- Run this entire script in Supabase → SQL Editor → New Query
--
-- One row per Imported Decks study-session rating (Again/Hard/Good/
-- Easy) — the imported-cards equivalent of review_log
-- (SUPABASE_MIGRATION_INSIGHTS.sql), which only ever logs ratings on
-- the main app's `entries`, never imported cards. Powers the new
-- Stats screen in the Imported Decks area: streak, retention rate,
-- reviews/day, rating breakdown. Nothing else reads or writes it.
-- ============================================================

create table if not exists imported_review_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  card_id     uuid references imported_cards(id) on delete cascade not null,
  deck_id     uuid references imported_decks(id) on delete cascade not null,
  rating      text not null check (rating in ('again','hard','good','easy')),
  reviewed_at timestamptz not null default now()
);

create index if not exists imported_review_log_user_reviewed_idx
  on imported_review_log (user_id, reviewed_at desc);

alter table imported_review_log enable row level security;

create policy "Users see own imported review log"
  on imported_review_log for select using (auth.uid() = user_id);

create policy "Users insert own imported review log"
  on imported_review_log for insert with check (auth.uid() = user_id);

-- No update/delete policy — write-once log rows, same as review_log.

-- Done! After running this, the Stats screen (Imported Decks -> the new
-- 📊 Stats button) will start showing real numbers as soon as you rate a
-- card again — there's no backfill for ratings made before this migration,
-- since none of that history was ever recorded.
