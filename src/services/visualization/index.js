// services/visualization/index.js
//
// The ONLY surface UI components are allowed to touch for Visual Learning
// — mirrors services/ai/index.js's own role/shape exactly (components call
// VisualizationService.generate(vizType, ...) and nothing else), but is its
// own independent module, not an addition to services/ai/index.js. Same
// separation principle the backend already keeps (VisualizationPromptBuilder.js/
// VisualizationValidator.js vs PromptBuilder.js/ResponseParser.js) carried
// through to the client side too.
import { supabase } from '../../lib/supabase.js';
import { toVisualizationResponseShape } from '../ai/visualizationStorage.js';

/** Thrown for anything that isn't a structural-validation failure the server already reported as such. */
export class VisualizationServiceError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'VisualizationServiceError';
    this.kind = kind; // 'auth' | 'network' | 'validation' | 'not_found' | 'quota' | 'config' | 'overloaded' | 'invalid_diagram' | 'api'
  }
}

// Reuses the exact same signal services/ai/index.js already uses — "is at
// least one AI provider configured server-side" is one underlying fact
// (today, Groq), not a per-feature config. No separate env var needed for
// this to hide itself the same way the Analyze button already does in a
// fresh checkout with no keys set up.
const ENABLED = process.env.REACT_APP_AI_ENABLED === 'true';

// Shared by every endpoint under this service (generate, recommend, and
// Phase 4's save/restore) — one place for the auth/network/error-shape
// handling every one of them needs identically, rather than three
// near-identical copies.
async function postJson(path, payload, failureNoun) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new VisualizationServiceError('You need to be signed in to use Visual Learning.', 'auth');
  }

  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new VisualizationServiceError('Network error reaching MedBook\'s Visual Learning endpoint. Check your connection.', 'network');
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const message = body?.error || `${failureNoun} failed (HTTP ${res.status}).`;
    throw new VisualizationServiceError(message, body?.kind || 'api');
  }
  return body;
}

function callVisualizeEndpoint(payload) {
  return postJson('/api/visualize', payload, 'Visualization request'); // { cached, visualization, disclaimer }
}

// Same "is this a finished diagram, not an in-progress claim row" checks as
// visualizationRegistry.js's isRealDiagram (that module is server-only).
function isRealSavedDiagram(vizType, diagram) {
  if (!diagram || typeof diagram !== 'object') return false;
  if (vizType === 'comparison_map') return Array.isArray(diagram.cells) && diagram.cells.length > 0;
  if (vizType === 'visual_summary') return Array.isArray(diagram.highlights) && diagram.highlights.length > 0;
  return Array.isArray(diagram.nodes) && diagram.nodes.length > 0;
}

// Read-only cache for listSaved(), keyed by entry id. Holds the in-flight
// promise too, so concurrent opens share one query. Small LRU bound so a
// long review session can't grow it without limit.
const SAVED_CACHE_LIMIT = 40;
const savedCache = new Map();

// Lightweight "which types are saved" index for many entries at once — fed
// by prefetchSavedTypes() (entry_id + viz_type only, never graph_data) and
// by listSaved() results. Lets review screens show a saved count on the
// Visual Learning button before it's opened.
const TYPES_CACHE_LIMIT = 2000;
const typesCache = new Map();
const typesInFlight = new Set();
const listeners = new Set();
function notify() { listeners.forEach(fn => { try { fn(); } catch { /* listener errors are not ours */ } }); }
function rememberTypes(entryId, types) {
  typesCache.set(entryId, types);
  while (typesCache.size > TYPES_CACHE_LIMIT) typesCache.delete(typesCache.keys().next().value);
}

// Bumped whenever an entry's saved diagrams change (generate, save, restore,
// delete), so views showing one (the review card) know to re-read.
const revisions = new Map();
function bumpRevision(entryId) { revisions.set(entryId, (revisions.get(entryId) || 0) + 1); }

function invalidateSaved(entryId) {
  savedCache.delete(entryId);
  typesCache.delete(entryId);
  bumpRevision(entryId);
  notify();
}

function rememberSaved(entryId, value) {
  savedCache.delete(entryId);
  savedCache.set(entryId, value);
  while (savedCache.size > SAVED_CACHE_LIMIT) savedCache.delete(savedCache.keys().next().value);
}

// In-flight generate() calls, by entry + type.
const generations = new Map();
const generationKey = (entryId, vizType) => `${entryId}\u0000${vizType}`;

