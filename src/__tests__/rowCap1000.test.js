// Every read that can grow past Supabase's 1000-row response cap must page.
// The mock below behaves like PostgREST: filters, then .range(), and never
// returns more than 1000 rows in one response, silently.
const CAP = 1000;
const mockTables = {};
const mockRequests = [];

jest.mock('../lib/supabase', () => {
  const build = (table) => {
    const q = { table, filters: [], range: null, orders: [] };
    const api = {
      select() { return api; },
      eq(c, v) { q.filters.push(r => r[c] === v); return api; },
      neq(c, v) { q.filters.push(r => r[c] !== v); return api; },
      in(c, vs) { q.filters.push(r => vs.includes(r[c])); return api; },
      lte(c, v) { q.filters.push(r => r[c] != null && r[c] <= v); return api; },
      gte(c, v) { q.filters.push(r => r[c] != null && r[c] >= v); return api; },
      not(c, op, v) { q.filters.push(r => !(op === 'is' && v === null && r[c] == null)); return api; },
      is(c, v) { q.filters.push(r => (r[c] ?? null) === v); return api; },
      order(c, { ascending = true } = {}) { q.orders.push([c, ascending]); return api; },
      range(a, b) { q.range = [a, b]; return api; },
      then(res, rej) {
        mockRequests.push({ table, range: q.range });
        let rows = (mockTables[table] || []).filter(r => q.filters.every(f => f(r)));
        rows = [...rows].sort((x, y) => {
          for (const [c, asc] of q.orders) {
            if (x[c] < y[c]) return asc ? -1 : 1;
            if (x[c] > y[c]) return asc ? 1 : -1;
          }
          return 0;
        });
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        rows = rows.slice(0, CAP); // the silent cap
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { supabase: { from: (t) => build(t) } };
});

const { fetchAllEntries } = require('../lib/entriesApi');
const ownCards = require('../lib/ownCards/api');
const imported = require('../lib/importedDecks/api');
const favorites = require('../lib/importedDecks/favorites');

const U = 'user-1';
const iso = (i) => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

beforeEach(() => { for (const k of Object.keys(mockTables)) delete mockTables[k]; mockRequests.length = 0; });

test('all 1008 entries load (the 8 oldest were being dropped)', async () => {
  mockTables.entries = many(1008, i => ({ id: `e${String(i).padStart(5, '0')}`, user_id: U, created_at: iso(i) }));
  mockTables.entries.push({ id: 'other', user_id: 'someone-else', created_at: iso(5000) });
  const { data, error } = await fetchAllEntries(U);
  expect(error).toBeNull();
  expect(data).toHaveLength(1008);
  expect(new Set(data.map(e => e.id)).size).toBe(1008);           // no duplicates across pages
  expect(data[0].id).toBe('e01007');                               // newest first
  expect(data[1007].id).toBe('e00000');                            // the oldest is there
  expect(mockRequests.filter(r => r.table === 'entries')).toHaveLength(2);
});

test('My Cards list loads past 1000 cards', async () => {
  mockTables.flashcards = many(2500, i => ({ id: `c${i}`, user_id: U, created_at: iso(i) }));
  const { data } = await ownCards.fetchAllOwnCards(U);
  expect(data).toHaveLength(2500);
});

test('My Cards due forecast counts every due card', async () => {
  const soon = new Date(Date.now() + 3600_000).toISOString();
  mockTables.flashcards = many(1500, i => ({ id: `c${i}`, user_id: U, state: 'review', due_at: soon }));
  const buckets = await ownCards.getDueForecast(U, 7);
  expect(buckets[0]).toBe(1500);
});

test('weak spots and My Cards stats use every review', async () => {
  const recent = new Date(Date.now() - 86400_000).toISOString();
  mockTables.flashcard_review_log = many(1300, i => ({ id: `l${i}`, user_id: U, rating: i < 1100 ? 'good' : 'again',
    reviewed_at: recent, flashcards: { system: 'Cardiology', review_count: 4 } }));
  const spots = await ownCards.getWeakSpots(U, 20);
  expect(spots).toEqual([{ system: 'Cardiology', total: 1300, retentionPct: Math.round(1100 / 1300 * 100) }]);
});

test('imported deck stats keep the most recent ratings (only the oldest 1000 were used)', async () => {
  mockTables.imported_review_log = many(1071, i => ({ id: i, user_id: U, rating: 'good',
    reviewed_at: new Date(Date.now() - (1071 - i) * 60000).toISOString() }));
  const res = await imported.getImportedReviewStats(U);
  expect(res.rows).toHaveLength(1071);
  expect(res.rows[1070].reviewed_at).toBe(mockTables.imported_review_log[1070].reviewed_at);
});

test('deck due counts include every due card (capped at 1000 before)', async () => {
  mockTables.imported_decks = [{ id: 'root', parent_id: null, user_id: U, is_root: true, archived: false, display_name: 'Deck' }];
  const past = new Date(Date.now() - 3600_000).toISOString();
  mockTables.imported_cards = many(1482, i => ({ id: i, user_id: U, deck_id: 'root', state: 'review', due_at: past }));
  const decks = await imported.getRootDecks(U);
  expect(decks[0].due_cards).toBe(1482);
});

test('deck tag filter sees tags from every card', async () => {
  mockTables.imported_decks = [{ id: 'root', parent_id: null, user_id: U }];
  mockTables.imported_cards = many(1500, i => ({ id: i, user_id: U, deck_id: 'root', imported_notes: { tags: [i === 1499 ? 'last-card-tag' : 'common'] } }));
  const tags = await imported.getDeckTags('root', U);
  expect(tags).toEqual(['common', 'last-card-tag']);
});

test('favorites load past 1000', async () => {
  mockTables.imported_card_favorites = many(1200, i => ({ id: `f${i}`, user_id: U, imported_card_id: `c${i}`, favorited_at: iso(i) }));
  const ids = await favorites.getFavoriteCardIds(U);
  expect(ids.size).toBe(1200);
});
