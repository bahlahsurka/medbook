// lib/fetchAllRows.js
//
// Supabase/PostgREST returns at most 1000 rows per request (a project-level
// "max rows" setting a caller can't raise) and silently truncates past it —
// it does NOT error. Any read that can grow past that (a user's entries,
// cards, review logs, due cards…) must page through with .range().
//
// `buildQuery(from, to)` must return a FRESH query each call with every
// filter/order applied (a builder can't be re-awaited) and `.range(from, to)`
// appended. Order by a unique column last (e.g. id) so pages never overlap
// or skip rows. Stops when a page comes back short.
export const PAGE_SIZE = 1000;

export async function fetchAllRows(buildQuery) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (data) all = all.concat(data);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null };
}
