-- ============================================================
-- MedBook — Review Queue study-session tracking
-- Run this entire script in Supabase → SQL Editor → New Query
--
-- Adds review_sessions: one row per completed/exited Review Queue session
-- (not per card — review_log already has that), recording which system it
-- was, how many cards actually got rated, how many were targeted (if the
-- user picked an exact block size), and how long it took. Insights' "Recent
-- Study Sessions" card reads this; nothing else in the app does.
-- Additive only — existing functionality (entries, flashcards, review
-- scheduling, review_log, study_sessions) is untouched.
-- ============================================================

create table if not exists review_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  -- One system name, or null for an "All systems" / mixed session.
  system           text,
  -- How many cards were actually rated — real, never the target.
  card_count       integer not null check (card_count > 0),
  -- The block size the user picked before starting (see the Card Count
  -- selector on the Review Queue overview screen), or null if they picked
  -- no limit ("All").
  target_count     integer,
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at       timestamptz not null,
  created_at       timestamptz default now()
);

create index if not exists review_sessions_user_started_idx
  on review_sessions (user_id, started_at desc);

alter table review_sessions enable row level security;

create policy "Users see own review sessions"
  on review_sessions for select using (auth.uid() = user_id);

create policy "Users insert own review sessions"
  on review_sessions for insert with check (auth.uid() = user_id);

-- No update/delete policy — write-once log rows, same as review_log and
-- study_sessions.

-- Done! After running this, Insights will start showing "Recent Study
-- Sessions" the next time you finish or exit a Review Queue session.
