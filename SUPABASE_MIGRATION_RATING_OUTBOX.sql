-- ============================================================
-- MedBook — instant ratings / local-first sync outbox
-- Additive only. Safe to run more than once.
--
-- Applied directly against the live project via the Supabase MCP tool —
-- kept here, same as every other SUPABASE_MIGRATION_*.sql file, purely as
-- a checked-in record of what changed and why.
-- ============================================================

-- review_log and flashcard_review_log already have `id uuid default
-- gen_random_uuid()` — a client CAN supply its own id on insert, which is
-- exactly what makes the client-generated rating id usable as the
-- idempotency key for those two tables with zero schema change.
--
-- imported_review_log is the odd one out: its `id` is a bigint sequence,
-- not a uuid, so it can't double as a client-supplied idempotency key.
-- This adds the "unique column" the brief's own Delivery section
-- anticipated for exactly this case.
alter table imported_review_log add column if not exists client_id uuid unique;

-- "Don't delete log history silently — mark it undone." Additive on all
-- three log tables, for a consistent undo story across entries/imported
-- decks/My Cards (see apply_*_ratings below).
alter table review_log add column if not exists undone_at timestamptz;
alter table imported_review_log add column if not exists undone_at timestamptz;
alter table flashcard_review_log add column if not exists undone_at timestamptz;

-- Marking undone_at is an UPDATE — none of these three tables had an
-- UPDATE policy before now (they were write-once logs). Scoped exactly
-- like every other per-user policy in this schema.
drop policy if exists "Users update own review log" on review_log;
create policy "Users update own review log"
  on review_log for update using (auth.uid() = user_id);

drop policy if exists "Users update own imported review log" on imported_review_log;
create policy "Users update own imported review log"
  on imported_review_log for update using (auth.uid() = user_id);

drop policy if exists "Users update own flashcard review log" on flashcard_review_log;
create policy "Users update own flashcard review log"
  on flashcard_review_log for update using (auth.uid() = user_id);

