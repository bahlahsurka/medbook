// api/analyze.mjs
//
// The ONLY place a browser ever reaches an AI provider for Review analysis.
// Groq is primary; Gemini is kept as a fallback for when Groq's free-tier
// quota (shared across every signed-in user, via one GROQ_API_KEY) runs out
// for the day. Gemini moved server-side here too, not left half-migrated —
// REACT_APP_GEMINI_API_KEY used to be baked straight into the browser
// bundle; now that nothing in client code imports GeminiService.js anymore
// (see services/ai/index.js), that key simply stops appearing in the CRA
// build output, with no Vercel env var rename needed to achieve it.
//
// GROQ_API_KEY is deliberately NOT REACT_APP_-prefixed (CRA only inlines
// REACT_APP_* vars into the browser bundle) — Groq enforces its rate limits
// per ORGANIZATION, not per key, so one extracted key could exhaust the
// shared quota for every MedBook user at once. Same reasoning now applies
// to Gemini's key, hence moving it here rather than leaving it client-side
// "because it was already like that".
//
// Fallback discipline (per the actual incident GeminiService.js's own
// retry logic was built to fix — getting this wrong once sent 8 requests
// per click instead of 1):
//   - Groq succeeds ................ use it, done. 1 Groq request.
//   - Groq 429 (quota exhausted) .... exactly 1 Groq request, then try
//                                     Gemini, reusing GeminiService's own
//                                     unmodified retry/model-swap logic.
//   - Groq not configured at all .... skip it silently, Gemini runs alone
//                                     (not really a "fallback", just
//                                     "only one provider is set up").
//   - Groq fails any OTHER way ...... surfaced immediately, no Gemini
//                                     attempt — an auth/config/malformed-
//                                     request bug on Groq isn't fixed by
//                                     asking a different provider the same
//                                     broken question, and doing so would
//                                     just burn Gemini's quota for nothing.

import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../src/services/ai/GroqService.js';
import * as GeminiService from '../src/services/ai/GeminiService.js';
import { buildAnalysisPrompt, buildSectionPrompt, limitsFor } from '../src/services/ai/PromptBuilder.js';
import { parseAnalysis, ParseError } from '../src/services/ai/ResponseParser.js';

// Maps a transport-level failure to an HTTP status the client can react to
// sensibly (429 → "wait", 401/500 → "this is MedBook's problem, not yours").
function statusForKind(kind) {
  switch (kind) {
    case 'quota': return 429;
    case 'auth': return 401;
    case 'config': return 500;
    case 'overloaded': return 503;
    default: return 502; // network / truncated / empty / api / malformed output
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers?.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization bearer token' });

  const anonClient = createClient(
    process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.REACT_APP_SUPABASE_ANON_KEY
  );
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(accessToken);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired session' });

  const { reviewText, sectionKey } = req.body || {};
  const text = String(reviewText || '').trim();
  if (!text) return res.status(400).json({ error: 'There is nothing in the Review to analyse yet.' });
  // Same 40-char floor services/ai/index.js enforced client-side before this
  // moved server-side — kept here too (never trust the network), and only
  // for a full analysis; a single-section re-roll re-sends the same review
  // text, which has already cleared this bar once.
  if (!sectionKey && text.length < 40) {
    return res.status(400).json({ error: 'The Review is too short to analyse meaningfully. Write a bit more first.' });
  }

  const prompt = sectionKey ? buildSectionPrompt(text, sectionKey) : buildAnalysisPrompt(text);

  let provider = null;
  let model = null;
  let rawText = null;
  let fallback = false;
  let fallbackReason = null;
  let lastError = null;

  // ---- 1. Groq, unless it simply isn't configured ----
  if (GroqService.isConfigured()) {
    try {
      rawText = await GroqService.generate(prompt);
      provider = 'groq';
      model = GroqService.activeModel();
    } catch (e) {
      lastError = e;
      if (e.kind !== 'quota') {
        // Not a quota exhaustion — surface it as-is, no Gemini attempt.
        return res.status(statusForKind(e.kind)).json({ error: e.message, kind: e.kind, provider: 'groq' });
      }
      fallback = true;
      fallbackReason = 'groq_quota_exhausted';
    }
  } else {
    fallback = true;
    fallbackReason = 'groq_not_configured';
  }

  // ---- 2. Gemini — either because Groq's quota is exhausted today, or
  //         because Groq was never configured in this environment ----
  if (!provider) {
    if (!GeminiService.isConfigured()) {
      // Neither provider usable at all.
      const message = lastError
        ? `Groq is unavailable (${lastError.message}) and no Gemini fallback is configured.`
        : 'No AI provider is configured (set GROQ_API_KEY and/or REACT_APP_GEMINI_API_KEY in Vercel).';
      return res.status(500).json({ error: message, kind: 'config' });
    }
    try {
      rawText = await GeminiService.generate(prompt);
      provider = 'gemini';
      model = GeminiService.activeModel();
    } catch (e) {
      return res.status(statusForKind(e.kind)).json({
        error: e.message, kind: e.kind, provider: 'gemini', fallbackReason,
      });
    }
  }

  // ---- 3. Parse + validate, exactly as strictly as the client used to ----
  let sections;
  try {
    sections = parseAnalysis(rawText);
  } catch (e) {
    if (e instanceof ParseError) {
      return res.status(502).json({ error: e.message, kind: 'parse', provider });
    }
    throw e;
  }

  // ---- 4. Durable, cross-user daily usage count for the provider that
  //         actually answered — the client's own session count can't mean
  //         anything for a quota shared across every MedBook user. ----
  let requestCountToday = null;
  try {
    const db = createClient(
      process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data, error } = await db.rpc('increment_ai_usage', { p_provider: provider });
    if (!error) requestCountToday = data;
  } catch {
    // Usage counting is informational only — never fail a successful
    // analysis just because the counter couldn't be incremented.
  }

  return res.status(200).json({
    sections, provider, model, fallback, fallbackReason,
    requestCountToday, limits: limitsFor(model),
  });
}
