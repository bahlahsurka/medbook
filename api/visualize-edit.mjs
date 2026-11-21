// api/visualize-edit.mjs
//
// Phase 4: saves a user's lightweight edit to an already-generated
// visualization, or restores the original AI-generated version — NEVER
// calls Groq either way. Deliberately its own endpoint, not a new action
// bolted onto api/visualize.mjs's generate handler: saving/restoring is a
// structurally different operation (no Groq call, no content-hash cache
// check, no claim/dedup race to worry about) and keeping it separate
// means api/visualize.mjs's generate path needed zero branching to support
// this — exactly the same reasoning that put the "Recommend" feature in
// its own api/visualize-recommend.mjs rather than inside api/visualize.mjs.
//
// Reuses three things from the generate path rather than re-implementing
// them: the auth/RLS-scoped-client pattern, visualizationRegistry.js's
// per-type validator (re-run here against the user's EDITED content, so a
// saved edit can never persist a dangling edge or an invalid node
// reference — the exact same structural guarantee a fresh Groq generation
// gets), and visualizationStorage.js's envelope helpers (so this endpoint
// and api/visualize.mjs's generate endpoint read/write the exact same
// on-disk shape and can't drift apart).
import { createClient } from '@supabase/supabase-js';
import { VisualizationValidationError } from '../src/services/ai/VisualizationValidator.js';
import { SUPPORTED_VIZ_TYPES, getVisualizationDefinition } from '../src/services/ai/visualizationRegistry.js';
import { unwrapGraphData, wrapEdited, wrapRestored, toVisualizationResponseShape } from '../src/services/ai/visualizationStorage.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers?.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization bearer token', kind: 'auth' });

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

  // Scoped to the CALLER's own access token, exactly like api/visualize.mjs
  // — RLS's existing "Users update/select own entry_visualizations" policies
  // (from the Phase 1 migration) are what actually enforce that this
  // endpoint can only ever touch a row the caller owns; there is no
  // separate app-level ownership check below because none is needed.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session', kind: 'auth' });

  const { entryId, vizType, action, editedGraphData, baseUpdatedAt } = req.body || {};

  if (typeof entryId !== 'string' || !entryId.trim()) {
    return res.status(400).json({ error: 'entryId is required.', kind: 'validation' });
  }
  if (typeof vizType !== 'string' || !SUPPORTED_VIZ_TYPES.includes(vizType)) {
    return res.status(400).json({ error: `vizType must be one of: ${SUPPORTED_VIZ_TYPES.join(', ')}.`, kind: 'validation' });
  }
  if (action !== 'save' && action !== 'restore') {
    return res.status(400).json({ error: "action must be 'save' or 'restore'.", kind: 'validation' });
  }
  if (action === 'save' && (!editedGraphData || typeof editedGraphData !== 'object' || Array.isArray(editedGraphData))) {
    return res.status(400).json({ error: 'editedGraphData is required for action "save".', kind: 'validation' });
  }
  const vizDef = getVisualizationDefinition(vizType);

  const { data: existing, error: fetchErr } = await userClient
    .from('entry_visualizations')
    .select('*')
    .eq('entry_id', entryId)
    .eq('viz_type', vizType)
    .maybeSingle();

  if (fetchErr) {
    return res.status(502).json({ error: `Could not load the existing visualization: ${fetchErr.message}`, kind: 'api' });
  }
  if (!existing) {
    return res.status(404).json({ error: 'Nothing has been generated for this entry and type yet.', kind: 'not_found' });
  }

  const { original, current, edited } = unwrapGraphData(existing.graph_data);
  if (!vizDef.isRealDiagram(current)) {
    return res.status(400).json({ error: 'Nothing has finished generating for this entry and type yet — generate a diagram before editing it.', kind: 'validation' });
  }

  // "Prevent accidental overwriting from concurrent editing where
  // practical": the client sends back the updated_at it loaded its draft
  // from; if the row has moved on since (another tab/device saved first),
  // refuse rather than silently clobbering that other save. A real lock
  // would need more infrastructure than a lightweight editing feature
  // warrants — this catches the common case (two tabs, a stale reload)
  // without one.
  if (baseUpdatedAt && existing.updated_at && baseUpdatedAt !== existing.updated_at) {
    return res.status(409).json({
      error: 'This visualization changed elsewhere since you started editing. Reload it to see the latest version before saving again.',
      kind: 'conflict',
    });
  }

  let nextGraphData;
  if (action === 'restore') {
    if (!edited) {
      // Nothing to restore — already showing the original. Idempotent,
      // no-op success rather than an error; still no Groq call either way.
      return res.status(200).json({ action: 'restore', visualization: toVisualizationResponseShape(existing) });
    }
    nextGraphData = wrapRestored(original);
  } else {
    // Re-run the SAME structural validator a fresh Groq generation of
    // this type must pass — this is what actually prevents a saved edit
    // from persisting a dangling edge, a duplicate id, an orphaned node,
    // or any other structurally invalid graph/grid, not just a client-side
    // UI guard that a direct API call could bypass. `allowAiContext`
    // mirrors whatever this row's own generation allowed, so a user can't
    // use editing to retroactively mark new content "from AI context"
    // when no such context was ever supplied for this diagram.
    let validated;
    try {
      validated = vizDef.validate(JSON.stringify(editedGraphData), { allowAiContext: !!existing.extra_context });
    } catch (e) {
      if (e instanceof VisualizationValidationError) {
        return res.status(400).json({ error: e.message, kind: 'validation' });
      }
      throw e;
    }
    nextGraphData = wrapEdited(original, validated, new Date().toISOString());
  }

  const { data: saved, error: saveErr } = await userClient
    .from('entry_visualizations')
    .update({ graph_data: nextGraphData, updated_at: new Date().toISOString() })
    .eq('entry_id', entryId)
    .eq('viz_type', vizType)
    .select()
    .single();

  if (saveErr) {
    // The caller's in-memory draft is untouched by this failure — the
    // client is responsible for keeping it until a save actually
    // succeeds, never discarding it on a failed attempt.
    return res.status(502).json({ error: `Could not save your changes: ${saveErr.message}`, kind: 'api' });
  }

  return res.status(200).json({ action, visualization: toVisualizationResponseShape(saved) });
}
