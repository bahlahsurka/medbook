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
        eq: (col, val) => { q.filters.push([col, val]); return chain; },
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
