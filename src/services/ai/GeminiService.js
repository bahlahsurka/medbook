// services/ai/GeminiService.js
//
// Transport only. Knows how to talk to Gemini; knows nothing about prompts or
// about MedBook's data shapes. If we ever move the key server-side (a Vercel
// function), THIS is the only file that changes.

import { SYSTEM_INSTRUCTION, RESPONSE_SCHEMA } from './PromptBuilder';

// Create React App exposes only REACT_APP_* vars to the browser.
const API_KEY = process.env.REACT_APP_GEMINI_API_KEY;

// Gemini's model lineup turns over fast (2.0 shut down June 2026; 2.5 has been
// seen returning 404 "no longer available" ahead of its own documented
// deprecation date; 3.x is now current). Hardcoding one model name means this
// breaks again every few months. Two defenses instead:
//
// 1. Default to `gemini-flash-latest` — a documented Google alias that is
//    auto hot-swapped to the current Flash model, with 2 weeks' notice.
//    This should rarely need touching.
// 2. If the configured model 404s anyway (rollout ahead of docs, a bad
//    override, etc.), automatically retry down a short list of known-good
//    fallbacks before giving up.
const MODEL = process.env.REACT_APP_GEMINI_MODEL || 'gemini-flash-latest';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'];

function endpointFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** Typed error so the UI can react differently to quota vs. config vs. network. */
export class GeminiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind; // 'config' | 'quota' | 'auth' | 'network' | 'truncated' | 'empty' | 'api'
  }
}

export function isConfigured() {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
}

export function activeModel() {
  return workingModel || MODEL;
}

/** One attempt against one specific model. Throws GeminiError on any failure. */
async function attemptModel(model, userPrompt, signal) {
  let res;
  try {
    res = await fetch(endpointFor(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY,
      },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,      // low: we're extracting, not brainstorming
          maxOutputTokens: 2048,
        },
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new GeminiError('Network error reaching Gemini. Check your connection.', 'network');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch { /* non-JSON error body */ }

    if (res.status === 429) {
      throw new GeminiError(
        'Gemini rate limit reached (free tier). Wait a minute and try again.',
        'quota'
      );
    }
    // Google is migrating keys from Standard (AIza…) to Auth keys (AQ.Ab…).
    // Auth keys are valid on THIS native endpoint, but a few accounts have been
    // reported hitting this. The message matters: the key looks "invalid" but isn't.
    if (res.status === 401 || /ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(detail)) {
      throw new GeminiError(
        'Gemini rejected the credential (401). If your key starts with "AQ." this is a known ' +
        'issue with Google\'s new Auth keys on some accounts — the key itself is usually fine. ' +
        'Try creating a fresh key in AI Studio; if it persists it is a Google-side account issue, ' +
        'not your setup.',
        'auth'
      );
    }
    if (res.status === 400 && /API key/i.test(detail)) {
      throw new GeminiError('Gemini rejected the API key. Check REACT_APP_GEMINI_API_KEY.', 'auth');
    }
    if (res.status === 403) {
      throw new GeminiError('Gemini denied access. The key may be restricted or the API not enabled.', 'auth');
    }
    if (res.status === 404) {
      // Special "kind" so generate() knows this one is worth retrying on a
      // fallback model rather than surfacing immediately.
      throw new GeminiError(`Model "${model}" not found or retired.`, 'model_not_found');
    }
    throw new GeminiError(detail || `Gemini error (HTTP ${res.status}).`, 'api');
  }

  const data = await res.json();

  // Blocked by safety filters, or nothing came back at all.
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const blocked = data?.promptFeedback?.blockReason;
    throw new GeminiError(
      blocked ? `Gemini blocked this request (${blocked}).` : 'Gemini returned no result.',
      'empty'
    );
  }

  // Known Gemini issue: output can be cut off mid-way. MAX_TOKENS is the honest
  // signal; we surface it instead of handing a half-object to the parser.
  if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw new GeminiError(`Gemini stopped unexpectedly (${candidate.finishReason}).`, 'api');
  }
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('Gemini response was cut short. Try shortening the review.', 'truncated');
  }

  const text = (candidate.content?.parts || [])
    .map(p => p.text || '')
    .join('')
    .trim();

  if (!text) throw new GeminiError('Gemini returned an empty response.', 'empty');
  return text;
}

let workingModel = null; // remember what worked, so later calls skip straight to it

/**
 * Send a prompt, get raw text back. If the configured model has been retired
 * (404), automatically retries a short list of known-good fallback models
 * instead of failing outright — this is what survives Google's model churn
 * without needing a code change every time a model is sunset.
 */
export async function generate(userPrompt, { signal } = {}) {
  if (!isConfigured()) {
    throw new GeminiError(
      'No Gemini API key found. Add REACT_APP_GEMINI_API_KEY to .env.local (and to Vercel), then restart.',
      'config'
    );
  }

  const candidates = [workingModel || MODEL, ...FALLBACK_MODELS.filter(m => m !== MODEL)];

  for (const model of candidates) {
    try {
      const text = await attemptModel(model, userPrompt, signal);
      workingModel = model; // cache the one that worked for next time
      return text;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e.kind !== 'model_not_found') throw e; // only chain through 404s
      // otherwise: try the next candidate model
    }
  }

  // Every candidate 404'd.
  throw new GeminiError(
    `No working Gemini model found (tried: ${candidates.join(', ')}). ` +
    'Google may have changed its model lineup — check REACT_APP_GEMINI_MODEL or try again shortly.',
    'api'
  );
}
