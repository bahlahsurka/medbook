-- ============================================================
-- MedBook — Visual Learning (Phase 1): entry_visualizations table
-- Additive only — no existing table/column/row is ever dropped, renamed,
-- or rewritten. Safe to run more than once (every statement below is
-- idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE), same
-- convention as every other SUPABASE_MIGRATION_*.sql file in this repo.
--
-- Applied directly against the live project via the Supabase MCP tool (not
-- hand-run by the user) — kept here purely as a checked-in record of what
-- changed and why, same as every other migration file in this repo.
--
-- Deliberately a NEW, separate table rather than new columns on `entries`
-- (see the architecture audit): entries.ai_sections can only ever hold ONE
-- generation at a time, which is wrong for this feature — a user can
-- generate a Mind Map AND, in a later phase, a Clinical Flowchart for the
-- SAME entry, and neither must overwrite the other. This table also closes
-- a gap entries.ai_sections has today: nothing marks that cached analysis
-- as stale when the Review text changes underneath it. source_content_hash
-- here exists specifically to make that check possible (see api/visualize.mjs).
--
-- Does NOT touch entries or flashcards in any way — no column added, no
-- row ever written there by this feature.
-- ============================================================

create table if not exists entry_visualizations (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references entries(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,

  -- 'mind_map' today; 'knowledge_network' / 'clinical_flowchart' / etc. in
  -- later phases — deliberately NOT a DB-level enum/check constraint, so
  -- adding a new visualization type never needs a schema migration. Which
  -- types are actually supported is enforced in application code
  -- (api/visualize.mjs), per the audit's "keep this modular" guidance.
  viz_type            text not null check (viz_type <> ''),

  -- sha256 hex of (entry.notes + extraContext) at the moment this was
  -- generated — compared against the CURRENT entry on every request so a
  -- Review edited after generation is detected as stale without needing a
  -- separate "dirty" flag anywhere. See lib contentHash.js / api/visualize.mjs.
  source_content_hash text not null check (source_content_hash <> ''),

  -- The optional extra medical context the user supplied for THIS
  -- generation, if any — stored verbatim (not merged into graph_data) so
  -- it's always possible to see afterwards whether/what extra context a
  -- given cached result was built from. Null when none was supplied.
  extra_context       text,

  -- The validated {centralTopic, nodes, edges} diagram — see
  -- VisualizationValidator.js for the exact shape this is guaranteed to
  -- have passed before ever reaching this column.
  graph_data          jsonb not null default '{}'::jsonb,

  ai_provider         text,
  ai_model            text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- ONE cached result per (entry, visualization type) at a time — a
  -- regenerate (new hash, same type) replaces this row in place rather than
  -- accumulating history, exactly like entries.ai_sections already does for
  -- the existing AI Analysis feature. Different TYPES for the same entry
  -- are different rows entirely (this constraint is scoped per-type), which
  -- is the actual "don't overwrite each other" guarantee the product
  -- requirement asks for.
  constraint entry_visualizations_entry_type_unique unique (entry_id, viz_type)
);

alter table entry_visualizations enable row level security;

-- Same four-policy shape as `entries` itself (SUPABASE_SETUP.sql) — owner
-- only, no exceptions.
drop policy if exists "Users see own visualizations" on entry_visualizations;
create policy "Users see own visualizations"
  on entry_visualizations for select using (auth.uid() = user_id);

drop policy if exists "Users insert own visualizations" on entry_visualizations;
create policy "Users insert own visualizations"
  on entry_visualizations for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own visualizations" on entry_visualizations;
create policy "Users update own visualizations"
  on entry_visualizations for update using (auth.uid() = user_id);

drop policy if exists "Users delete own visualizations" on entry_visualizations;
create policy "Users delete own visualizations"
  on entry_visualizations for delete using (auth.uid() = user_id);

-- The unique constraint above already gives Postgres a btree index covering
-- (entry_id, viz_type) for free — this is the cache lookup's own access
-- path (entry_id + viz_type + source_content_hash), so no separate index is
-- needed for that. This one is for a future "all my visualizations" screen
-- (same reasoning as flashcards_source_entry_idx in
-- SUPABASE_MIGRATION_OWN_CARDS_SRS.sql), not used by Phase 1 itself.
create index if not exists entry_visualizations_user_idx
  on entry_visualizations (user_id);
