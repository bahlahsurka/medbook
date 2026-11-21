// services/visualization/index.js
//
// The ONLY surface UI components are allowed to touch for Visual Learning
// — mirrors services/ai/index.js's own role/shape exactly (components call
// VisualizationService.generateMindMap(...) and nothing else), but is its
// own independent module, not an addition to services/ai/index.js. Same
// separation principle the backend already keeps (VisualizationPromptBuilder.js/
// VisualizationValidator.js vs PromptBuilder.js/ResponseParser.js) carried
// through to the client side too.
import { supabase } from '../../lib/supabase.js';

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

async function callVisualizeEndpoint(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new VisualizationServiceError('You need to be signed in to use Visual Learning.', 'auth');
  }

  let res;
  try {
    res = await fetch('/api/visualize', {
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
    const message = body?.error || `Visualization request failed (HTTP ${res.status}).`;
    throw new VisualizationServiceError(message, body?.kind || 'api');
  }
  return body; // { cached, visualization, disclaimer }
}

const VisualizationService = {
  /** Is at least one provider configured? UI uses this to hide the Visual Learning entry point, same as AIService.isConfigured(). */
  isConfigured() { return ENABLED; },

  /**
   * Request (or fetch the cached) Mind Map for one entry. Never called
   * automatically just because an entry was opened — every call here is
   * the direct result of an explicit user action in the caller's own UI.
   *
   * @param {string} entryId
   * @param {{extraContext?: string, regenerate?: boolean}} [options]
   * @returns {Promise<{cached:boolean, visualization:object, disclaimer:string}>}
   */
  async generateMindMap(entryId, { extraContext, regenerate = false } = {}) {
    if (!entryId) throw new VisualizationServiceError('Missing entry id.', 'validation');
    return callVisualizeEndpoint({ entryId, vizType: 'mind_map', extraContext, regenerate: !!regenerate });
  },
};

export default VisualizationService;
