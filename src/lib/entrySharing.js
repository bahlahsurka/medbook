// lib/entrySharing.js
//
// Share an entry with another MedBook user by link (/s/<token>).
//
// Owner side: Share stores a SNAPSHOT of the entry in `shared_entries`
// (SUPABASE_MIGRATION_SHARED_ENTRIES.sql) — title, notes, difficulty,
// highlights, images, Key Points, flashcard suggestions and saved diagrams.
// The link keeps serving that snapshot until the owner refreshes it
// ("Update shared copy") or deletes the entry (ON DELETE CASCADE).
//
// Recipient side: get_shared_entry(token) (signed-in users only) returns the
// snapshot; "Save" writes an independent copy into the recipient's own
// account under their own RLS: images are copied into their storage folder,
// the entry goes into the same-named system (added to their list if
// missing), and diagrams become their own entry_visualizations rows. Review
// progress starts fresh. Nothing ever writes to the owner's data.
import { supabase } from './supabase';
import { saveSystems } from './systems';
import { contentHashHex } from './contentHash';
import { unwrapGraphData } from '../services/ai/visualizationStorage';
import { isRealSavedDiagram } from '../services/visualization';

export const SNAPSHOT_VERSION = 1;
const BUCKET = 'entry-images';
const VIZ_TYPES = new Set(['mind_map', 'knowledge_network', 'clinical_flowchart', 'mechanism_diagram', 'comparison_map', 'visual_summary']);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard']);
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_KEY = 'medbook_pending_share';

// ── Links ───────────────────────────────────────────────────────────────

export function shareUrl(token, origin = (typeof window !== 'undefined' ? window.location.origin : '')) {
  return `${origin}/s/${token}`;
}

