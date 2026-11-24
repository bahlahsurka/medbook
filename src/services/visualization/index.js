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

function invalidateSaved(entryId) {
  savedCache.delete(entryId);
}

function rememberSaved(entryId, value) {
  savedCache.delete(entryId);
  savedCache.set(entryId, value);
  while (savedCache.size > SAVED_CACHE_LIMIT) savedCache.delete(savedCache.keys().next().value);
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
    try {
      return await callVisualizeEndpoint({ entryId, vizType, extraContext, regenerate: !!regenerate });
    } finally {
      invalidateSaved(entryId);
    }
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
      list => { entry.value = list; return list; },
      err => { if (savedCache.get(entryId) === entry) invalidateSaved(entryId); throw err; },
    );
    rememberSaved(entryId, entry);
    return entry.promise;
  },

  /** Synchronous peek at listSaved()'s cache — the loaded list, or undefined if not loaded yet. */
  peekSaved(entryId) {
    return savedCache.get(entryId)?.value;
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
