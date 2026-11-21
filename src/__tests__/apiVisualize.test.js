// Focused integration test for api/visualize.mjs's handler — Supabase and
// Groq are both mocked (no real network/DB), exercising exactly the
// behaviors the architecture audit (and the subsequent reliability/speed
// fix pass) called out as needing verification: auth, ownership
// enforcement, cache hit/miss, stale-content detection, duplicate-request
// dedup via the claim mechanism, and that an invalid Groq response never
// gets persisted.
import { createClient } from '@supabase/supabase-js';
import * as GroqService from '../services/ai/GroqService';
import handler from '../../api/visualize.mjs';

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

const VALID_DIAGRAM_JSON = JSON.stringify({
  centralTopic: 'DKA',
  nodes: [
    { id: 'central', label: 'DKA', explanation: 'Hyperglycemia + acidosis + ketosis.', category: 'central_topic', sourceType: 'entry', sourceRef: 'DKA presents with hyperglycemia' },
    { id: 'mgmt', label: 'Management', explanation: 'Fluids before insulin.', category: 'branch', sourceType: 'entry', sourceRef: 'saline before starting insulin' },
  ],
  edges: [
    { source: 'central', target: 'mgmt', relationship: 'treats', label: '' },
  ],
});

const OLD_REAL_DIAGRAM = {
  centralTopic: 'old',
  nodes: [{ id: 'x', label: 'x', explanation: 'x', category: 'subtopic', sourceType: 'entry', sourceRef: 'x' }],
  edges: [],
};

function makeQueryChain({ selectResult, upsertResult, insertResult = { error: null }, updateResult = { error: null } }) {
  const selectChain = {
    eq: () => selectChain,
    maybeSingle: async () => selectResult,
  };
  const updateChain = { eq: () => updateChain };
  return {
    select: () => selectChain,
    upsert: () => ({ select: () => ({ single: async () => upsertResult }) }),
    insert: async () => insertResult,
    update: () => ({ eq: () => ({ eq: async () => updateResult }) }),
  };
}

function makeSupabaseMock({
  user = { id: USER_ID },
  authError = null,
  entryResult = { data: { id: ENTRY_ID, user_id: USER_ID, notes: 'A review long enough to pass the 40-character minimum length floor.' }, error: null },
  existingVizResult = { data: null, error: null },
  savedVizResult = { data: null, error: null },
  insertResult = { error: null },
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: authError ? null : user }, error: authError }) },
    from: (table) => {
      if (table === 'entries') return makeQueryChain({ selectResult: entryResult });
      if (table === 'entry_visualizations') return makeQueryChain({ selectResult: existingVizResult, upsertResult: savedVizResult, insertResult });
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
  GroqService.getRequestCount.mockReturnValue(0);
  GroqService.getLastUsage.mockReturnValue(null);
  process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon-key';
});

describe('api/visualize.mjs — auth and ownership', () => {
  test('rejects a request with no Authorization header', async () => {
    const { req, res } = makeReqRes({ auth: null, body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects an invalid/expired session', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ authError: { message: 'bad token' } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 404 (not 403) when the entry does not belong to the caller', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: 'someone-else', notes: 'x'.repeat(60) }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 when the entry simply does not exist', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ entryResult: { data: null, error: null } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects an unsupported visualization type', async () => {
    createClient.mockReturnValue(makeSupabaseMock());
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'clinical_flowchart' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a Review that is too short to diagram', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes: 'too short' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(GroqService.generate).not.toHaveBeenCalled();
  });
});

describe('api/visualize.mjs — caching', () => {
  test('cache hit: same hash, no regenerate -> returns cached result without calling Groq', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    const { computeContentHash } = require('../services/ai/contentHash');
    const hash = computeContentHash(notes, '');

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: hash, graph_data: { centralTopic: 'cached', nodes: [{ id: 'a', label: 'a', explanation: 'a', category: 'central_topic', sourceType: 'entry', sourceRef: 'a' }], edges: [] }, extra_context: null, ai_provider: 'groq', ai_model: 'openai/gpt-oss-20b', created_at: 't0', updated_at: 't0' }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.cached).toBe(true);
    expect(payload.visualization.graphData.centralTopic).toBe('cached');
    expect(payload.timing).toEqual({ totalMs: 0 });
    expect(payload.coverage).toBeDefined();
  });

  test('cache miss: stale hash (notes changed since last generation) -> regenerates via Groq', async () => {
    const notes = 'A DIFFERENT review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_DIAGRAM_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: 'stale-hash-does-not-match', graph_data: OLD_REAL_DIAGRAM, created_at: 't0', updated_at: new Date().toISOString() }, error: null },
      savedVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: 'new-hash', graph_data: JSON.parse(VALID_DIAGRAM_JSON), extra_context: null, ai_provider: 'groq', ai_model: 'openai/gpt-oss-20b', created_at: 't0', updated_at: 't1' }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].cached).toBe(false);
  });

  test('regenerate:true bypasses an otherwise-valid cache hit', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    const { computeContentHash } = require('../services/ai/contentHash');
    const hash = computeContentHash(notes, '');
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_DIAGRAM_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: hash, graph_data: OLD_REAL_DIAGRAM, created_at: 't0', updated_at: new Date().toISOString() }, error: null },
      savedVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: hash, graph_data: JSON.parse(VALID_DIAGRAM_JSON), extra_context: null, ai_provider: 'groq', ai_model: 'openai/gpt-oss-20b', created_at: 't0', updated_at: 't1' }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', regenerate: true } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].cached).toBe(false);
  });

  test('no existing row at all -> generates and saves (first-ever generation for this entry+type)', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_DIAGRAM_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: null, error: null },
      savedVizResult: { data: { id: 'viz-new', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: 'h', graph_data: JSON.parse(VALID_DIAGRAM_JSON), extra_context: null, ai_provider: 'groq', ai_model: 'openai/gpt-oss-20b', created_at: 't0', updated_at: 't0' }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.coverage.uncoveredStatements).toBeDefined();
    expect(payload.timing.totalMs).toBeGreaterThanOrEqual(0);
  });

  test('generation uses medium reasoning effort and a token budget scaled to the review length', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_DIAGRAM_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: null, error: null },
      savedVizResult: { data: { id: 'viz-new', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: JSON.parse(VALID_DIAGRAM_JSON), created_at: 't0', updated_at: 't0' }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      reasoningEffort: 'medium',
      maxCompletionTokens: 8192, // notes.length < 400
    }));
  });
});

