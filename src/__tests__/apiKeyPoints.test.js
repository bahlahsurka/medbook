// Focused integration test for api/key-points.mjs — Supabase and Groq are
// both mocked (no real network/DB), exercising auth, ownership
// enforcement, the full-entry-text-sent guarantee, and that an invalid
// Groq response never gets treated as success.
import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../services/ai/GroqService';
import handler from '../../api/key-points.mjs';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../services/ai/GroqService', () => ({
  isConfigured: jest.fn(),
  generate: jest.fn(),
  activeModel: jest.fn(),
  getRequestCount: jest.fn(() => 0),
  getLastUsage: jest.fn(() => null),
}));

const USER_ID = 'user-123';
const ENTRY_ID = 'entry-abc';
const NOTES = 'A review long enough to pass the 40-character minimum length floor.';

const VALID_KEY_POINTS_JSON = JSON.stringify({
  topic: 'Test topic',
  sections: [{ heading: 'Section', bullets: [{ text: 'A fact', emphasis: 'normal', sourceRef: 'a fact' }] }],
});

function makeQueryChain(selectResult) {
  const chain = { eq: () => chain, maybeSingle: async () => selectResult };
  return { select: () => chain };
}

function makeSupabaseMock({ user = { id: USER_ID }, authError = null, entryResult = { data: { id: ENTRY_ID, user_id: USER_ID, notes: NOTES }, error: null } } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: authError ? null : user }, error: authError }) },
    from: (table) => {
      if (table === 'entries') return makeQueryChain(entryResult);
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async () => ({ data: 1, error: null }),
  };
}

function makeReqRes({ body, auth = 'Bearer test-token', method = 'POST' } = {}) {
  const req = { method, headers: auth ? { authorization: auth } : {}, body };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  GroqService.getRequestCount.mockReturnValue(0);
  GroqService.getLastUsage.mockReturnValue(null);
  process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});

describe('api/key-points.mjs — request validation', () => {
  test('rejects non-POST methods', async () => {
    const { req, res } = makeReqRes({ method: 'GET', body: {} });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test('rejects a request with no Authorization header', async () => {
    const { req, res } = makeReqRes({ auth: null, body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects an invalid/expired session', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ authError: { message: 'bad token' } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 404 when the entry does not belong to the caller (never confirms it exists)', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: 'someone-else', notes: NOTES }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects a Review that is too short to summarize', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes: 'too short' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(GroqService.generate).not.toHaveBeenCalled();
  });

  test('maps a config error (no GROQ_API_KEY) to 500', async () => {
    GroqService.isConfigured.mockReturnValue(false);
    createClient.mockReturnValue(makeSupabaseMock());
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].kind).toBe('config');
  });
});

describe('api/key-points.mjs — generation', () => {
  test('sends the FULL, untruncated review text and a medium reasoning effort', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_KEY_POINTS_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    createClient.mockReturnValue(makeSupabaseMock());

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledWith(
      expect.stringContaining(NOTES),
      expect.objectContaining({ reasoningEffort: 'medium', schemaName: 'medbook_key_points' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('on success, returns keyPoints, a fidelity report, and a sourceContentHash', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_KEY_POINTS_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    createClient.mockReturnValue(makeSupabaseMock());

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.keyPoints.topic).toBe('Test topic');
    expect(payload.fidelity.disclaimer).toBeTruthy();
    expect(Array.isArray(payload.fidelity.warnings)).toBe(true);
    expect(typeof payload.sourceContentHash).toBe('string');
    expect(payload.sourceNotesLength).toBe(NOTES.length);
  });

  test('a structurally invalid response (missing sections) is rejected, not saved as success', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    GroqService.generate.mockResolvedValue(JSON.stringify({ topic: 'x', sections: [] }));
    createClient.mockReturnValue(makeSupabaseMock());

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].kind).toBe('invalid_key_points');
  });

  test('Groq quota exhaustion maps to 429', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    const err = new Error('Groq rate limit reached.');
    err.kind = 'quota';
    GroqService.generate.mockRejectedValue(err);
    createClient.mockReturnValue(makeSupabaseMock());

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
  });
});
