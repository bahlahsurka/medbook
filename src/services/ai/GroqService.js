// services/ai/GroqService.js
//
// Transport only — knows how to talk to Groq's OpenAI-compatible chat
// completions endpoint; knows nothing about MedBook's data shapes. Server-
// side ONLY: imported by api/analyze.mjs, never by client code, because
// GROQ_API_KEY is deliberately not REACT_APP_-prefixed (see api/analyze.mjs's
// own header comment for why — Groq's rate limits apply per organization,
// not per key, and this app now has real multiple users sharing one key).
//
// Mirrors GeminiService.js's retry discipline deliberately, not by
// coincidence: that discipline was hard-won (a prior bug sent 8 requests
// per click instead of 1), and nothing here should regress it just because
// the provider changed.

import { GROQ_SYSTEM_INSTRUCTION, GROQ_RESPONSE_SCHEMA } from './PromptBuilder.js';

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** Typed error so the caller can react differently to quota vs. config vs. network. */
export class GroqError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'GroqError';
    this.kind = kind; // 'config' | 'quota' | 'auth' | 'network' | 'truncated' | 'empty' | 'api' | 'invalid_output'
  }
}

export function isConfigured() {
  return typeof API_KEY === 'string' && API_KEY.length > 0;
}

export function activeModel() {
  return MODEL;
}

const DEV = process.env.NODE_ENV !== 'production';

// Counts every outbound Groq HTTP request in this invocation — a cold Vercel
// function instance starts this back at 0, same as GeminiService's own
// per-page-load counter resets on reload. Durable usage tracking across
// invocations lives in Supabase (ai_usage_daily), not here; this is purely
// "how many requests did THIS attempt actually send", same role the
// original counter played for verifying one click == one request.
let requestCount = 0;
export function getRequestCount() { return requestCount; }
export function resetRequestCount() { requestCount = 0; }

const OVERLOAD_RETRY_DELAYS_MS = [1000, 2000]; // 503/498: usually clears in seconds
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** One attempt. Throws GroqError on any failure. */
async function attempt(userPrompt, signal) {
  const n = ++requestCount;
  const startedAt = Date.now();
  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Groq] request #${n} → ${MODEL} (prompt ${userPrompt.length} chars)`);
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: GROQ_SYSTEM_INSTRUCTION },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'medbook_review_analysis',
            strict: true,
            schema: GROQ_RESPONSE_SCHEMA,
          },
        },
        temperature: 0.2,       // low: we're extracting, not brainstorming
        // gpt-oss-20b is a reasoning model (console.groq.com/docs/reasoning)
        // — reasoning spends more of its hidden pass actually working
        // through the review before committing to an answer. 'high' ("a
        // large number of reasoning tokens" per Groq's own docs) was tried
        // first, then reverted to 'medium' after it started intermittently
        // exhausting the shared reasoning+output token budget before the
        // model reached the structured JSON (json_validate_failed, handled
        // below). But 'medium' alone, even with a much richer prompt
        // (PromptBuilder.js's GROQ_SYSTEM_INSTRUCTION), was reported as
        // STILL mediocre/incomplete compared to Gemini — the real fix for
        // json_validate_failed was always meant to be enough budget for
        // reasoning AND the full answer together (see max_completion_tokens
        // below and the invalid_output resample-then-fallback path this
        // file now has), not giving up depth entirely. Back to 'high', now
        // paired with a much larger budget and a safety net that was
        // missing the first time this was tried.
        reasoning_effort: 'high',
        // Groq counts the model's reasoning tokens against this SAME budget
        // (console.groq.com/docs/reasoning: "the default may be too low for
        // complex reasoning") — unlike Gemini's thinking budget, which is
        // separate from maxOutputTokens. 32768 is double the previous
        // 16384, specifically to give 'high' reasoning_effort genuine room
        // to do its deeper pass AND still have plenty left for six
        // structured sections plus flashcards — still exactly half this
        // model's 65,536-token output cap (console.groq.com/docs/model/
        // openai/gpt-oss-20b). If reasoning still occasionally eats the
        // whole budget, that's exactly what the 'invalid_output' handling
        // above (resample once, then fall back to Gemini) exists for —
        // this is no longer an all-or-nothing bet on one request the way
        // the first attempt at 'high' effectively was.
        max_completion_tokens: 32768,
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new GroqError('Network error reaching Groq. Check your connection.', 'network');
  }

  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Groq] request #${n} ← HTTP ${res.status} from ${MODEL} in ${Date.now() - startedAt}ms`);
  }

  if (!res.ok) {
    let message = '';
    let type = '';
    let code = '';
    try {
      const body = await res.json();
      message = body?.error?.message || '';
      type = body?.error?.type || '';
      code = body?.error?.code || '';
    } catch { /* non-JSON error body */ }

    // Groq's strict json_schema mode can fail the MODEL's own output
    // against the schema (HTTP 400, error.code 'json_validate_failed',
    // message "Failed to generate JSON..."/"Failed to validate JSON...",
    // the actual bad output in error.failed_generation) — a real,
    // documented, somewhat common failure mode for gpt-oss under strict
    // structured outputs, not a bug in our request. It's resampling noise
    // more than a hard failure: the same request often succeeds on a
    // fresh attempt. Retried once here (see generate()'s own comment),
    // then left for api/analyze.mjs to fall back to Gemini exactly like a
    // quota exhaustion — surfacing it as a raw error to the user when a
    // working fallback provider is sitting right there would be wrong.
    if (res.status === 400 && (code === 'json_validate_failed' || /failed to (generate|validate) json/i.test(message))) {
      throw new GroqError('Groq produced output that did not match the required structure.', 'invalid_output');
    }

    if (res.status === 429) {
      // Groq enforces RPM/RPD/TPM/TPD at the ORGANIZATION level (one shared
      // cap for every MedBook user, via the one GROQ_API_KEY) and always
      // sends x-ratelimit-* headers — even on a 429 — so we can say exactly
      // which cap was hit instead of guessing, the same discipline
      // GeminiService.js applies to Google's QuotaFailure/RetryInfo details.
      const remainingRequests = res.headers.get('x-ratelimit-remaining-requests');
      const remainingTokens = res.headers.get('x-ratelimit-remaining-tokens');
      const retryAfter = res.headers.get('retry-after');
      const isDaily = remainingRequests === '0';
      let waitAdvice;
      if (isDaily) {
        waitAdvice = 'This is the DAILY request cap (RPD), not the per-minute one — it resets at UTC midnight, not in a minute.';
      } else if (remainingTokens === '0') {
        waitAdvice = retryAfter
          ? `This is the per-minute TOKEN cap (TPM). Groq says to wait ${retryAfter}s, then try again.`
          : 'This is the per-minute TOKEN cap (TPM). Wait about a minute, then try again.';
      } else if (retryAfter) {
        waitAdvice = `Groq says to wait ${retryAfter}s, then try again.`;
      } else {
        waitAdvice = 'Wait about a minute, then try again.';
      }
      // Deliberately NOT retried and NOT chained to another Groq request —
      // same reasoning as Gemini's 429 handling: retrying an exhausted
      // quota just spends more of the quota that ran out. This is exactly
      // the signal api/analyze.mjs uses to fall through to Gemini.
      throw new GroqError(`Groq rate limit reached on ${MODEL}. ${waitAdvice}`, 'quota');
    }
    if (res.status === 401) {
      throw new GroqError('Groq rejected the credential (401). Check GROQ_API_KEY.', 'auth');
    }
    if (res.status === 403) {
      throw new GroqError('Groq denied access (403). The key may be restricted.', 'auth');
    }
    if (res.status === 404) {
      throw new GroqError(`Groq model "${MODEL}" not found. Check GROQ_MODEL.`, 'config');
    }
    if (res.status === 503 || res.status === 498 || /overloaded|unavailable|capacity/i.test(message + type)) {
      // 503 Service Unavailable or 498 "Flex Tier Capacity Exceeded" — Groq's
      // own docs (console.groq.com/docs/errors) list both as temporary
      // capacity conditions, not quota exhaustion. Worth a couple of same-
      // model retries before giving up, same as Gemini's 503 handling.
      throw new GroqError('Groq is temporarily overloaded.', 'overloaded');
    }
    throw new GroqError(message || `Groq error (HTTP ${res.status}).`, 'api');
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  if (!choice) throw new GroqError('Groq returned no result.', 'empty');

  if (choice.finish_reason && !['stop', 'length'].includes(choice.finish_reason)) {
    throw new GroqError(`Groq stopped unexpectedly (${choice.finish_reason}).`, 'api');
  }
  if (choice.finish_reason === 'length') {
    throw new GroqError('Groq response was cut short. Try shortening the review.', 'truncated');
  }

  const text = (choice.message?.content || '').trim();
  if (!text) throw new GroqError('Groq returned an empty response.', 'empty');
  return text;
}