// After a successful generation: the saved list is re-read next time, and
// the saved-types index gains this type at once (so a review screen's
// "N saved" count updates even if the panel was closed meanwhile).
function recordGenerated(entryId, vizType, res) {
  savedCache.delete(entryId);
  const known = typesCache.get(entryId);
  if (!res?.visualization) { invalidateSaved(entryId); return; }
  bumpRevision(entryId);
  if (known) {
    if (!known.includes(vizType)) rememberTypes(entryId, [...known, vizType]);
    notify();
  } else {
    notify();
    VisualizationService.listSaved(entryId).catch(() => {});
  }
}

async function fetchSaved(entryId) {
  const { data, error } = await supabase
    .from('entry_visualizations')
    .select('id, entry_id, viz_type, graph_data, extra_context, ai_provider, ai_model, source_content_hash, created_at, updated_at')
    .eq('entry_id', entryId);
  if (error) throw new VisualizationServiceError(`Could not load saved visualizations: ${error.message}`, 'api');
  return (data || [])
    .map(toVisualizationResponseShape)
    .filter(v => isRealSavedDiagram(v.vizType, v.graphData));
}

const VisualizationService = {
  /** Is at least one provider configured? UI uses this to hide the Visual Learning entry point, same as AIService.isConfigured(). */
  isConfigured() { return ENABLED; },

  /**
   * Request (or fetch the cached) diagram of the given type for one entry.
   * Never called automatically just because an entry was opened or a type
   * was selected — every call here is the direct result of an explicit
   * Generate/Regenerate click in the caller's own UI.
   *
   * @param {string} vizType — one of visualizationRegistry.js's six types.
   * @param {string} entryId
   * @param {{extraContext?: string, regenerate?: boolean}} [options]
   * @returns {Promise<{cached:boolean, visualization:object, disclaimer:string}>}
   */
  async generate(vizType, entryId, { extraContext, regenerate = false } = {}) {
    if (!entryId) throw new VisualizationServiceError('Missing entry id.', 'validation');
    if (!vizType) throw new VisualizationServiceError('Missing visualization type.', 'validation');
    const key = generationKey(entryId, vizType);
    const pending = generations.get(key);
    if (pending) return pending.promise;
    const promise = (async () => {
      try {
        const res = await callVisualizeEndpoint({ entryId, vizType, extraContext, regenerate: !!regenerate });
        recordGenerated(entryId, vizType, res);
        return res;
      } catch (e) {
        invalidateSaved(entryId);
        throw e;
      } finally {
        generations.delete(key);
      }
    })();
    generations.set(key, { promise, startedAt: Date.now() });
    return promise;
  },

  /**
   * Generations still running for an entry — they keep going (and save)
   * when the panel that started them closes, so a panel opened again
   * meanwhile can show their progress instead of offering Generate again.
   * @returns {{vizType:string, promise:Promise, startedAt:number}[]}
   */
  pendingGenerations(entryId) {
    const out = [];
    generations.forEach((g, k) => { const [id, vizType] = k.split('\u0000'); if (id === entryId) out.push({ vizType, ...g }); });
    return out;
  },

  /**
   * Read-only: the entry's already-saved visualizations (current version,
   * with original/edited info), straight from entry_visualizations under
   * RLS. Never calls /api/visualize, so it can never trigger a Groq
   * generation — even when a saved diagram is stale. Unfinished claim rows
   * are filtered out. Cached per entry for the browser session; invalidated
   * whenever generate/saveEdit/restoreOriginal touches that entry.
   *
   * @param {string} entryId
   * @returns {Promise<object[]>} visualization objects (toVisualizationResponseShape)
   */
  listSaved(entryId) {
    if (!entryId) return Promise.reject(new VisualizationServiceError('Missing entry id.', 'validation'));
    const hit = savedCache.get(entryId);
    if (hit) {
      rememberSaved(entryId, hit);
      return hit.promise;
    }
    const entry = { promise: null, value: undefined };
    entry.promise = fetchSaved(entryId).then(
      list => { entry.value = list; rememberTypes(entryId, list.map(v => v.vizType)); notify(); return list; },
      err => { if (savedCache.get(entryId) === entry) invalidateSaved(entryId); throw err; },
    );
    rememberSaved(entryId, entry);
    return entry.promise;
  },

  /** Synchronous peek at listSaved()'s cache — the loaded list, or undefined if not loaded yet. */
  peekSaved(entryId) {
    return savedCache.get(entryId)?.value;
  },

  /**
   * Which visualization types are saved for an entry, if known (from a
   * prefetch or a listSaved), else undefined. Synchronous.
   * @returns {string[]|undefined}
   */
  getSavedTypes(entryId) {
    // Same array instance until it changes (listSaved also records here),
    // as useSyncExternalStore requires.
    return typesCache.get(entryId);
  },

  /** A number that changes whenever this entry's saved diagrams change (for useSyncExternalStore). */
  getSavedRevision(entryId) {
    return revisions.get(entryId) || 0;
  },

  /** Subscribe to changes in saved-type knowledge (for useSyncExternalStore). */
  subscribeSaved(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * One batched, read-only lookup of which types are saved for up to 100
   * entries (entry_id + viz_type only — no diagram payloads, never Groq).
   * Entries already known or in flight are skipped, so calling this for a
   * review window as the user moves through it costs one small request
   * per ~100 new cards. Failures are silent: counts are a convenience.
   */
  async prefetchSavedTypes(entryIds) {
    const ids = [...new Set(entryIds || [])].filter(id => id && !typesCache.has(id) && !savedCache.get(id)?.value && !typesInFlight.has(id)).slice(0, 100);
    if (!ids.length) return;
    ids.forEach(id => typesInFlight.add(id));
    try {
      const { data, error } = await supabase
        .from('entry_visualizations')
        .select('entry_id, viz_type')
        .in('entry_id', ids)
        .neq('graph_data', '{}'); // skip in-progress claim rows
      if (error) return;
      const byEntry = new Map(ids.map(id => [id, []]));
      (data || []).forEach(r => byEntry.get(r.entry_id)?.push(r.viz_type));
      byEntry.forEach((types, id) => rememberTypes(id, types));
      notify();
    } catch { /* offline etc. — counts simply stay unknown */ }
    finally {
      ids.forEach(id => typesInFlight.delete(id));
    }
  },

  /** @deprecated Use generate('mind_map', entryId, options) — kept only so nothing outside this module needs to change if it still calls this directly. */
  async generateMindMap(entryId, options) {
    return this.generate('mind_map', entryId, options);
  },

  /**
   * Suggests which of the six visualization types best fit an entry's
   * Review content — a lightweight, separate classification request, not
   * a diagram generation. Never runs automatically; only in response to
   * the user clicking "Recommend".
   *
   * @param {string} entryId
   * @returns {Promise<{recommended:string[], rationale:string}>}
   */
  async recommend(entryId) {
    if (!entryId) throw new VisualizationServiceError('Missing entry id.', 'validation');
    return postJson('/api/visualize-recommend', { entryId }, 'Recommendation request'); // { recommended, rationale }
  },

  /**
   * Phase 4: saves a user's edited diagram for one entry+type, re-validated
   * server-side against the exact same structural rules a fresh Groq
   * generation of that type must pass (so a saved edit can never persist a
   * dangling edge or an invalid node reference). Never calls Groq.
   *
   * @param {string} vizType
   * @param {string} entryId
   * @param {object} editedGraphData — the user's in-memory draft diagram.
   * @param {{baseUpdatedAt?: string}} [options] — the `updatedAt` this
   *   draft was loaded from, for the server's optimistic-concurrency check.
   * @returns {Promise<{action:'save', visualization:object}>}
   */
  /**
   * Permanently delete one saved diagram (both its AI original and any edit)
   * from an entry. Only ever called after the user confirms Delete. RLS
   * limits the delete to the signed-in user's own rows; no AI call.
   */
  async deleteSaved(vizType, entryId) {
    if (!entryId || !vizType) throw new VisualizationServiceError('Missing entry or visualization type.', 'validation');
    try {
      const { error } = await supabase.from('entry_visualizations').delete()
        .eq('entry_id', entryId).eq('viz_type', vizType);
      if (error) throw new VisualizationServiceError(`Could not delete this diagram: ${error.message}`, 'api');
    } finally {
      invalidateSaved(entryId);
    }
  },

  async saveEdit(vizType, entryId, editedGraphData, { baseUpdatedAt } = {}) {
    if (!entryId) throw new VisualizationServiceError('Missing entry id.', 'validation');
    if (!vizType) throw new VisualizationServiceError('Missing visualization type.', 'validation');
    try {
      return await postJson('/api/visualize-edit', { entryId, vizType, action: 'save', editedGraphData, baseUpdatedAt }, 'Save');
    } finally {
      invalidateSaved(entryId);
    }
  },

  /**
   * Phase 4: reverts a diagram to the original AI-generated version —
   * never calls Groq, purely a database update of the already-stored
   * original.
   *
   * @returns {Promise<{action:'restore', visualization:object}>}
   */
  async restoreOriginal(vizType, entryId, { baseUpdatedAt } = {}) {
    if (!entryId) throw new VisualizationServiceError('Missing entry id.', 'validation');
    if (!vizType) throw new VisualizationServiceError('Missing visualization type.', 'validation');
    try {
      return await postJson('/api/visualize-edit', { entryId, vizType, action: 'restore', baseUpdatedAt }, 'Restore');
    } finally {
      invalidateSaved(entryId);
    }
  },
};

export default VisualizationService;