/** The token in a /s/<token> path, or null. */
export function parseShareToken(pathname) {
  const m = /^\/s\/([^/?#]+)\/?$/.exec(String(pathname || ''));
  return m && TOKEN_RE.test(m[1]) ? m[1].toLowerCase() : null;
}

// A link opened while signed out survives the sign-in (including Google's
// redirect back to the site root) by waiting in localStorage.
export function rememberPendingShare(token) {
  try { localStorage.setItem(PENDING_KEY, token); } catch { /* storage unavailable */ }
}
export function takePendingShare() {
  try {
    const v = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    return v && TOKEN_RE.test(v) ? v.toLowerCase() : null;
  } catch { return null; }
}

// ── Snapshot ────────────────────────────────────────────────────────────

/** JSON with object keys sorted at every level (jsonb reorders keys). */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(k => value[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function sameSnapshot(a, b) {
  return !!a && !!b && stableStringify(a) === stableStringify(b);
}

/** Pure: the shareable snapshot of an entry row + its saved diagram rows. */
export function snapshotFrom(entry, vizRows, systemColor) {
  const ai = entry.ai_sections && typeof entry.ai_sections === 'object' ? entry.ai_sections : {};
  const visualizations = (vizRows || [])
    .filter(r => VIZ_TYPES.has(r.viz_type) && isRealSavedDiagram(r.viz_type, unwrapGraphData(r.graph_data).current))
    .sort((x, y) => (x.viz_type < y.viz_type ? -1 : x.viz_type > y.viz_type ? 1 : 0))
    .map(r => ({
      vizType: r.viz_type,
      graphData: r.graph_data,
      sourceContentHash: r.source_content_hash || null,
      extraContext: r.extra_context || null,
      aiProvider: r.ai_provider || null,
      aiModel: r.ai_model || null,
    }));
  return {
    v: SNAPSHOT_VERSION,
    title: entry.title || '',
    notes: entry.notes || '',
    difficulty: entry.difficulty || 'Medium',
    system: entry.system || '',
    systemColor: systemColor || null,
    highlights: Array.isArray(entry.highlights) ? entry.highlights : [],
    images: Array.isArray(entry.images) ? entry.images.filter(u => typeof u === 'string' && u) : [],
    keyPoints: ai.keyPoints && typeof ai.keyPoints === 'object' ? ai.keyPoints : null,
    flashcards: Array.isArray(ai.flashcards) ? ai.flashcards : [],
    visualizations,
  };
}

/** Reads the entry and its saved diagrams fresh from the database. */
export async function buildSnapshot(entryId, systemColor) {
  const { data: entry, error } = await supabase.from('entries').select('*').eq('id', entryId).single();
  if (error || !entry) throw new Error(error?.message || 'Could not read this entry.');
  const { data: rows, error: vErr } = await supabase.from('entry_visualizations')
    .select('viz_type, graph_data, source_content_hash, extra_context, ai_provider, ai_model')
    .eq('entry_id', entryId);
  if (vErr) throw new Error(vErr.message);
  return snapshotFrom(entry, rows, systemColor);
}

// ── Owner ───────────────────────────────────────────────────────────────

/** The entry's share row ({ token, snapshot }) or null. */
export async function getShare(entryId) {
  const { data, error } = await supabase.from('shared_entries')
    .select('token, snapshot, updated_at').eq('entry_id', entryId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function createShare(entryId, userId, snapshot) {
  const { data, error } = await supabase.from('shared_entries')
    .insert({ entry_id: entryId, user_id: userId, snapshot }).select('token, snapshot, updated_at').single();
  if (error) {
    // Created a moment ago (another tab / double tap): use that one.
    if (error.code === '23505') {
      const existing = await getShare(entryId);
      if (existing) return existing;
    }
    throw new Error(error.message);
  }
  return data;
}

export async function updateShare(token, snapshot) {
  const { data, error } = await supabase.from('shared_entries')
    .update({ snapshot, updated_at: new Date().toISOString() }).eq('token', token)
    .select('token, snapshot, updated_at').single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Recipient ───────────────────────────────────────────────────────────

/** { snapshot, isOwner, entryId } for a link, or null when it isn't available. */
export async function fetchSharedEntry(token) {
  const { data, error } = await supabase.rpc('get_shared_entry', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data || !data.snapshot || typeof data.snapshot !== 'object') return null;
  return data;
}

// Only images stored in MedBook's own public bucket are copied.
export function isOwnStorageImage(url, supabaseUrl = process.env.REACT_APP_SUPABASE_URL) {
  if (typeof url !== 'string' || !supabaseUrl) return false;
  return url.startsWith(`${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/`);
}

function extensionOf(url, type) {
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(String(url).split('/').pop() || '');
  if (m) return m[1].toLowerCase();
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return 'jpg';
}

async function copyImage(url, userId) {
  if (!isOwnStorageImage(url)) throw new Error('not a MedBook image');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${extensionOf(url, type)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Saves the shared snapshot as the recipient's own entry.
 * @returns {Promise<{ entry, systems, addedSystem: boolean, failedImages: number, failedDiagrams: number }>}
 *   `systems` is the recipient's (possibly extended) system list.
 */
export async function saveSharedCopy(snapshot, userId, userSystems) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('This shared entry can\'t be read.');
  const system = String(snapshot.system || '').trim() || 'Internal Medicine';

  // Same system name; added to the recipient's list if they don't have it.
  let systems = Array.isArray(userSystems) ? userSystems : [];
  let addedSystem = false;
  if (!systems.some(s => s.name === system)) {
    const color = /^#[0-9a-f]{6}$/i.test(snapshot.systemColor || '') ? snapshot.systemColor : '#2563eb';
    systems = [...systems, { name: system, color, custom: true }];
    await saveSystems(userId, systems);
    addedSystem = true;
  }

  // Copy images into the recipient's own storage (in order; failures skipped).
  const images = [];
  let failedImages = 0;
  for (const url of Array.isArray(snapshot.images) ? snapshot.images : []) {
    try { images.push(await copyImage(url, userId)); } catch { failedImages += 1; }
  }

  const aiSections = {};
  if (snapshot.keyPoints && typeof snapshot.keyPoints === 'object') aiSections.keyPoints = snapshot.keyPoints;
  if (Array.isArray(snapshot.flashcards) && snapshot.flashcards.length) aiSections.flashcards = snapshot.flashcards;

  const row = {
    user_id: userId,
    system,
    title: String(snapshot.title || '').trim() || 'Untitled',
    notes: String(snapshot.notes || ''),
    difficulty: DIFFICULTIES.has(snapshot.difficulty) ? snapshot.difficulty : 'Medium',
    images,
    highlights: Array.isArray(snapshot.highlights) ? snapshot.highlights : [],
    ai_sections: aiSections,
    pinned: false,
    review_count: 0,
    last_reviewed: null,
  };
  const { data: entry, error } = await supabase.from('entries').insert(row).select().single();
  if (error) throw new Error(`Save failed: ${error.message}`);

  // Saved diagrams become the recipient's own rows for the new entry.
  const vizIn = (Array.isArray(snapshot.visualizations) ? snapshot.visualizations : [])
    .filter(v => v && VIZ_TYPES.has(v.vizType) && v.graphData && typeof v.graphData === 'object');
  let failedDiagrams = 0;
  if (vizIn.length) {
    const seen = new Set();
    const vizRows = [];
    for (const v of vizIn) {
      if (seen.has(v.vizType)) continue;
      seen.add(v.vizType);
      const hash = (typeof v.sourceContentHash === 'string' && v.sourceContentHash)
        || await contentHashHex(row.notes, v.extraContext || '') || 'shared';
      vizRows.push({
        entry_id: entry.id, user_id: userId, viz_type: v.vizType, graph_data: v.graphData,
        source_content_hash: hash, extra_context: v.extraContext || null,
        ai_provider: v.aiProvider || null, ai_model: v.aiModel || null,
      });
    }
    const { error: vErr } = await supabase.from('entry_visualizations').insert(vizRows);
    if (vErr) failedDiagrams = vizRows.length;
  }

  return { entry, systems, addedSystem, failedImages, failedDiagrams };
}