const INVALID_OUTPUT_MAX_RETRIES = 1; // one immediate resample — see attempt()'s own comment on why this is noise, not a capacity issue

/**
 * Send a prompt, get raw text back.
 *
 * REQUEST BUDGET — same discipline as GeminiService.generate():
 *   Normal success ......... 1 request
 *   Rate limited (429) ..... 1 request  (surface immediately, caller falls back)
 *   Overloaded (503/498) ... up to 3 requests, SAME model only
 *   Invalid structured
 *     output (400) ......... up to 2 requests, SAME model, no delay (resampling
 *                             noise, not a capacity wait) — then surfaces as
 *                             'invalid_output' for api/analyze.mjs to fall
 *                             back to Gemini, same as a quota exhaustion.
 *
 * There is no 404-triggered model swap here the way Gemini has one: Groq's
 * model lineup for structured outputs is deliberately pinned to one known-
 * good model (GROQ_MODEL / openai/gpt-oss-20b) rather than chasing an
 * auto-updating alias — see PromptBuilder.js's FREE_TIER_LIMITS comment.
 * A 404 here means real misconfiguration (a typo'd GROQ_MODEL), not the
 * kind of upstream deprecation Gemini's alias chases, so it surfaces as a
 * 'config' error instead of silently trying something else.
 */
export async function generate(userPrompt, { signal } = {}) {
  if (!isConfigured()) {
    throw new GroqError('No Groq API key found. Set GROQ_API_KEY in Vercel (server-side only, no REACT_APP_ prefix).', 'config');
  }

  let invalidOutputRetries = 0;
  for (let i = 0; ; i++) {
    try {
      return await attempt(userPrompt, signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e.kind === 'overloaded' && i < OVERLOAD_RETRY_DELAYS_MS.length) {
        await sleep(OVERLOAD_RETRY_DELAYS_MS[i]);
        continue;
      }
      if (e.kind === 'invalid_output' && invalidOutputRetries < INVALID_OUTPUT_MAX_RETRIES) {
        invalidOutputRetries++;
        continue;
      }
      throw e;
    }
  }
}
