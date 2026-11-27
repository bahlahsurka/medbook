-- SUPABASE_MIGRATION_SHARED_ENTRIES.sql
--
-- Share an entry with another MedBook user by link.
--
-- One row per shared entry: a snapshot of the entry (notes, highlights,
-- images, Key Points, flashcard suggestions, saved diagrams) taken when the
-- owner taps Share (and refreshed by "Update shared copy"). The link is
-- /s/<token>. It works until the entry is deleted (ON DELETE CASCADE).
--
-- Only the owner can read/write their share rows directly (RLS). Anyone
-- else reads a share ONLY through get_shared_entry(token), which requires a
-- signed-in user and returns just that one snapshot. Saving copies the
-- snapshot into the recipient's own entries/entry_visualizations under
-- their own RLS — nothing here can write to another user's data.
--
-- Additive only: no existing table, column or policy is changed.

create table if not exists public.shared_entries (
  token      uuid primary key default gen_random_uuid(),
  entry_id   uuid not null unique references public.entries(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  snapshot   jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_entries_snapshot_size check (octet_length(snapshot::text) < 4000000)
);

alter table public.shared_entries enable row level security;

drop policy if exists "Users see own shares" on public.shared_entries;
create policy "Users see own shares" on public.shared_entries
  for select using (auth.uid() = user_id);

drop policy if exists "Users create own shares" on public.shared_entries;
create policy "Users create own shares" on public.shared_entries
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.entries e where e.id = entry_id and e.user_id = auth.uid())
  );

drop policy if exists "Users update own shares" on public.shared_entries;
create policy "Users update own shares" on public.shared_entries
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.entries e where e.id = entry_id and e.user_id = auth.uid())
  );

drop policy if exists "Users delete own shares" on public.shared_entries;
create policy "Users delete own shares" on public.shared_entries
  for delete using (auth.uid() = user_id);

-- Read one shared entry by its link token. Signed-in users only.
-- Returns null when the token doesn't exist (or the entry was deleted).
create or replace function public.get_shared_entry(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.shared_entries;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into r from public.shared_entries where token = p_token;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'snapshot', r.snapshot,
    'isOwner', r.user_id = auth.uid(),
    'entryId', case when r.user_id = auth.uid() then r.entry_id end
  );
end;
$$;

revoke all on function public.get_shared_entry(uuid) from public;
revoke all on function public.get_shared_entry(uuid) from anon;
grant execute on function public.get_shared_entry(uuid) to authenticated;
