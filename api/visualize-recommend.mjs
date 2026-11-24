// api/visualize-recommend.mjs
//
// The optional "Recommend" feature's backend: a small, STATELESS
// classification call suggesting which of the six Visual Learning types
// fit an entry's Review content. Deliberately its own endpoint, not a mode
// of api/visualize.mjs — this never writes to entry_visualizations (it
// recommends a format, it doesn't generate one), so it needs none of that
// file's caching/dedup/claim machinery. Shares its auth/ownership pattern
// (fetch entry.notes server-side through an RLS-scoped client) and its
// Groq transport (GroqService.js) with api/visualize.mjs, since both of
// those are correct to reuse as-is, not re-litigate.
import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../src/services/ai/GroqService.js';
import { VisualizationValidationError } from '../src/services/ai/VisualizationValidator.js';
import {
  buildRecommendPrompt, RECOMMEND_SYSTEM_INSTRUCTION, GROQ_RECOMMEND_SCHEMA, validateRecommendation,
} from '../src/services/ai/visualizationRecommender.js';

const MIN_NOTES_LENGTH = 40;

function statusForKind(kind) {
  switch (kind) {
    case 'validation': return 400;
    case 'not_found': return 404;
    case 'quota': return 429;
    case 'auth': return 401;
    case 'config': return 500;
    case 'overloaded': return 503;
    default: return 502;
  }
}

const USER_MESSAGE_FOR_KIND = {
  invalid_output: 'Could not work out a recommendation this time. Just pick a format directly.',
  overloaded: 'Groq is temporarily overloaded. Try again in a moment, or just pick a format directly.',
  quota: 'Groq’s shared daily limit has been reached for now. Try again later, or just pick a format directly.',
  truncated: 'The response was cut short. Try again, or just pick a format directly.',
  network: 'Network error reaching the Visual Learning service. Check your connection.',
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
  if (!notes || notes.length < MIN_NOTES_LENGTH) {
    return res.status(400).json({ error: 'The Review is too short to recommend a format for. Write a bit more first.', kind: 'validation' });
  }

  if (!GroqService.isConfigured()) {
    return res.status(500).json({ error: 'No visualization provider is configured (set GROQ_API_KEY in Vercel).', kind: 'config' });
  }

  let rawText;
  try {
    // A classification call is far cheaper than generating a full diagram
    // — a small flat token budget and 'low' reasoning effort both keep
    // this fast and avoid burning shared Groq capacity on a feature
    // that's explicitly optional and advisory, never required to use
    // Visual Learning at all.
    rawText = await GroqService.generate(buildRecommendPrompt(notes), {
      systemInstruction: RECOMMEND_SYSTEM_INSTRUCTION,
      responseSchema: GROQ_RECOMMEND_SCHEMA,
      schemaName: 'medbook_visualization_recommendation',
      maxCompletionTokens: 2048,
      reasoningEffort: 'low',
    });
  } catch (e) {
    return res.status(statusForKind(e.kind)).json({ error: userMessageFor(e.kind, e.message), kind: e.kind || 'api' });
  }

  let recommendation;
  try {
    recommendation = validateRecommendation(rawText);
  } catch (e) {
    if (e instanceof VisualizationValidationError) {
      return res.status(502).json({ error: userMessageFor('invalid_output', e.message), kind: 'invalid_output' });
    }
    throw e;
  }

  return res.status(200).json(recommendation); // { recommended, rationale }
}
