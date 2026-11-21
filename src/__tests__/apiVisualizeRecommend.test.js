// Focused integration test for api/visualize-recommend.mjs — the optional
// "Recommend" feature's backend. Supabase and Groq are both mocked, same
// pattern as apiVisualize.test.js. This endpoint never writes to
// entry_visualizations (it recommends, it doesn't generate), so there's
// no caching/dedup behavior to exercise here — just auth/ownership, the
// Groq call, and validation.
import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../services/ai/GroqService';
import handler from '../../api/visualize-recommend.mjs';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../services/ai/GroqService', () => ({
  isConfigured: jest.fn(),
  generate: jest.fn(),
}));

const USER_ID = 'user-123';
const ENTRY_ID = 'entry-abc';
const NOTES = 'A review long enough to pass the 40-character minimum length floor.';

const VALID_RECOMMENDATION_JSON = JSON.stringify({
  recommended: ['mechanism_diagram', 'clinical_flowchart'],
  rationale: 'The review explains both how it happens and what to do about it.',
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
  };
}

function makeReqRes({ body, auth = 'Bearer test-token', method = 'POST' } = {}) {
  const req = { method, headers: auth ? { authorization: auth } : {}, body };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon-key';
});

describe('api/visualize-recommend.mjs', () => {
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

  test('returns 404 when the entry does not belong to the caller', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: 'someone-else', notes: NOTES }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects a Review that is too short to classify', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes: 'too short' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns a recommendation on success, using a cheap low-effort Groq call', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_RECOMMENDATION_JSON);
    createClient.mockReturnValue(makeSupabaseMock());

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      reasoningEffort: 'low',
      schemaName: 'medbook_visualization_recommendation',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].recommended).toEqual(['mechanism_diagram', 'clinical_flowchart']);
  });

  test('never writes anything — this endpoint is advisory-only, not a generator', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_RECOMMENDATION_JSON);
    const supabaseMock = makeSupabaseMock();
    createClient.mockReturnValue(supabaseMock);

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    // The mock's `from` throws for any table other than 'entries' — if the
    // handler ever tried to touch entry_visualizations, this test would
    // have already failed above instead of reaching this assertion.
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('an invalid Groq response surfaces as a clear error, not a crash', async () => {
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue('{not json');
    createClient.mockReturnValue(makeSupabaseMock());

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
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
