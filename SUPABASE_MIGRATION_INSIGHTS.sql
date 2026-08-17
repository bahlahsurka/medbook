-- ============================================================
-- MedBook — Insights real-data migration
-- Run this entire script in Supabase → SQL Editor → New Query
--
-- Adds the two tables the Insights page needs to replace its sample
-- data with real numbers:
--   - study_sessions: how long you spend on DetailView/Review Queue/
--     Flashcards sessions, for the Study Time chart.
--   - review_log: one row per Review Queue rating (Again/Hard/Good/
--     Easy), for real retention.
-- Neither table is read by anything else in the app yet — existing
-- functionality (entries, flashcards, review scheduling) is untouched.
-- ============================================================

-- 1. STUDY SESSIONS
create table if not exists study_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  started_at       timestamptz not null,
  duration_seconds integer not null check (duration_seconds > 0),
  -- Which screen the time was spent in: 'entry' | 'review' | 'flashcards'.
  -- Not currently surfaced in the UI (Insights only sums durations), kept
  -- for a future per-activity breakdown without needing another migration.
  context          text,
  created_at       timestamptz default now()
);

create index if not exists study_sessions_user_started_idx
  on study_sessions (user_id, started_at desc);

alter table study_sessions enable row level security;

create policy "Users see own study sessions"
  on study_sessions for select using (auth.uid() = user_id);

create policy "Users insert own study sessions"
  on study_sessions for insert with check (auth.uid() = user_id);

-- No update/delete policy — sessions are write-once log rows, same as
-- review_log below. Nothing in the app ever edits or removes one.


-- 2. REVIEW LOG
create table if not exists review_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  entry_id    uuid references entries(id) on delete cascade not null,
  system      text not null,
  rating      text not null check (rating in ('again','hard','good','easy')),
  reviewed_at timestamptz not null default now()
);

create index if not exists review_log_user_reviewed_idx
  on review_log (user_id, reviewed_at desc);
create index if not exists review_log_user_system_idx
  on review_log (user_id, system, reviewed_at desc);

alter table review_log enable row level security;

create policy "Users see own review log"
  on review_log for select using (auth.uid() = user_id);

create policy "Users insert own review log"
  on review_log for insert with check (auth.uid() = user_id);

-- Done! After running this, Insights will start showing real Study Time
-- and Retention numbers as soon as you use Review Queue / Flashcards /
-- entry pages again — there's no backfill for time before this migration,
-- since none of that history was ever recorded.
