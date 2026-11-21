// api/visualize.mjs
//
// Visual Learning (Phase 1) backend: generates an interactive Mind Map from
// an entry's Review text via Groq. Deliberately its own endpoint, not an
// addition to api/analyze.mjs — same separation VisualizationPromptBuilder.js/
// VisualizationValidator.js already keep from the AI Analysis pipeline.
// The only thing genuinely shared with analyze.mjs is GroqService.js's
// transport (auth header, retry/backoff, error-kind mapping) — the prompt,
// schema, validation, caching, and database model here are all new and
// independent, so this feature can never accidentally corrupt or depend on
// entries.ai_sections / the flashcards pipeline.
//
// Differs from api/analyze.mjs in one deliberate way: analyze.mjs trusts
// whatever reviewText the client sends. This endpoint does NOT — it takes
// only an entryId and fetches entry.notes itself, server-side, through a
// Supabase client scoped to the caller's own access token (so Postgres RLS
// — "Users see own entries" — is the actual enforcer of ownership, not an
// app-level string comparison alone). A client could lie about entryId
// belonging to it; RLS silently returns no row either way, which this
// handler treats as 404 regardless of WHY no row came back (wrong id,
// someone else's entry — never leak which).
//
// GROQ_API_KEY stays exactly where api/analyze.mjs already keeps it:
// server-side only, no REACT_APP_ prefix, read once inside GroqService.js.
// Nothing new here changes that.

import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../src/services/ai/GroqService.js';
import {
  buildMindMapPrompt, MINDMAP_SYSTEM_INSTRUCTION, GROQ_MINDMAP_SCHEMA,
  SUPPORTED_VIZ_TYPES,
} from '../src/services/ai/VisualizationPromptBuilder.js';
import { validateMindMap, VisualizationValidationError } from '../src/services/ai/VisualizationValidator.js';
import { computeContentHash } from '../src/services/ai/contentHash.js';

// Same floor api/analyze.mjs enforces on the same underlying field
// (entry.notes) — a Review too short to meaningfully analyze is equally
// too short to meaningfully diagram.
const MIN_NOTES_LENGTH = 40;

// One schema name per visualization type, passed through to Groq's
// response_format.json_schema.name (purely a label Groq logs/validates
// against, not a lookup key) — kept here, next to SUPPORTED_VIZ_TYPES,
// rather than inside GroqService.js, since it's specific to WHAT is being
// generated, not to the transport itself.
const SCHEMA_NAME_FOR_TYPE = { mind_map: 'medbook_mind_map' };

// Maps a transport/validation-level failure to an HTTP status the client
// can react to sensibly — same vocabulary api/analyze.mjs's statusForKind
// uses for the kinds they share (quota/auth/config/overloaded), plus a few
// specific to this endpoint.
function statusForKind(kind) {
  switch (kind) {
    case 'validation': return 400;
    case 'not_found': return 404;
    case 'quota': return 429;
    case 'auth': return 401;
    case 'config': return 500;
    case 'overloaded': return 503;
    case 'invalid_diagram': return 502;
    default: return 502; // network / truncated / empty / api / invalid_output
  }
}

