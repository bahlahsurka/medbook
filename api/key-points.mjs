// api/key-points.mjs
//
// Phase 5: generates the new "Key Points" summary — a dedicated Groq task,
// completely independent of api/analyze.mjs's existing six-section
// analysis (which stays untouched; see KeyPointsPromptBuilder.js's own
// header for why: that pipeline is also "the flashcard generation
// pipeline" the Phase 5 brief explicitly protects). Mirrors api/visualize.mjs's
// security/fetch pattern — entryId only from the client, entry.notes
// fetched here server-side through an RLS-scoped Supabase client, never
// trusted from the request body — rather than api/analyze.mjs's older
// "client sends reviewText directly" shape, since every other Phase 1-4
// endpoint already established the stricter pattern and there's no reason
// for a brand-new endpoint to regress to the older one.
//
// No caching/claim/dedup machinery here, unlike api/visualize.mjs — Key
// Points is ONE artifact per entry (not six independently-cacheable
// types), and the client already decides when to call this exactly the
// way it already decides when to call the old /api/analyze (an explicit
// Generate/Regenerate click, never automatic). The CLIENT writes the
// result into entries.ai_sections.keyPoints (merged alongside whatever
// the old six-section fields currently hold — see DetailView.js's own
// merge-safety comment), not this endpoint — same division of
// responsibility api/analyze.mjs already has with DetailView.js.

import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../src/services/ai/GroqService.js';
import { buildKeyPointsPrompt, KEY_POINTS_SYSTEM_INSTRUCTION, GROQ_KEY_POINTS_SCHEMA } from '../src/services/ai/KeyPointsPromptBuilder.js';
import { validateKeyPoints, KeyPointsValidationError } from '../src/services/ai/KeyPointsValidator.js';
import { checkKeyPointsFidelity } from '../src/services/ai/keyPointsFidelity.js';
import { computeContentHash } from '../src/services/ai/contentHash.js';

const MIN_NOTES_LENGTH = 40; // same floor api/analyze.mjs and api/visualize.mjs both already enforce on entry.notes

// Key Points' output (a short list of headed sections, each a short list
// of compact bullets) is deliberately far more COMPACT than the old six-
// section schema's worst case (unlimited keyLearningPoints/highYield plus
// flashcards) — these tiers are scaled down accordingly rather than reused
// as-is. Same reasoning as api/visualize.mjs's own tokenBudgetFor: a short
// review needs far less budget than a long, dense one, and these are
// deliberately coarse starting points, easy to retune once real
// usage numbers (captured below via GroqService.getLastUsage()) come in.
function tokenBudgetFor(notesLength) {
  if (notesLength < 400) return 4096;
  if (notesLength < 1200) return 8192;
  return 12288;
}

function statusForKind(kind) {
  switch (kind) {
    case 'validation': return 400;
    case 'not_found': return 404;
    case 'quota': return 429;
    case 'auth': return 401;
    case 'config': return 500;
    case 'overloaded': return 503;
    case 'invalid_key_points': return 502;
    default: return 502; // network / truncated / empty / api / invalid_output
  }
}

