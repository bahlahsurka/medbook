-- ============================================================
-- MedBook — Imported Decks: review log for real stats
-- Run this entire script in Supabase → SQL Editor → New Query
--
-- CORRECTED — the original version of this file assumed
-- imported_review_log didn't exist yet and tried to `create table if
-- not exists` it with a deck_id column. It turned out the table
-- already existed on the live database, under a different (better)
-- shape: no deck_id, but full prev/new scheduling history instead
-- (prev_state, prev_interval_days, new_interval_days, next_due_at).
-- Because `create table if not exists` silently no-ops against an
-- existing same-named table regardless of its actual columns, running
-- that original file reported success while changing nothing — every
-- insert kept failing on a deck_id column that was never going to
-- exist. The app's code (api.rateCard, api.getDebugSnapshot) has been
-- updated to match the REAL table instead of forcing the table to
-- match the app.
--
-- All that's actually still needed is making sure the table is
-- correctly RLS-scoped to each user — this doesn't touch its columns
-- or data. Safe to run even if these exact policies already exist
-- (drop-if-exists before each create).
-- ============================================================

alter table imported_review_log enable row level security;

drop policy if exists "Users see own imported review log" on imported_review_log;
create policy "Users see own imported review log"
  on imported_review_log for select using (auth.uid() = user_id);

drop policy if exists "Users insert own imported review log" on imported_review_log;
create policy "Users insert own imported review log"
  on imported_review_log for insert with check (auth.uid() = user_id);

-- No update/delete policy — write-once log rows.

create index if not exists imported_review_log_user_reviewed_idx
  on imported_review_log (user_id, reviewed_at desc);
