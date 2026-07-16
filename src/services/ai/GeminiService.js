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

const DEV = process.env.NODE_ENV !== 'production';

// Counts every outbound Gemini HTTP request in this page session, so the number
// of API calls per Analyze click can be verified rather than assumed.
let requestCount = 0;

/** Total Gemini requests made since page load. Also on window.__geminiRequests in dev. */
export function getRequestCount() { return requestCount; }

/** Reset the counter (used when measuring a single click). */
export function resetRequestCount() { requestCount = 0; }

/** One attempt against one specific model. Throws GeminiError on any failure. */
async function attemptModel(model, userPrompt, signal) {
  const n = ++requestCount;
  const startedAt = Date.now();
  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Gemini] request #${n} → ${model} (prompt ${userPrompt.length} chars)`);
  }

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

  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Gemini] request #${n} ← HTTP ${res.status} from ${model} in ${Date.now() - startedAt}ms`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch { /* non-JSON error body */ }

    if (res.status === 429) {
      // Free-tier ceilings are small and per-model: Pro ~5/min, Flash ~10/min,
      // Flash-Lite ~15/min. We deliberately do NOT retry or fall back here —
      // both would spend more of the quota that just ran out.
      const isPro = /pro/i.test(model);
      throw new GeminiError(
        `Gemini rate limit reached on ${model}` +
        (isPro ? ' (Pro free tier allows only ~5 requests/minute). ' : '. ') +
        'Wait about a minute, then click Analyze once.' +
        (isPro ? ' If this keeps happening, switching REACT_APP_GEMINI_MODEL back to gemini-flash-latest gives a much higher free limit.' : ''),
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
    if (res.status === 503 || /overloaded|UNAVAILABLE/i.test(detail)) {
      // Free-tier capacity is temporarily busy — not a config problem.
      // "kind" lets generate() auto-retry this a couple of times before
      // asking the user to.
      throw new GeminiError('Gemini is temporarily overloaded (free tier).', 'overloaded');
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

let workingModel = null; // set ONLY when a 404 forces a legitimate model swap

const OVERLOAD_RETRY_DELAYS_MS = [1000, 3000];  // 503 busy: usually clears in seconds

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Send a prompt, get raw text back.
 *
 * REQUEST BUDGET — deliberately minimal, because free-tier ceilings are small
 * (Pro is ~5 requests/minute). One user click must not become many requests.
 *
 *   Normal success ......... 1 request
 *   Rate limited (429) ..... 1 request  (surface immediately — see below)
 *   Overloaded (503) ....... up to 3 requests, SAME model only
 *   Model retired (404) .... 1 request per model until one answers
 *
 * Why 429 does NOT retry or fall back:
 *   Retrying a rate limit just spends more of the very quota that ran out, and
 *   falling back to a different model both multiplies requests AND silently
 *   changes which model you're using. Neither helps; both made it worse.
 *   A rate limit is information for the user, not something to fight.
 *
 * Why 404 DOES fall back:
 *   It means the model is genuinely gone (Google retires these on their own
 *   schedule). Trying another is the only way to recover, and a 404 is a cheap
 *   rejection rather than real work.
 */
export async function generate(userPrompt, { signal } = {}) {
  if (!isConfigured()) {
    throw new GeminiError(
      'No Gemini API key found. Add REACT_APP_GEMINI_API_KEY to .env.local (and to Vercel), then restart.',
      'config'
    );
  }

  const primary = workingModel || MODEL;
  const candidates = [primary, ...FALLBACK_MODELS.filter(m => m !== primary)];
  const tried = [];

  for (const model of candidates) {
    tried.push(model);

    for (let attempt = 0; ; attempt++) {
      try {
        const text = await attemptModel(model, userPrompt, signal);
        // Only remember a model that differs from the configured one when a 404
        // forced us here — so a transient blip can't silently pin you to a
        // model you didn't choose.
        if (model !== MODEL) workingModel = model;
        return text;
      } catch (e) {
        if (e.name === 'AbortError') throw e;

        // Transient traffic problem: retry the SAME model briefly. Never chain
        // to other models — that multiplies requests for no benefit.
        if (e.kind === 'overloaded' && attempt < OVERLOAD_RETRY_DELAYS_MS.length) {
          await sleep(OVERLOAD_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        // Model is gone — the one case where trying another model is right.
        if (e.kind === 'model_not_found') break;

        // 429 / exhausted 503 / auth / network → tell the user now.
        throw e;
      }
    }
  }

  throw new GeminiError(
    `No working Gemini model found (tried: ${tried.join(', ')}). ` +
    'Google may have changed its model lineup — check REACT_APP_GEMINI_MODEL.',
    'api'
  );
}