const USER_MESSAGE_FOR_KIND = {
  invalid_output: 'The AI had trouble structuring Key Points — this happens occasionally on more complex reviews. Try again, or try Regenerate.',
  invalid_key_points: 'The generated Key Points didn’t pass our structural checks, so nothing was saved. Try again — this is usually a one-off.',
  overloaded: 'Groq is temporarily overloaded. Try again in a moment.',
  quota: 'Groq’s shared daily limit has been reached for now. Try again later.',
  truncated: 'The response was cut short before finishing. Try again, or try a shorter Review.',
  network: 'Network error reaching the Key Points service. Check your connection and try again.',
};
function userMessageFor(kind, fallback) {
  return USER_MESSAGE_FOR_KIND[kind] || fallback;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers?.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization bearer token', kind: 'auth' });

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session', kind: 'auth' });

  const { entryId } = req.body || {};
  if (typeof entryId !== 'string' || !entryId.trim()) {
    return res.status(400).json({ error: 'entryId is required.', kind: 'validation' });
  }

  const { data: entry, error: entryErr } = await userClient
    .from('entries')
    .select('id, user_id, notes')
    .eq('id', entryId)
    .maybeSingle();

  if (entryErr || !entry || entry.user_id !== user.id) {
    return res.status(404).json({ error: 'Entry not found.', kind: 'not_found' });
  }

  const notes = String(entry.notes || '').trim();
  if (!notes) {
    return res.status(400).json({ error: 'This entry has no Review text to summarize yet.', kind: 'validation' });
  }
  if (notes.length < MIN_NOTES_LENGTH) {
    return res.status(400).json({ error: 'The Review is too short to summarize meaningfully. Write a bit more first.', kind: 'validation' });
  }

  if (!GroqService.isConfigured()) {
    return res.status(500).json({ error: 'No Key Points provider is configured (set GROQ_API_KEY in Vercel).', kind: 'config' });
  }

  const requestsBefore = GroqService.getRequestCount();
  const startedAt = Date.now();
  let rawText;
  let model;
  try {
    // The FULL, untruncated review text goes in every time — same
    // discipline as api/analyze.mjs/api/visualize.mjs, confirmed by audit
    // (Phase 5 investigation) to have no truncation anywhere upstream of
    // this call either.
    rawText = await GroqService.generate(buildKeyPointsPrompt(notes), {
      systemInstruction: KEY_POINTS_SYSTEM_INSTRUCTION,
      responseSchema: GROQ_KEY_POINTS_SCHEMA,
      schemaName: 'medbook_key_points',
      maxCompletionTokens: tokenBudgetFor(notes.length),
      // 'medium', not the six-section task's own 'high' default — Key
      // Points' schema is MORE nested (sections -> bullets -> {text,
      // emphasis, sourceRef}) than that flat six-array schema, and Visual
      // Learning's own reliability fix already established (documented in
      // GroqService.js) that a more deeply-nested strict-mode schema does
      // better with 'medium': less of the shared reasoning+output budget
      // spent "thinking" before the model commits to JSON means less
      // chance of exhausting that budget mid-structure. Chosen from that
      // documented precedent, not a guess.
      reasoningEffort: 'medium',
    });
    model = GroqService.activeModel();
  } catch (e) {
    return res.status(statusForKind(e.kind)).json({
      error: userMessageFor(e.kind, e.message), kind: e.kind || 'api', provider: 'groq', model: GroqService.activeModel(),
      timing: { totalMs: Date.now() - startedAt, retries: GroqService.getRequestCount() - requestsBefore - 1 },
    });
  }
  const totalMs = Date.now() - startedAt;
  const retries = GroqService.getRequestCount() - requestsBefore - 1;

  let keyPoints;
  try {
    keyPoints = validateKeyPoints(rawText);
  } catch (e) {
    if (e instanceof KeyPointsValidationError) {
      return res.status(statusForKind(e.kind)).json({
        error: userMessageFor(e.kind, e.message), kind: e.kind, provider: 'groq', model,
        timing: { totalMs, retries },
      });
    }
    throw e;
  }

  // Cheap, no-extra-Groq-call fidelity pass — see keyPointsFidelity.js's
  // own header for what this does and doesn't guarantee.
  const fidelity = checkKeyPointsFidelity(notes, keyPoints);

  // Same durable, cross-user daily usage counter api/analyze.mjs already
  // maintains — this is the SAME shared Groq quota, so Key Points
  // generations must count against it too, not be invisible to it.
  let requestCountToday = null;
  try {
    const db = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await db.rpc('increment_ai_usage', { p_provider: 'groq' });
    if (!error) requestCountToday = data;
  } catch {
    // Informational only — never fail a successful generation over this.
  }

  return res.status(200).json({
    keyPoints,
    sourceContentHash: computeContentHash(notes, ''),
    // A cheap client-side staleness hint (see KeyPointsPanel.js's caller
    // in DetailView.js) compares the CURRENT entry.notes length against
    // this — a changed length means the Review has definitely changed
    // since this was generated; an unchanged length is a good but not
    // airtight signal that it hasn't. sourceContentHash above is the
    // precise version, kept for any future server-side staleness check
    // that needs it, but isn't practical to compare from the browser
    // without re-implementing sha256 there for a soft UI hint.
    sourceNotesLength: notes.length,
    provider: 'groq',
    model,
    generatedAt: new Date().toISOString(),
    fidelity,
    timing: { totalMs, retries },
    usage: GroqService.getLastUsage(),
    requestCountToday,
  });
}
