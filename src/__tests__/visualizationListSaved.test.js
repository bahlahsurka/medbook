// VisualizationService.listSaved — the review screens' read-only path. Must
// be one RLS-scoped table read per entry (cached), never /api/visualize.
const mockQueries = [];
let mockRows = [];
let mockError = null;

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: (table) => {
      const q = { table, filters: [] };
      mockQueries.push(q);
      const chain = {
        select: (cols) => { q.cols = cols; return chain; },
        delete: () => { q.op = 'delete'; return chain; },
        eq: (col, val) => { q.filters.push([col, val]); return chain; },
        in: (col, vals) => { q.filters.push(['in', col, vals]); return chain; },
        neq: (col, val) => { q.filters.push(['neq', col, val]); return chain; },
        then: (resolve, reject) => Promise.resolve({ data: mockError ? null : mockRows, error: mockError }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

let VisualizationService;
beforeEach(() => {
  jest.resetModules();
  VisualizationService = require('../services/visualization').default;
  mockQueries.length = 0;
  mockError = null;
  mockRows = [];
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ visualization: {} }) }));
});

const mindMap = { nodes: [{ id: 'a', label: 'Root' }], edges: [] };
const editedMindMap = { nodes: [{ id: 'a', label: 'Root (edited)' }], edges: [] };
function row(vizType, graphData, extra = {}) {
  return { id: `${vizType}-id`, entry_id: 'e1', viz_type: vizType, graph_data: graphData, ai_model: 'm',
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', ...extra };
}

test('reads entry_visualizations for exactly one entry and never calls the generation endpoint', async () => {
  mockRows = [row('mind_map', mindMap)];
  const list = await VisualizationService.listSaved('e1');
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].table).toBe('entry_visualizations');
  expect(mockQueries[0].filters).toEqual([['entry_id', 'e1']]);
  expect(list.map(v => v.vizType)).toEqual(['mind_map']);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('filters out in-progress claim rows and empty diagrams for every type family', async () => {
  mockRows = [
    row('mind_map', {}),
    row('knowledge_network', { nodes: [] }),
    row('comparison_map', { subjects: [], dimensions: [], cells: [] }),
    row('visual_summary', { highlights: [{ title: 'x' }] }),
    row('clinical_flowchart', { nodes: [{ id: 'n' }], edges: [] }),
  ];
  const list = await VisualizationService.listSaved('e1');
  expect(list.map(v => v.vizType).sort()).toEqual(['clinical_flowchart', 'visual_summary']);
});

test('returns the CURRENT (edited) diagram while keeping the original and the edited flag', async () => {
  mockRows = [row('mind_map', { __medbookViz: 1, original: mindMap, current: editedMindMap, edited: true, editedAt: '2026-11-03T00:00:00Z' })];
  const [v] = await VisualizationService.listSaved('e1');
  expect(v.graphData).toEqual(editedMindMap);
  expect(v.originalGraphData).toEqual(mindMap);
  expect(v.isEdited).toBe(true);
});

test('caches per entry: concurrent and repeated calls share one query; peekSaved exposes the result', async () => {
  mockRows = [row('mind_map', mindMap)];
  expect(VisualizationService.peekSaved('e1')).toBeUndefined();
  const [a, b] = await Promise.all([VisualizationService.listSaved('e1'), VisualizationService.listSaved('e1')]);
  await VisualizationService.listSaved('e1');
  expect(mockQueries).toHaveLength(1);
  expect(a).toBe(b);
  expect(VisualizationService.peekSaved('e1')).toBe(a);
});

test('a save, restore, or generate in the detail view invalidates that entry\'s cache', async () => {
  mockRows = [row('mind_map', mindMap)];
  await VisualizationService.listSaved('e1');
  await VisualizationService.saveEdit('mind_map', 'e1', mindMap, {});
  expect(VisualizationService.peekSaved('e1')).toBeUndefined();
  await VisualizationService.listSaved('e1');
  expect(mockQueries).toHaveLength(2);

  await VisualizationService.restoreOriginal('mind_map', 'e1', {});
  await VisualizationService.listSaved('e1');
  await VisualizationService.generate('mind_map', 'e1', {});
  await VisualizationService.listSaved('e1');
  expect(mockQueries).toHaveLength(4);
});

test('a failed read surfaces an error and is not cached, so a retry queries again', async () => {
  mockError = { message: 'permission denied' };
  await expect(VisualizationService.listSaved('e1')).rejects.toThrow(/permission denied/);
  mockError = null;
  mockRows = [];
  await expect(VisualizationService.listSaved('e1')).resolves.toEqual([]);
  expect(mockQueries).toHaveLength(2);
});

describe('prefetchSavedTypes (saved counts before the drawer opens)', () => {
  test('one lightweight query for many entries: ids + types only, claim rows excluded', async () => {
    mockRows = [{ entry_id: 'e1', viz_type: 'mind_map' }, { entry_id: 'e1', viz_type: 'visual_summary' }];
    const listener = jest.fn();
    VisualizationService.subscribeSaved(listener);
    await VisualizationService.prefetchSavedTypes(['e1', 'e2', 'e1']);
    expect(mockQueries).toHaveLength(1);
    expect(mockQueries[0].cols).toBe('entry_id, viz_type');
    expect(mockQueries[0].filters).toEqual([['in', 'entry_id', ['e1', 'e2']], ['neq', 'graph_data', '{}']]);
    expect(VisualizationService.getSavedTypes('e1')).toEqual(['mind_map', 'visual_summary']);
    expect(VisualizationService.getSavedTypes('e2')).toEqual([]); // known: none saved
    expect(listener).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('already-known entries are never re-queried', async () => {
    mockRows = [];
    await VisualizationService.prefetchSavedTypes(['e1']);
    await VisualizationService.prefetchSavedTypes(['e1']);
    expect(mockQueries).toHaveLength(1);
  });

  test('getSavedTypes returns the same array until it changes (stable snapshot)', async () => {
    mockRows = [{ entry_id: 'e1', viz_type: 'mind_map' }];
    await VisualizationService.prefetchSavedTypes(['e1']);
    expect(VisualizationService.getSavedTypes('e1')).toBe(VisualizationService.getSavedTypes('e1'));
  });

  test('a listSaved result also records the entry\'s types; a save/regenerate forgets them', async () => {
    mockRows = [row('mind_map', mindMap)];
    await VisualizationService.listSaved('e1');
    expect(VisualizationService.getSavedTypes('e1')).toEqual(['mind_map']);
    await VisualizationService.saveEdit('mind_map', 'e1', mindMap, {});
    expect(VisualizationService.getSavedTypes('e1')).toBeUndefined();
  });

  test('a failed lookup is silent and leaves counts unknown', async () => {
    mockError = { message: 'offline' };
    await expect(VisualizationService.prefetchSavedTypes(['e9'])).resolves.toBeUndefined();
    expect(VisualizationService.getSavedTypes('e9')).toBeUndefined();
  });
});

test('deleteSaved deletes exactly one (entry, type) row, never calls an AI endpoint, and drops the cached list', async () => {
  mockRows = [row('mind_map', mindMap)];
  await VisualizationService.listSaved('e1');
  await VisualizationService.deleteSaved('mind_map', 'e1');
  const del = mockQueries.find(q => q.op === 'delete');
  expect(del.table).toBe('entry_visualizations');
  expect(del.filters).toEqual([['entry_id', 'e1'], ['viz_type', 'mind_map']]);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(VisualizationService.peekSaved('e1')).toBeUndefined();
});

test('deleteSaved surfaces a database error', async () => {
  mockError = { message: 'denied' };
  await expect(VisualizationService.deleteSaved('mind_map', 'e1')).rejects.toThrow('denied');
});

describe('generate() in flight (review drawer can close mid-generation)', () => {
  test('a second call for the same entry+type shares the running request; pendingGenerations lists it until done', async () => {
    let release;
    global.fetch = jest.fn(() => new Promise(r => { release = () => r({ ok: true, json: async () => ({ visualization: { vizType: 'mind_map' } }) }); }));
    const a = VisualizationService.generate('mind_map', 'e1', {});
    const b = VisualizationService.generate('mind_map', 'e1', {});
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(VisualizationService.pendingGenerations('e1').map(g => g.vizType)).toEqual(['mind_map']);
    expect(VisualizationService.pendingGenerations('e2')).toEqual([]);
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(VisualizationService.pendingGenerations('e1')).toEqual([]);
  });

  test('a successful generation adds its type to the known saved types (the review button count updates)', async () => {
    mockRows = [{ entry_id: 'e1', viz_type: 'comparison_map' }];
    await VisualizationService.prefetchSavedTypes(['e1']);
    const listener = jest.fn();
    VisualizationService.subscribeSaved(listener);
    await VisualizationService.generate('mind_map', 'e1', {});
    expect(VisualizationService.getSavedTypes('e1')).toEqual(['comparison_map', 'mind_map']);
    expect(listener).toHaveBeenCalled();
    expect(VisualizationService.peekSaved('e1')).toBeUndefined(); // full list re-read next time
  });

  test('a failed generation forgets the entry\'s cached state and is no longer pending', async () => {
    mockRows = [{ entry_id: 'e1', viz_type: 'comparison_map' }];
    await VisualizationService.prefetchSavedTypes(['e1']);
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }));
    await expect(VisualizationService.generate('mind_map', 'e1', {})).rejects.toBeTruthy();
    expect(VisualizationService.getSavedTypes('e1')).toBeUndefined();
    expect(VisualizationService.pendingGenerations('e1')).toEqual([]);
  });
});

test('getSavedRevision changes when an entry\'s saved diagrams change (generate, save, delete), not for other entries', async () => {
  const r0 = VisualizationService.getSavedRevision('e1');
  await VisualizationService.generate('mind_map', 'e1', {});
  const r1 = VisualizationService.getSavedRevision('e1');
  expect(r1).not.toBe(r0);
  await VisualizationService.saveEdit('mind_map', 'e1', mindMap, {});
  const r2 = VisualizationService.getSavedRevision('e1');
  expect(r2).not.toBe(r1);
  await VisualizationService.deleteSaved('mind_map', 'e1');
  expect(VisualizationService.getSavedRevision('e1')).not.toBe(r2);
  expect(VisualizationService.getSavedRevision('e2')).toBe(0);
});
