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
import { findUncoveredStatements, SOURCE_COVERAGE_DISCLAIMER } from '../src/services/ai/sourceCoverage.js';

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

// A Mind Map's output (a graph with per-node explanations/sourceRefs) is
// structurally more verbose than the flat six-section analysis, but a
// SHORT review genuinely needs far less reasoning+output budget than a
// long, dense one — see api/visualize.mjs's own reliability-fix history:
// a generous FLAT budget for every request was pure waste on simple
// entries (slower than it needed to be) without actually helping complex
// ones any more than a scaled budget does. Tiers, not a formula, because
// the exact relationship between notes length and tokens needed isn't
// something to over-fit a formula to without real measurements — these
// are deliberately coarse and easy to retune once real latency/usage
// numbers (now captured — see GroqService.getLastUsage()) come back from
// production.
function tokenBudgetFor(notesLength) {
  if (notesLength < 400) return 8192;
  if (notesLength < 1200) return 16384;
  return 24576; // still below the 32768 the six-section analysis task uses for its own, separate reasons
}

// Reusable "someone else is already generating this" response — kept as
// one function since it's returned from two different call sites below
// (an in-progress claim found on first look, and a 23505 insert race).
function inProgressResponse(res) {
  return res.status(409).json({
    error: 'A Mind Map is already being generated for this entry — please wait a few seconds and try again.',
    kind: 'in_progress',
  });
}

// How long an unfinished "claim" row (graph_data still {}) is trusted to
// mean "actively generating" rather than "abandoned after a failure" — see
// the claim/dedup block below. Comfortably longer than this endpoint's own
// realistic worst case after the 'medium' reasoning-effort and adaptive
// token-budget changes, short enough that a genuinely abandoned claim
// doesn't block retries for long.
const CLAIM_STALE_MS = 45_000;
function isRealDiagram(graphData) {
  return !!graphData && Array.isArray(graphData.nodes) && graphData.nodes.length > 0;
}

// Maps a transport/validation-level failure to an HTTP status the client
// can react to sensibly — same vocabulary api/analyze.mjs's statusForKind
// uses for the kinds they share (quota/auth/config/overloaded), plus a few
// specific to this endpoint.
function statusForKind(kind) {
  switch (kind) {
    case 'validation': return 400;
    case 'not_found': return 404;
    case 'in_progress': return 409;
    case 'quota': return 429;
    case 'auth': return 401;
    case 'config': return 500;
    case 'overloaded': return 503;
    case 'invalid_diagram': return 502;
    default: return 502; // network / truncated / empty / api / invalid_output
  }
}

