-- ============================================================
-- MedBook — Supabase Setup SQL
-- Run this entire script in Supabase → SQL Editor → New Query
-- ============================================================

-- 1. ENTRIES TABLE
create table if not exists entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  system       text not null,
  title        text not null,
  topic        text default '',
  notes        text default '',
  difficulty   text default 'Medium',
  images       text[] default '{}',
  review_count integer default 0,
  last_reviewed timestamptz,
  created_at   timestamptz default now()
);

-- 2. ROW LEVEL SECURITY — users can only see their own entries
alter table entries enable row level security;

create policy "Users see own entries"
  on entries for select using (auth.uid() = user_id);

create policy "Users insert own entries"
  on entries for insert with check (auth.uid() = user_id);

create policy "Users update own entries"
  on entries for update using (auth.uid() = user_id);

create policy "Users delete own entries"
  on entries for delete using (auth.uid() = user_id);

-- 3. IMAGE STORAGE BUCKET
insert into storage.buckets (id, name, public)
values ('entry-images', 'entry-images', true)
on conflict (id) do nothing;

-- Storage policy: users can upload/read/delete their own images
create policy "User image upload"
  on storage.objects for insert
  with check (bucket_id = 'entry-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Public image read"
  on storage.objects for select
  using (bucket_id = 'entry-images');

create policy "User image delete"
  on storage.objects for delete
  using (bucket_id = 'entry-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- Done!
