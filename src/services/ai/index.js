// services/ai/index.js
//
// The ONLY surface UI components are allowed to touch.
// Components call AIService.analyzeReview(review) and nothing else.
//
// This used to call GeminiService directly from the browser. Both GROQ_API_KEY
// and (as of this change) REACT_APP_GEMINI_API_KEY live server-side only now
// — see api/analyze.mjs's header comment for why — so this file's job is
// just: send the review text to that endpoint with the user's auth token,
// and translate its response/errors into the exact same shape components
// already expect. Nothing in AddEntry.js or DetailView.js needed to change
// because of that move; only this file's internals did.

import { supabase } from '../../lib/supabase.js';
import { ParseError, isAllEmpty, normalizeSections, emptySections } from './ResponseParser.js';

export { ParseError, isAllEmpty, normalizeSections, emptySections };

/** Thrown for anything that isn't a parse failure — transport, quota, auth, config. */
export class AIServiceError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'AIServiceError';
    this.kind = kind; // 'quota' | 'auth' | 'config' | 'network' | 'overloaded' | 'api'
  }
}

// REACT_APP_AI_ENABLED is a plain boolean flag (not a secret — the actual
// keys never reach the browser at all now), set wherever at least one
// provider is configured. This is what lets the Analyze button hide itself
// in a fresh local checkout with no keys set up yet, without needing a
// round trip to find that out.
const ENABLED = process.env.REACT_APP_AI_ENABLED === 'true';

// Last known {provider, model} this page session has actually seen answer a
// request, and the last request count the server reported for that
// provider's shared daily quota. Updated after every call (success or
// failure past the auth/validation stage); read by activeModel()/
// activeProvider()/getRequestCount() for display and for the ai_model/
// ai_provider columns saved alongside each analysis.
let lastProvider = 'groq';
let lastModel = 'openai/gpt-oss-20b'; // sensible default label before any request completes
let lastRequestCount = 0;
let lastFallback = false;

async function callAnalyzeEndpoint(reviewText, sectionKey) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new AIServiceError('You need to be signed in to use Analyze.', 'auth');
  }

  let res;
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ reviewText, sectionKey }),
    });
  } catch {
    throw new AIServiceError('Network error reaching MedBook\'s AI endpoint. Check your connection.', 'network');
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const message = body?.error || `Analysis failed (HTTP ${res.status}).`;
    const kind = body?.kind || 'api';
    // A failed call still tells us which provider actually tried (and, on
    // a quota 429, which one ran out) — worth reflecting immediately
    // rather than leaving the usage bar showing stale info from a
    // previous successful call.
    if (body?.provider) { lastProvider = body.provider; }
    throw new AIServiceError(message, kind);
  }

  lastProvider = body.provider;
  lastModel = body.model;
  lastFallback = !!body.fallback;
  if (typeof body.requestCountToday === 'number') lastRequestCount = body.requestCountToday;

  return body;
}

const AIService = {
  /** Is at least one provider configured? UI uses this to hide/disable the Analyze buttons. */
  isConfigured() { return ENABLED; },

  /** Which provider+model actually answered the last request (shown in the UI footer for transparency). */
  activeModel() { return lastModel; },
  activeProvider() { return lastProvider; },
  /** Did the last successful call have to fall through to Gemini (Groq's quota exhausted)? */
  wasFallback() { return lastFallback; },

  /**
   * Requests made TODAY against the provider that last answered — a durable,
   * cross-user count from the server (see ai_usage_daily in api/analyze.mjs),
   * not a per-browser-session guess: Groq's and Gemini's free-tier quotas
   * are shared across every signed-in MedBook user via one API key each, so
   * only the server actually knows the real number.
   */
  getRequestCount() { return lastRequestCount; },

  /**
   * Analyse a review and return the six sections.
   * ONLY the review text is sent — never the question, images, or metadata.
   *
   * Throws AIServiceError (transport/quota/config/auth) or ParseError (bad
   * output). Callers must treat a throw as "change nothing".
   */
  async analyzeReview(reviewText) {
    const text = String(reviewText || '').trim();
    if (!text) {
      throw new ParseError('There is nothing in the Review to analyse yet.');
    }
    if (text.length < 40) {
      throw new ParseError('The Review is too short to analyse meaningfully. Write a bit more first.');
    }
    const { sections } = await callAnalyzeEndpoint(text);
    return sections;
  },

  /**
   * Future expansion (spec): regenerate ONE section without redoing everything.
   * Wired here so adding it to the UI later needs no architectural change.
   */
  async analyzeSection(reviewText, sectionKey) {
    const text = String(reviewText || '').trim();
    if (!text) throw new ParseError('There is nothing in the Review to analyse yet.');
    const { sections } = await callAnalyzeEndpoint(text, sectionKey);
    return { [sectionKey]: sections[sectionKey] || [] };
  },

  // Planned, per spec's Future Expansion — each becomes a method here:
  //   generateQuestions(reviewText)
  //   generateClinicalCase(reviewText)
  //   generateMnemonics(reviewText)
  //   generateDifferential(reviewText)
};

export default AIService;