describe('api/visualize.mjs — duplicate-generation dedup', () => {
  test('a fresh in-progress claim (no existing row yet) causes a concurrent request to get 409, not a second Groq call', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: null, error: null },
      // Simulates the race: by the time THIS request tries to INSERT its
      // own claim, a concurrent request already has one — Postgres's
      // unique_violation surfaces as error.code '23505'.
      insertResult: { error: { code: '23505', message: 'duplicate key' } },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].kind).toBe('in_progress');
  });

  test('an existing FRESH claim row (graph_data still empty, updated_at just now) also returns 409 without calling Groq', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: 'whatever', graph_data: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('a STALE claim row (graph_data still empty, updated_at long ago) is treated as abandoned — generation proceeds', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.generate.mockResolvedValue(VALID_DIAGRAM_JSON);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');

    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
      existingVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', source_content_hash: 'whatever', graph_data: {}, created_at: longAgo, updated_at: longAgo }, error: null },
      savedVizResult: { data: { id: 'viz-1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: JSON.parse(VALID_DIAGRAM_JSON), created_at: longAgo, updated_at: 't1' }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(GroqService.generate).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('api/visualize.mjs — invalid Groq output never gets persisted', () => {
  test('a structurally invalid diagram (dangling edge) surfaces as an error, not a save', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    GroqService.generate.mockResolvedValue(JSON.stringify({
      centralTopic: 'DKA',
      nodes: [{ id: 'central', label: 'DKA', explanation: 'x', category: 'central_topic', sourceType: 'entry', sourceRef: 'x' }],
      edges: [{ source: 'central', target: 'ghost_node_that_does_not_exist', relationship: 'treats', label: '' }],
    }));

    let upsertCalled = false;
    createClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table) => {
        if (table === 'entries') {
          return makeQueryChain({ selectResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null } });
        }
        if (table === 'entry_visualizations') {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            insert: async () => ({ error: null }),
            upsert: () => { upsertCalled = true; return { select: () => ({ single: async () => ({ data: null, error: null }) }) }; },
          };
        }
        throw new Error('unexpected table');
      },
    });

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(upsertCalled).toBe(false); // never reached the save step
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].kind).toBe('invalid_diagram');
  });

  test('Groq quota exhaustion maps to 429', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    const err = new Error('Groq rate limit reached.');
    err.kind = 'quota';
    GroqService.generate.mockRejectedValue(err);

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('Groq invalid_output maps to a clear, non-technical user message', async () => {
    const notes = 'A review long enough to pass the 40-character minimum length floor.';
    GroqService.isConfigured.mockReturnValue(true);
    GroqService.activeModel.mockReturnValue('openai/gpt-oss-20b');
    const err = new Error('Groq produced output that did not match the required structure.');
    err.kind = 'invalid_output';
    GroqService.generate.mockRejectedValue(err);

    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).not.toContain('json_validate_failed');
    expect(payload.error.toLowerCase()).toContain('try again');
  });

  test('Groq not configured at all -> 500 config error, no cache row needed', async () => {
    GroqService.isConfigured.mockReturnValue(false);
    createClient.mockReturnValue(makeSupabaseMock({
      entryResult: { data: { id: ENTRY_ID, user_id: USER_ID, notes: 'x'.repeat(60) }, error: null },
    }));

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].kind).toBe('config');
  });
});

describe('api/visualize.mjs — method guard', () => {
  test('rejects non-POST methods', async () => {
    const { req, res } = makeReqRes({ method: 'GET', body: {} });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
