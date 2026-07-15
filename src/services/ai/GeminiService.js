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
      // Pro-tier models have a much tighter free ceiling (~5/min) than Flash,
      // so this is realistically hit by normal use, not just abuse. Make it
      // retryable rather than a hard stop.
      throw new GeminiError(
        'Gemini rate limit reached (free tier).',
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

let workingModel = null; // remember what worked, so later calls skip straight to it

const OVERLOAD_RETRY_DELAYS_MS = [1000, 3000];  // 503 busy: usually clears in seconds
const QUOTA_RETRY_DELAY_MS     = 15000;          // 429 rate limit: windows are ~60s, so
                                                  // one longer wait is worth it — especially
                                                  // relevant on Pro's tight ~5/min ceiling.

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Send a prompt, get raw text back.
 *
 * Three kinds of transient trouble are handled automatically, so the user
 * doesn't have to babysit the Analyze button:
 *  - MODEL RETIRED (404): walk a fallback list of known-good models.
 *  - OVERLOADED (503, free tier busy): a couple of short backoff retries
 *    on the SAME model before moving on — most 503s clear in seconds.
 *  - RATE LIMITED (429): one longer wait then a single retry on the SAME
 *    model. Matters most on Pro-tier's tight ~5 requests/minute ceiling,
 *    where two Analyze clicks close together can trip this in normal use.
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
    let quotaRetried = false;
    // A few quiet retries on THIS model before giving up on it and moving to
    // the next candidate — an overload is about traffic, not the model choice.
    for (let attempt = 0; attempt <= OVERLOAD_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const text = await attemptModel(model, userPrompt, signal);
        workingModel = model; // cache the one that worked for next time
        return text;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (e.kind === 'overloaded' && attempt < OVERLOAD_RETRY_DELAYS_MS.length) {
          await sleep(OVERLOAD_RETRY_DELAYS_MS[attempt]);
          continue; // retry same model
        }
        if (e.kind === 'quota' && !quotaRetried) {
          quotaRetried = true;
          await sleep(QUOTA_RETRY_DELAY_MS);
          attempt = -1; // restart the inner attempt counter for this one retry
          continue;
        }
        if (e.kind === 'model_not_found' || e.kind === 'overloaded' || e.kind === 'quota') break; // try next model
        throw e; // anything else (auth/network/etc.) surfaces immediately
      }
    }
  }

  // Every candidate 404'd, stayed overloaded, or stayed rate-limited.
  throw new GeminiError(
    `Gemini is busy, rate-limited, or unavailable right now (tried: ${candidates.join(', ')}). ` +
    'This is usually temporary on the free tier — wait a minute and try again.',
    'overloaded'
  );
}
