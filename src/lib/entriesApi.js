// lib/entriesApi.js
import { supabase } from './supabase';
import { fetchAllRows } from './fetchAllRows';

/** Every entry the user has, newest first — paged, since a single read
 *  stops silently at 1000 rows. */
export function fetchAllEntries(userId) {
  return fetchAllRows((from, to) => supabase
    .from('entries').select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to));
}