// Not a medical claim, just an accurate description of what the 200 response
// below actually guarantees — included in the payload itself (not just a
// code comment) so nothing downstream can forget it or silently drop it.
// See VisualizationValidator.js's own header comment for the full reasoning.
const STRUCTURAL_VALIDATION_DISCLAIMER =
  'This diagram has passed structural validation only (unique node ids, valid edge references, required fields present). ' +
  'It has NOT been checked for medical correctness — treat it as an organization of the source review, not a verified-accurate ' +
  'reference, and note that any node/edge marked with "ai_context" provenance came from supplementary context, not the review itself.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers?.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization bearer token', kind: 'auth' });

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

  // One client, scoped to the CALLER's own access token (not the service
  // role) — every read/write below goes through this, so Postgres RLS
  // ("Users see/insert/update own ...") is what actually enforces
  // ownership end to end, exactly like every client-side Supabase call in
  // this app already relies on, just moved server-side for this one field
  // (entry.notes) that must not be trusted from the client directly.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session', kind: 'auth' });

  const { entryId, vizType, extraContext, regenerate } = req.body || {};

  if (typeof entryId !== 'string' || !entryId.trim()) {
    return res.status(400).json({ error: 'entryId is required.', kind: 'validation' });
  }
  if (typeof vizType !== 'string' || !SUPPORTED_VIZ_TYPES.includes(vizType)) {
    return res.status(400).json({
      error: `vizType must be one of: ${SUPPORTED_VIZ_TYPES.join(', ')}.`,
      kind: 'validation',
    });
  }
  const trimmedExtraContext = String(extraContext || '').trim();
  const wantsRegenerate = regenerate === true;

  // ---- Fetch the entry server-side — never trust client-supplied notes.
  // A row coming back at all already means this user owns it (RLS), but
  // the explicit check below makes that guarantee legible in this code,
  // not just implicit in a policy defined elsewhere. ----
  const { data: entry, error: entryErr } = await userClient
    .from('entries')
    .select('id, user_id, notes')
    .eq('id', entryId)
    .maybeSingle();

  if (entryErr || !entry || entry.user_id !== user.id) {
    // Same response whether the id is simply wrong or belongs to someone
    // else — never confirm another user's entry exists.
    return res.status(404).json({ error: 'Entry not found.', kind: 'not_found' });
  }

  const notes = String(entry.notes || '').trim();
  if (!notes) {
    return res.status(400).json({ error: 'This entry has no Review text to build a diagram from.', kind: 'validation' });
  }
  if (notes.length < MIN_NOTES_LENGTH) {
    return res.status(400).json({ error: 'The Review is too short to diagram meaningfully. Write a bit more first.', kind: 'validation' });
  }

  const contentHash = computeContentHash(notes, trimmedExtraContext);

  // ---- Cache check: same entry + type + hash means the source content
  // hasn't changed since this was last generated — return it as-is, no
  // Groq call. entry_visualizations has at most ONE row per (entry_id,
  // viz_type) (its own unique constraint), so a hash MISMATCH on that one
  // row means the Review was edited since — this is the stale-cache case,
  // and it falls straight through to generation below without needing a
  // separate "is this stale" flag anywhere. `regenerate: true` is the only
  // thing that skips an otherwise-valid, up-to-date cache hit. ----
  const { data: existing, error: existingErr } = await userClient
    .from('entry_visualizations')
    .select('*')
    .eq('entry_id', entryId)
    .eq('viz_type', vizType)
    .maybeSingle();

  if (existingErr) {
    return res.status(502).json({ error: `Could not check for an existing diagram: ${existingErr.message}`, kind: 'api' });
  }

  if (existing && existing.source_content_hash === contentHash && !wantsRegenerate) {
    return res.status(200).json({
      cached: true,
      visualization: toResponseShape(existing),
      disclaimer: STRUCTURAL_VALIDATION_DISCLAIMER,
    });
  }

  // ---- Generate. Groq only in this phase — see this file's header
  // comment and the audit: a second provider can be added later by
  // branching here exactly the way api/analyze.mjs branches to Gemini,
  // without touching anything above or below this block. ----
  if (!GroqService.isConfigured()) {
    return res.status(500).json({
      error: 'No visualization provider is configured (set GROQ_API_KEY in Vercel).',
      kind: 'config',
    });
  }

  const prompt = buildMindMapPrompt(notes, trimmedExtraContext);
  let rawText;
  let model;
  try {
    rawText = await GroqService.generate(prompt, {
      systemInstruction: MINDMAP_SYSTEM_INSTRUCTION,
      responseSchema: GROQ_MINDMAP_SCHEMA,
      schemaName: SCHEMA_NAME_FOR_TYPE[vizType],
    });
    model = GroqService.activeModel();
  } catch (e) {
    return res.status(statusForKind(e.kind)).json({
      error: e.message, kind: e.kind || 'api', provider: 'groq', model: GroqService.activeModel(),
    });
  }

  let diagram;
  try {
    diagram = validateMindMap(rawText, { allowAiContext: !!trimmedExtraContext });
  } catch (e) {
    if (e instanceof VisualizationValidationError) {
      return res.status(statusForKind(e.kind)).json({ error: e.message, kind: e.kind, provider: 'groq', model });
    }
    throw e;
  }

  // ---- Persist. upsert on (entry_id, viz_type) — a regenerate REPLACES
  // this entry+type's one cached row in place rather than accumulating
  // history (see the migration's own comment); a different viz_type for
  // the same entry is an entirely different row and is never touched by
  // this. created_at is deliberately left out of the payload so an UPDATE
  // path never resets it — only a fresh INSERT gets the column default. ----
  const { data: saved, error: saveErr } = await userClient
    .from('entry_visualizations')
    .upsert({
      entry_id: entryId,
      user_id: user.id,
      viz_type: vizType,
      source_content_hash: contentHash,
      extra_context: trimmedExtraContext || null,
      graph_data: diagram,
      ai_provider: 'groq',
      ai_model: model,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'entry_id,viz_type' })
    .select()
    .single();

  if (saveErr) {
    return res.status(502).json({ error: `Diagram generated but could not be saved: ${saveErr.message}`, kind: 'api' });
  }

  return res.status(200).json({
    cached: false,
    visualization: toResponseShape(saved),
    disclaimer: STRUCTURAL_VALIDATION_DISCLAIMER,
  });
}

/** DB row -> API shape — camelCase, and never leaks user_id to the response body. */
function toResponseShape(row) {
  return {
    id: row.id,
    entryId: row.entry_id,
    vizType: row.viz_type,
    graphData: row.graph_data,
    extraContext: row.extra_context,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    sourceContentHash: row.source_content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