-- ============================================================
-- apply_*_ratings(p_items jsonb) — one batched RPC call per flush per
-- kind, instead of one HTTP request per queued rating. SECURITY INVOKER
-- (the default — stated explicitly): runs as the calling user's own role,
-- so RLS still applies and no service-role key is ever needed client-side.
--
-- Each item in p_items:
--   { id, item_id, rating, reviewed_at, new_fields: {...}, log_fields: {...},
--     is_undo?, undo_of? }
--
-- Idempotency: a normal rating's log insert uses `on conflict (...) do
-- nothing` on the client-supplied id/client_id — a retry or a double
-- flush of the exact same item can never create a second log row. This
-- is plain SQL ON CONFLICT inside a function body, not a supabase-js
-- `.upsert(..., {onConflict, ignoreDuplicates})` call — see
-- lib/media/MediaService.js's own documented history for why that
-- client-level option is specifically NOT trusted in this project: it
-- looked correct and still crashed in production once already. This
-- migration does not repeat that approach.
--
-- Staleness protection: the state-table UPDATE only ever applies when
-- the incoming reviewed_at is strictly newer than what's already stored
-- (or the stored value is null) — a replayed/out-of-order queued item
-- from a stale device can never clobber a newer rating. This same
-- condition also naturally does the right thing for an undo item: its
-- own reviewed_at is "now", always newer than the rating it's undoing,
-- so the restore always applies.
-- ============================================================

create or replace function public.apply_entry_ratings(p_items jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  item jsonb;
  v_entry_id uuid;
  v_reviewed_at timestamptz;
begin
  for item in select * from jsonb_array_elements(p_items)
  loop
    v_entry_id := (item->>'item_id')::uuid;
    v_reviewed_at := (item->>'reviewed_at')::timestamptz;

    if coalesce((item->>'is_undo')::boolean, false) then
      update review_log set undone_at = now()
        where id = (item->>'undo_of')::uuid and user_id = auth.uid();
    else
      insert into review_log (id, user_id, entry_id, system, rating, reviewed_at)
      values (
        (item->>'id')::uuid, auth.uid(), v_entry_id,
        item->'log_fields'->>'system', item->>'rating', v_reviewed_at
      )
      on conflict (id) do nothing;
    end if;

    update entries
      set review_count = (item->'new_fields'->>'review_count')::int,
          last_reviewed = (item->'new_fields'->>'last_reviewed')::timestamptz,
          review_interval = (item->'new_fields'->>'review_interval')::int,
          ease_factor = (item->'new_fields'->>'ease_factor')::float8,
          next_review = (item->'new_fields'->>'next_review')::timestamptz
      where id = v_entry_id and user_id = auth.uid()
        and (last_reviewed is null or last_reviewed < v_reviewed_at);
  end loop;
end;
$$;

grant execute on function public.apply_entry_ratings(jsonb) to authenticated;

create or replace function public.apply_imported_card_ratings(p_items jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  item jsonb;
  v_card_id uuid;
  v_reviewed_at timestamptz;
begin
  for item in select * from jsonb_array_elements(p_items)
  loop
    v_card_id := (item->>'item_id')::uuid;
    v_reviewed_at := (item->>'reviewed_at')::timestamptz;

    if coalesce((item->>'is_undo')::boolean, false) then
      update imported_review_log set undone_at = now()
        where client_id = (item->>'undo_of')::uuid and user_id = auth.uid();
    else
      insert into imported_review_log
        (client_id, user_id, card_id, rating, prev_state, prev_interval_days, new_interval_days, next_due_at, reviewed_at)
      values (
        (item->>'id')::uuid, auth.uid(), v_card_id, item->>'rating',
        item->'log_fields'->>'prev_state',
        (item->'log_fields'->>'prev_interval_days')::int,
        (item->'log_fields'->>'new_interval_days')::int,
        (item->'log_fields'->>'next_due_at')::timestamptz,
        v_reviewed_at
      )
      on conflict (client_id) do nothing;
    end if;

    update imported_cards
      set state = item->'new_fields'->>'state',
          due_at = (item->'new_fields'->>'due_at')::timestamptz,
          interval_days = (item->'new_fields'->>'interval_days')::int,
          ease_factor = (item->'new_fields'->>'ease_factor')::real,
          review_count = (item->'new_fields'->>'review_count')::int,
          lapse_count = (item->'new_fields'->>'lapse_count')::int,
          last_reviewed_at = v_reviewed_at
      where id = v_card_id and user_id = auth.uid()
        and (last_reviewed_at is null or last_reviewed_at < v_reviewed_at);
  end loop;
end;
$$;

grant execute on function public.apply_imported_card_ratings(jsonb) to authenticated;

create or replace function public.apply_own_card_ratings(p_items jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  item jsonb;
  v_card_id uuid;
  v_reviewed_at timestamptz;
begin
  for item in select * from jsonb_array_elements(p_items)
  loop
    v_card_id := (item->>'item_id')::uuid;
    v_reviewed_at := (item->>'reviewed_at')::timestamptz;

    if coalesce((item->>'is_undo')::boolean, false) then
      update flashcard_review_log set undone_at = now()
        where id = (item->>'undo_of')::uuid and user_id = auth.uid();
    else
      insert into flashcard_review_log
        (id, user_id, card_id, rating, prev_interval_days, new_interval_days, time_spent_seconds, reviewed_at)
      values (
        (item->>'id')::uuid, auth.uid(), v_card_id, item->>'rating',
        (item->'log_fields'->>'prev_interval_days')::numeric,
        (item->'log_fields'->>'new_interval_days')::numeric,
        (item->'log_fields'->>'time_spent_seconds')::numeric,
        v_reviewed_at
      )
      on conflict (id) do nothing;
    end if;

    update flashcards
      set state = item->'new_fields'->>'state',
          due_at = (item->'new_fields'->>'due_at')::timestamptz,
          interval_days = (item->'new_fields'->>'interval_days')::numeric,
          ease_factor = (item->'new_fields'->>'ease_factor')::numeric,
          review_count = (item->'new_fields'->>'review_count')::int,
          lapse_count = (item->'new_fields'->>'lapse_count')::int,
          last_reviewed_at = v_reviewed_at
      where id = v_card_id and user_id = auth.uid()
        and (last_reviewed_at is null or last_reviewed_at < v_reviewed_at);
  end loop;
end;
$$;

grant execute on function public.apply_own_card_ratings(jsonb) to authenticated;
