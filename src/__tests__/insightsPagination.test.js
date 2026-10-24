// Regression test for: Insights' study_sessions (and review_log) fetch had
// no explicit pagination, so Supabase/PostgREST's default 1000-row response
// cap could silently truncate a regular, heavy user's result — losing
// exactly the MOST RECENT activity off an ascending-ordered fetch, which is
// what the Study Time chart and its "last 7 days" trend most need. Fixed by
// fetchAllRows, which pages through with .range() until a page comes back
// shorter than requested.
import { fetchAllRows } from '../components/Insights';

// A fake paginated table: `rows` is the FULL backing data; each call
// returns up to `pageSize` rows starting at `from`, mimicking exactly how
// Supabase/PostgREST behaves under its row cap.
function fakeTable(rows, pageSize) {
  return (from, to) => {
    const page = rows.slice(from, Math.min(to + 1, from + pageSize));
    return Promise.resolve({ data: page, error: null });
  };
}

test('a result smaller than one page comes back whole in a single request', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  let calls = 0;
  const buildQuery = (from, to) => { calls++; return fakeTable(rows, 1000)(from, to); };

  const { data, error } = await fetchAllRows(buildQuery);

  expect(error).toBeNull();
  expect(data.length).toBe(5);
  expect(calls).toBe(1);
});

test('a result exactly as large as the server page cap is NOT silently truncated — this is the actual bug', async () => {
  // Simulates Supabase/PostgREST's default max-rows: a single request can
  // only ever return at most 1000 rows, no matter how the query is written.
  // A real user with more study_sessions rows than this in their 30-day
  // window used to lose everything past row 1000 before this fix.
  const SERVER_CAP = 1000;
  const totalRows = 2500; // comfortably more than one page, less than three full ones
  const rows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  let calls = 0;
  const buildQuery = (from, to) => { calls++; return fakeTable(rows, SERVER_CAP)(from, to); };

  const { data, error } = await fetchAllRows(buildQuery);

  expect(error).toBeNull();
  // The whole point: every row makes it back, not just the server's single-
  // request cap worth.
  expect(data.length).toBe(totalRows);
  expect(data[data.length - 1]).toEqual({ id: totalRows - 1 });
  // 2500 rows at 1000/page takes 3 requests (1000 + 1000 + 500).
  expect(calls).toBe(3);
});

test('an error on any page is surfaced immediately, not masked by partial data', async () => {
  const buildQuery = jest.fn()
    .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

  const { data, error } = await fetchAllRows(buildQuery);

  expect(data).toBeNull();
  expect(error).toEqual({ message: 'boom' });
});

test('an empty result returns an empty array, not null, with one request', async () => {
  const buildQuery = jest.fn().mockResolvedValue({ data: [], error: null });

  const { data, error } = await fetchAllRows(buildQuery);

  expect(error).toBeNull();
  expect(data).toEqual([]);
  expect(buildQuery).toHaveBeenCalledTimes(1);
});