// Clear, plain-language copy per failure kind for the client to show
// as-is — api/analyze.mjs's own `error` message was already written to be
// shown directly (never a raw Groq string), and this keeps that same
// discipline explicit in one place rather than trusting every call site to
// phrase its own message well. Never includes an API key, a model
// identifier string from Groq's internals beyond MODEL (already public
// via activeModel()), or any part of a raw provider response body.
const USER_MESSAGE_FOR_KIND = {
  invalid_output: 'The AI had trouble structuring this diagram — this happens occasionally with gpt-oss on more complex reviews. Try again, or try Regenerate.',
  invalid_diagram: 'The generated diagram didn’t pass our structural checks, so nothing was saved. Try again — this is usually a one-off.',
  overloaded: 'Groq is temporarily overloaded. Try again in a moment.',
  quota: 'Groq’s shared daily limit has been reached for now. Try again later.',
  truncated: 'The response was cut short before finishing. Try again, or try a shorter Review.',
  network: 'Network error reaching the Visual Learning service. Check your connection and try again.',
  in_progress: 'A Mind Map is already being generated for this entry — please wait a few seconds and try again.',
};
function userMessageFor(kind, fallback) {
  return USER_MESSAGE_FOR_KIND[kind] || fallback;
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

  if (existing && isRealDiagram(existing.graph_data) && existing.source_content_hash === contentHash && !wantsRegenerate) {
    return res.status(200).json({
      cached: true,
      visualization: toResponseShape(existing),
      disclaimer: STRUCTURAL_VALIDATION_DISCLAIMER,
      coverage: coverageResponse(notes, existing.graph_data),
      timing: { totalMs: 0 }, // no Groq call on this path, by construction — not a measurement, a fact
    });
  }

  // ---- Dedup: claim this (entry_id, viz_type) slot BEFORE calling Groq,
  // so a second concurrent request for the exact same thing (a double
  // click, two open tabs) doesn't also pay for its own Groq call. Uses
  // only existing columns — graph_data left at its own default ('{}') is
  // the "claimed, not yet generated" sentinel (isRealDiagram() above is
  // what tells a claim apart from a real cached diagram), and updated_at
  // is what lets a genuinely abandoned claim (the generation that claimed
  // it crashed or errored) self-heal via CLAIM_STALE_MS rather than
  // wedging this slot shut forever. No schema change — see the audit's
  // own "no schema change unless absolutely necessary" guidance. ----
  if (existing && !isRealDiagram(existing.graph_data)) {
    const claimAgeMs = Date.now() - new Date(existing.updated_at || existing.created_at).getTime();
    if (claimAgeMs < CLAIM_STALE_MS) return inProgressResponse(res);
    // Stale/abandoned claim — re-claim it below rather than leaving it
    // wedged for every future request to also bounce off.
  }
  if (!existing) {
    const { error: claimErr } = await userClient.from('entry_visualizations').insert({
      entry_id: entryId, user_id: user.id, viz_type: vizType,
      source_content_hash: contentHash, extra_context: trimmedExtraContext || null,
      graph_data: {},
    });
    if (claimErr) {
      // 23505 = unique_violation — a concurrent request claimed this
      // exact slot in the gap between our SELECT above and this INSERT.
      if (claimErr.code === '23505') return inProgressResponse(res);
      return res.status(502).json({ error: `Could not start generation: ${claimErr.message}`, kind: 'api' });
    }
  } else {
    await userClient.from('entry_visualizations')
      .update({ source_content_hash: contentHash, extra_context: trimmedExtraContext || null, graph_data: {}, updated_at: new Date().toISOString() })
      .eq('entry_id', entryId).eq('viz_type', vizType);
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
  const requestsBefore = GroqService.getRequestCount();
  const generationStartedAt = Date.now();
  let rawText;
  let model;
  try {
    rawText = await GroqService.generate(prompt, {
      systemInstruction: MINDMAP_SYSTEM_INSTRUCTION,
      responseSchema: GROQ_MINDMAP_SCHEMA,
      schemaName: SCHEMA_NAME_FOR_TYPE[vizType],
      maxCompletionTokens: tokenBudgetFor(notes.length),
      // 'high' (the six-section analysis task's own tuning) measurably
      // increases both latency and the chance of exhausting the shared
      // reasoning+output budget before finishing the (more complex, more
      // nested) Mind Map structure — see GroqService.js's own comment on
      // this task's reasoningEffort. 'medium' is the deliberate fix for
      // both the speed complaint and a real contributor to the
      // "did not match the required structure" failures.
      reasoningEffort: 'medium',
    });
    model = GroqService.activeModel();
  } catch (e) {
    return res.status(statusForKind(e.kind)).json({
      error: userMessageFor(e.kind, e.message), kind: e.kind || 'api', provider: 'groq', model: GroqService.activeModel(),
      timing: { totalMs: Date.now() - generationStartedAt, retries: GroqService.getRequestCount() - requestsBefore - 1 },
    });
  }
  const totalGenerationMs = Date.now() - generationStartedAt;
  const retries = GroqService.getRequestCount() - requestsBefore - 1;

  let diagram;
  try {
    diagram = validateMindMap(rawText, { allowAiContext: !!trimmedExtraContext });
  } catch (e) {
    if (e instanceof VisualizationValidationError) {
      return res.status(statusForKind(e.kind)).json({
        error: userMessageFor(e.kind, e.message), kind: e.kind, provider: 'groq', model,
        timing: { totalMs: totalGenerationMs, retries },
      });
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
    return res.status(502).json({
      error: 'The diagram was generated but could not be saved. Try again.', kind: 'api',
      timing: { totalMs: totalGenerationMs, retries },
    });
  }

  return res.status(200).json({
    cached: false,
    visualization: toResponseShape(saved),
    disclaimer: STRUCTURAL_VALIDATION_DISCLAIMER,
    coverage: coverageResponse(notes, diagram),
    timing: { totalMs: totalGenerationMs, retries },
    usage: GroqService.getLastUsage(),
  });
}

/**
 * Runs the source-coverage heuristic and wraps it with its own disclaimer
 * — see sourceCoverage.js's header for what this is and isn't. Computed
 * fresh against the CURRENT notes on every response (cache hit or not),
 * so it can never silently go stale the way a value computed only at
 * generation time would once the Review is edited afterward.
 */
function coverageResponse(notes, graphData) {
  return {
    uncoveredStatements: findUncoveredStatements(notes, graphData),
    disclaimer: SOURCE_COVERAGE_DISCLAIMER,
  };
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
