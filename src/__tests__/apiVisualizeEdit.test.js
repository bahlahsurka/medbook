// Focused integration test for api/visualize-edit.mjs — Phase 4's save/
// restore endpoint. Supabase is mocked (no real DB); Groq is never even
// imported by this handler, so "never calls Groq" is trivially enforced
// by the module graph itself, not just by behavior — nothing here could
// accidentally reach it.
import { createClient } from '@supabase/supabase-js';
import handler from '../../api/visualize-edit.mjs';
import { wrapEdited } from '../services/ai/visualizationStorage';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const USER_ID = 'user-123';
const ENTRY_ID = 'entry-abc';

const VALID_MINDMAP_DIAGRAM = {
  centralTopic: 'DKA',
  nodes: [
    { id: 'central', label: 'DKA', explanation: 'x', category: 'central_topic', sourceType: 'entry', sourceRef: 'y' },
    { id: 'mgmt', label: 'Management', explanation: 'x', category: 'branch', sourceType: 'entry', sourceRef: 'y' },
  ],
  edges: [{ source: 'central', target: 'mgmt', relationship: 'treats', label: '' }],
};

function makeQueryChain({ selectResult, updateResult }) {
  const selectChain = { eq: () => selectChain, maybeSingle: async () => selectResult };
  return {
    select: () => selectChain,
    update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => updateResult }) }) }) }),
  };
}

function makeSupabaseMock({ user = { id: USER_ID }, authError = null, selectResult, updateResult = { data: null, error: null } }) {
  return {
    auth: { getUser: async () => ({ data: { user: authError ? null : user }, error: authError }) },
    from: (table) => {
      if (table === 'entry_visualizations') return makeQueryChain({ selectResult, updateResult });
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

describe('api/visualize-edit.mjs — request validation', () => {
  test('rejects non-POST methods', async () => {
    const { req, res } = makeReqRes({ method: 'GET', body: {} });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  test('rejects missing auth', async () => {
    const { req, res } = makeReqRes({ auth: null, body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects an unrecognized vizType', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ selectResult: { data: null, error: null } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'nope', action: 'save' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects an action that is neither save nor restore', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ selectResult: { data: null, error: null } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'delete' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects "save" with no editedGraphData', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ selectResult: { data: null, error: null } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404s when nothing has been generated for this entry+type yet', async () => {
    createClient.mockReturnValue(makeSupabaseMock({ selectResult: { data: null, error: null } }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: VALID_MINDMAP_DIAGRAM } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects editing a row that is still just a generation claim ({}), not a real diagram', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: {}, updated_at: 't0' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: VALID_MINDMAP_DIAGRAM } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('409s when baseUpdatedAt no longer matches the row (concurrent edit elsewhere)', async () => {
    createClient.mockReturnValue(makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, updated_at: 'NEWER' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: VALID_MINDMAP_DIAGRAM, baseUpdatedAt: 'OLDER' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('api/visualize-edit.mjs — save', () => {
  test('validates and persists an edit, wrapping it as an envelope with the original preserved', async () => {
    const edited = { ...VALID_MINDMAP_DIAGRAM, centralTopic: 'DKA (edited)' };
    createClient.mockReturnValue(makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, extra_context: null, updated_at: 't0' }, error: null },
      updateResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: wrapEdited(VALID_MINDMAP_DIAGRAM, edited, 't1'), updated_at: 't1' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: edited, baseUpdatedAt: 't0' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.action).toBe('save');
    expect(payload.visualization.isEdited).toBe(true);
    expect(payload.visualization.graphData.centralTopic).toBe('DKA (edited)');
    expect(payload.visualization.originalGraphData).toEqual(VALID_MINDMAP_DIAGRAM);
  });

  test('rejects a structurally invalid edit (dangling edge) — nothing is saved', async () => {
    const invalid = {
      ...VALID_MINDMAP_DIAGRAM,
      edges: [{ source: 'central', target: 'ghost_node', relationship: 'treats', label: '' }],
    };
    let updateCalled = false;
    const mock = makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, extra_context: null, updated_at: 't0' }, error: null },
    });
    const originalUpdate = mock.from('entry_visualizations').update;
    mock.from = (table) => {
      const chain = makeQueryChain({ selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, extra_context: null, updated_at: 't0' }, error: null } });
      chain.update = (...args) => { updateCalled = true; return originalUpdate(...args); };
      return chain;
    };
    createClient.mockReturnValue(mock);

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: invalid } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateCalled).toBe(false);
  });

  test('rejects an edit marked ai_context when this diagram was never generated with extra context', async () => {
    const withAiContext = {
      ...VALID_MINDMAP_DIAGRAM,
      nodes: [...VALID_MINDMAP_DIAGRAM.nodes, { id: 'ctx', label: 'x', explanation: 'x', category: 'subtopic', sourceType: 'ai_context', sourceRef: 'x' }],
      edges: [...VALID_MINDMAP_DIAGRAM.edges, { source: 'mgmt', target: 'ctx', relationship: 'related_to', label: '' }],
    };
    createClient.mockReturnValue(makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, extra_context: null, updated_at: 't0' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: withAiContext } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('accepts a brand-new user_added node', async () => {
    const withUserNode = {
      ...VALID_MINDMAP_DIAGRAM,
      nodes: [...VALID_MINDMAP_DIAGRAM.nodes, { id: 'user1', label: 'My note', explanation: 'x', category: 'subtopic', sourceType: 'user_added', sourceRef: 'Added by you during editing' }],
      edges: [...VALID_MINDMAP_DIAGRAM.edges, { source: 'mgmt', target: 'user1', relationship: 'related_to', label: '' }],
    };
    createClient.mockReturnValue(makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, extra_context: null, updated_at: 't0' }, error: null },
      updateResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: wrapEdited(VALID_MINDMAP_DIAGRAM, withUserNode, 't1'), updated_at: 't1' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'save', editedGraphData: withUserNode } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('api/visualize-edit.mjs — restore (never calls Groq)', () => {
  test('restores current to the preserved original when the row is edited', async () => {
    const edited = { ...VALID_MINDMAP_DIAGRAM, centralTopic: 'edited' };
    createClient.mockReturnValue(makeSupabaseMock({
      selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: wrapEdited(VALID_MINDMAP_DIAGRAM, edited, 't1'), updated_at: 't1' }, error: null },
      updateResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: { __medbookViz: 1, original: VALID_MINDMAP_DIAGRAM, current: VALID_MINDMAP_DIAGRAM, edited: false, editedAt: null }, updated_at: 't2' }, error: null },
    }));
    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'restore' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.action).toBe('restore');
    expect(payload.visualization.isEdited).toBe(false);
    expect(payload.visualization.graphData).toEqual(VALID_MINDMAP_DIAGRAM);
  });

  test('is a no-op success when the diagram was never edited — still no write, still no Groq', async () => {
    let updateCalled = false;
    const mock = makeSupabaseMock({ selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, updated_at: 't0' }, error: null } });
    mock.from = (table) => {
      const chain = makeQueryChain({ selectResult: { data: { id: 'v1', entry_id: ENTRY_ID, viz_type: 'mind_map', graph_data: VALID_MINDMAP_DIAGRAM, updated_at: 't0' }, error: null } });
      const originalUpdate = chain.update;
      chain.update = (...args) => { updateCalled = true; return originalUpdate(...args); };
      return chain;
    };
    createClient.mockReturnValue(mock);

    const { req, res } = makeReqRes({ body: { entryId: ENTRY_ID, vizType: 'mind_map', action: 'restore' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateCalled).toBe(false);
  });
});
