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

// Timing/usage from the LAST successful attempt — read by a caller right
// after generate() resolves (same pattern as getRequestCount() below) so
// api/analyze.mjs and api/visualize.mjs can both surface real numbers
// (actual latency, actual prompt/completion token counts from Groq's own
// `usage` field) instead of guessing. Reset per attempt, so a retry's
// numbers always reflect whichever attempt actually succeeded.
let lastElapsedMs = 0;
let lastUsage = null;
export function getLastElapsedMs() { return lastElapsedMs; }
export function getLastUsage() { return lastUsage; }

/**
 * One attempt. Throws GroqError on any failure.
 *
 * `task` carries everything that varies by WHAT is being asked of the model
 * (system instruction, schema, schema name, token budget) — defaulted to
 * MedBook's existing six-section Review analysis so every pre-existing
 * caller (api/analyze.mjs, passing none of this) gets byte-identical
 * behavior. A second task (api/visualize.mjs's Mind Map generation) passes
 * its own values instead, reusing this same transport/retry/error-mapping
 * logic rather than duplicating it — see this file's own header comment on
 * why that retry discipline is worth never re-deriving by hand. Adding a
 * THIRD task later (another visualization type, or another provider
 * following this same shape) needs no change here at all.
 */
async function attempt(userPrompt, signal, task = {}) {
  const {
    systemInstruction = GROQ_SYSTEM_INSTRUCTION,
    responseSchema = GROQ_RESPONSE_SCHEMA,
    schemaName = 'medbook_review_analysis',
    maxCompletionTokens = 32768,
    // Six-section analysis keeps its own hard-won 'high' default (see the
    // reasoning_effort comment below) unchanged. A task whose structured
    // output is itself more complex to get right under strict mode (more
    // nested required fields, more ways to violate the schema) benefits
    // from LOWER reasoning effort, not higher — less of the shared
    // reasoning+output token budget spent "thinking" before the model even
    // starts committing to JSON means less chance of exhausting that budget
    // mid-structure (a real contributor to json_validate_failed, not just
    // slower responses) — see api/visualize.mjs's own task config.
    reasoningEffort = 'high',
  } = task;

  const n = ++requestCount;
  const startedAt = Date.now();
  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Groq] request #${n} → ${MODEL} (prompt ${userPrompt.length} chars, schema ${schemaName})`);
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
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: true,
            schema: responseSchema,
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
        reasoning_effort: reasoningEffort,
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
        // the first attempt at 'high' effectively was. (This default is
        // this specific analysis task's own tuning — see `task` above;
        // another task can pass its own budget instead.)
        max_completion_tokens: maxCompletionTokens,
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new GroqError('Network error reaching Groq. Check your connection.', 'network');
  }

  const elapsedMs = Date.now() - startedAt;
  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[Groq] request #${n} ← HTTP ${res.status} from ${MODEL} in ${elapsedMs}ms`);
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

    // Always-on (not DEV-gated) — Vercel captures stdout as runtime logs
    // regardless of NODE_ENV, and the DEV-only logs above never fire in
    // production, which is exactly why a real production failure couldn't
    // be diagnosed from logs before this. Deliberately logs ONLY transport
    // metadata — http status, Groq's own short machine code/type, schema
    // name, elapsed time — never `message` (can echo back model output
    // derived from the student's medical notes) and never the request body,
    // API key, or Groq's `error.failed_generation` field.
    // eslint-disable-next-line no-console
    console.error(`[Groq] FAILED schema=${schemaName} model=${MODEL} attempt=#${n} http=${res.status} code=${code || 'none'} type=${type || 'none'} elapsedMs=${elapsedMs}`);

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

  lastElapsedMs = elapsedMs;
  lastUsage = data.usage ? {
    promptTokens: data.usage.prompt_tokens ?? null,
    completionTokens: data.usage.completion_tokens ?? null,
    totalTokens: data.usage.total_tokens ?? null,
    // Groq's reasoning token count, when the API reports it separately —
    // the actual number this file's whole reasoning_effort history has
    // been reasoning about from the outside without ever seeing it.
    reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? null,
  } : null;
  // Always-on success log, same metadata-only discipline as the failure
  // log above — this is what makes "measure actual latency/token usage"
  // (rather than guess it) possible from Vercel's runtime logs going
  // forward, for every attempt, not just failures.
  // eslint-disable-next-line no-console
  console.log(`[Groq] OK schema=${schemaName} model=${MODEL} attempt=#${n} elapsedMs=${elapsedMs}` +
    (lastUsage ? ` promptTokens=${lastUsage.promptTokens} completionTokens=${lastUsage.completionTokens} reasoningTokens=${lastUsage.reasoningTokens}` : ''));

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
 *
 * `systemInstruction`/`responseSchema`/`schemaName`/`maxCompletionTokens`
 * are all optional and default to the existing Review-analysis task
 * unchanged — see attempt()'s own comment. A caller doing something other
 * than six-section analysis (e.g. api/visualize.mjs's Mind Map generation)
 * passes its own values; everything else below (retry/backoff/error
 * mapping) applies identically regardless of which task this is.
 */
export async function generate(userPrompt, { signal, systemInstruction, responseSchema, schemaName, maxCompletionTokens, reasoningEffort } = {}) {
  if (!isConfigured()) {
    throw new GroqError('No Groq API key found. Set GROQ_API_KEY in Vercel (server-side only, no REACT_APP_ prefix).', 'config');
  }
  const task = { systemInstruction, responseSchema, schemaName, maxCompletionTokens, reasoningEffort };

  let invalidOutputRetries = 0;
  for (let i = 0; ; i++) {
    try {
      return await attempt(userPrompt, signal, task);
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
