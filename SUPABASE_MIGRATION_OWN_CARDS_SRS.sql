-- ============================================================
-- MedBook — "Engram": My Cards spaced-repetition engine (Stage 1)
-- Additive only — no existing column/row is ever dropped, renamed, or
-- rewritten. Safe to run more than once (every statement below is
-- idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE).
--
-- Applied directly against the live project via the Supabase MCP tool
-- (not hand-run by the user) — kept here, same as every other
-- SUPABASE_MIGRATION_*.sql file in this repo, purely as a checked-in
-- record of what changed and why.
-- ============================================================

-- Scheduling columns on the existing `flashcards` table (My Cards).
-- Mirrors imported_cards' own scheduling shape exactly — same SRS engine
-- (lib/srs/Scheduler.js), same field names, so one scheduler serves both
-- without a second set of conventions.
--   state            — 'new' | 'learning' | 'review' | 'suspended'.
--                      DEFAULT 'new' backfills every existing row to
--                      'new' for free (Postgres fills the default for
--                      already-existing rows on ADD COLUMN), which is
--                      exactly what the brief asks for: existing cards
--                      start as new, no separate backfill UPDATE needed.
--   due_at           — null until first reviewed (a 'new' card has no
--                      due date yet).
--   interval_days, ease_factor, review_count, lapse_count,
--   last_reviewed_at — identical semantics to imported_cards' own
--                      columns; see Scheduler.js's calculateNextReview.
alter table flashcards
  add column if not exists state text not null default 'new',
  add column if not exists due_at timestamptz,
  add column if not exists interval_days numeric not null default 0,
  add column if not exists ease_factor numeric not null default 2.5,
  add column if not exists review_count integer not null default 0,
  add column if not exists lapse_count integer not null default 0,
  add column if not exists last_reviewed_at timestamptz;

-- Which entry (if any) a card was copied from via AI "Add to my deck" —
-- nullable, ON DELETE SET NULL: deleting the source entry must never
-- delete or orphan the card itself, it just loses its "jump to source"
-- link (Stage 3 item 8).
alter table flashcards
  add column if not exists source_entry_id uuid references entries(id) on delete set null;

create index if not exists flashcards_source_entry_idx on flashcards (source_entry_id);
-- Scoped to one user's own due-cards lookup (Study/folder-count queries
-- always filter by user_id first) — not a bare due_at index.
create index if not exists flashcards_user_state_due_idx on flashcards (user_id, state, due_at);

-- Per-review log for My Cards — Stage 1 item 3. No such table existed:
-- review_log logs ENTRY reviews (Review Queue/SystemReview), and
-- imported_review_log logs IMPORTED DECK cards only. This is the
-- flashcards-table equivalent of imported_review_log, plus the one field
-- that table doesn't have: time spent on the card (a stats-only figure —
-- never read by, and never allowed to change, the fixed 40s/card
-- "Study by time" planning rate from Stage 3).
create table if not exists flashcard_review_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null references flashcards(id) on delete cascade,
  rating text not null,
  prev_interval_days numeric,
  new_interval_days numeric,
  time_spent_seconds numeric,
  reviewed_at timestamptz not null default now()
);

alter table flashcard_review_log enable row level security;

drop policy if exists "Users see own flashcard review log" on flashcard_review_log;
create policy "Users see own flashcard review log"
  on flashcard_review_log for select using (auth.uid() = user_id);

drop policy if exists "Users insert own flashcard review log" on flashcard_review_log;
create policy "Users insert own flashcard review log"
  on flashcard_review_log for insert with check (auth.uid() = user_id);

-- No update/delete policy for ordinary use — write-once log rows. Undo
-- (Previous) deletes its own matching row directly via the service
-- role... actually via the authenticated client, same as
-- imported_review_log's own unrateCard — so a delete policy IS needed,
-- scoped to the owning user only, same shape as every other per-user
-- table in this schema.
drop policy if exists "Users delete own flashcard review log" on flashcard_review_log;
create policy "Users delete own flashcard review log"
  on flashcard_review_log for delete using (auth.uid() = user_id);

create index if not exists flashcard_review_log_user_reviewed_idx
  on flashcard_review_log (user_id, reviewed_at desc);
create index if not exists flashcard_review_log_card_idx
  on flashcard_review_log (card_id);

-- ============================================================
-- OPTIONAL — run this second block separately, only after confirming the
-- block above succeeded. Backfills source_entry_id for EXISTING cards
-- that came from the AI "Add to my deck" path, before that column existed
-- to record it. Only ever writes to the new source_entry_id column —
-- never touches question/answer/system. Matches a flashcards row back to
-- the entry whose AI-generated flashcards section (entries.ai_sections)
-- contains that exact question+answer pair, under the same system — but
-- ONLY when exactly one entry matches for that row. Anything ambiguous
-- (no match, or more than one different entry with the same text) is left
-- NULL rather than guessed, per the brief ("never guess").
-- ============================================================
with matches as (
  select distinct fc.id as flashcard_id, e.id as entry_id
  from flashcards fc
  join entries e
    on e.user_id = fc.user_id
   and e.system = fc.system
   and e.ai_sections is not null
  cross join lateral jsonb_array_elements(coalesce(e.ai_sections->'flashcards', '[]'::jsonb)) as card_elem
  where fc.source_entry_id is null
    and btrim(card_elem->>'front') = btrim(fc.question)
    and btrim(card_elem->>'back') = btrim(fc.answer)
),
unique_matches as (
  select flashcard_id, (array_agg(entry_id))[1] as entry_id
  from matches
  group by flashcard_id
  having count(distinct entry_id) = 1
)
update flashcards fc
set source_entry_id = um.entry_id
from unique_matches um
where fc.id = um.flashcard_id;
