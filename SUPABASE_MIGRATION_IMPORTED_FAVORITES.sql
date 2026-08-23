-- ============================================================
-- MedBook — Imported Decks: persistent per-user card favorites
-- Run this entire script in Supabase → SQL Editor → New Query
--
-- One new table, no changes to imported_cards/imported_decks/imported_notes/
-- imported_models, Scheduler.js, SRS state, or card ordering — favoriting
-- is a separate user preference, not a scheduling signal.
-- ============================================================

-- 1. TABLE — user_id + imported_card_id is the whole relationship;
--    favorited_at is what a future Favorites screen would sort by.
create table if not exists imported_card_favorites (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  imported_card_id uuid references imported_cards(id) on delete cascade not null,
  favorited_at     timestamptz not null default now(),

  -- The actual "can't favorite the same card twice" guarantee — enforced by
  -- Postgres itself, not application logic, so it holds even under a race
  -- (e.g. a double-tap firing two inserts before either resolves). This
  -- unique index is also what addFavorite()'s ON CONFLICT DO NOTHING
  -- upsert (lib/importedDecks/favorites.js) relies on to make a duplicate
  -- favorite attempt a harmless no-op instead of an error.
  unique (user_id, imported_card_id)
);

-- imported_card_id references imported_cards(id) on delete cascade: when a
-- card row is deleted, its favorite row(s) go with it automatically — no
-- orphaned favorites, and nothing in the app has to remember to clean them
-- up itself. user_id references auth.users(id) on delete cascade for the
-- same reason if an account is ever deleted (matches every other
-- MedBook table's existing user_id FK).
--
-- Deck deletion: deleteDeck() (lib/importedDecks/api.js) deletes the root
-- imported_decks row and — per that function's own doc comment — is
-- EXPECTED to cascade down through imported_notes/imported_cards for that
-- root_deck_id, though that comment also flags it as not yet verified
-- against the live schema (deleteDeck() only runs in MOCK_MODE today).
-- This migration doesn't change or re-verify that chain — it's an
-- existing, separate concern. What it DOES guarantee, independent of
-- whatever that chain turns out to do: the moment an imported_cards row
-- is actually gone (whenever/however that happens), its favorite row is
-- gone too, via the FK above. A favorite can never outlive the card it
-- points at.

-- 2. ROW LEVEL SECURITY — same proven auth.uid() = user_id pattern already
--    in place on entries, imported_review_log, and all four core
--    imported_* tables (see api.js's own comment confirming that). Only
--    select/insert/delete policies — favoriting is add/remove, never
--    edited in place, so there's deliberately no update policy.
alter table imported_card_favorites enable row level security;

create policy "Users see own favorites"
  on imported_card_favorites for select using (auth.uid() = user_id);

create policy "Users insert own favorites"
  on imported_card_favorites for insert with check (auth.uid() = user_id);

create policy "Users delete own favorites"
  on imported_card_favorites for delete using (auth.uid() = user_id);

-- 3. INDEXES — getFavoriteCards()/getFavoriteCardIds() both scan by
--    user_id, most-recent-first; the unique constraint above already
--    covers user_id+imported_card_id lookups (isFavorite()), so this
--    index only needs to add favorited_at ordering on top.
create index if not exists imported_card_favorites_user_idx
  on imported_card_favorites (user_id, favorited_at desc);
