// lib/entrySharing.js — links, snapshots, owner share rows and the
// recipient's "Save to my MedBook" copy (Supabase mocked).
const SUPA = 'https://example.supabase.co';
const OWN_IMG = `${SUPA}/storage/v1/object/public/entry-images/owner/123_a.png`;

const mockCalls = [];
let mockResults = {};
jest.mock('../lib/supabase', () => {
  const chain = (table) => {
    const call = { table, ops: [] };
    mockCalls.push(call);
    const api = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const r = (mockResults[table] && mockResults[table](call)) || { data: null, error: null };
          return (res, rej) => Promise.resolve(r).then(res, rej);
        }
        return (...args) => { call.ops.push([prop, ...args]); return api; };
      },
    });
    return api;
  };
  return {
    supabase: {
      from: (t) => chain(t),
      rpc: jest.fn(),
      storage: {
        from: () => ({
          upload: jest.fn(async (path) => { mockCalls.push({ table: 'storage', ops: [['upload', path]] }); return { error: null }; }),
          getPublicUrl: (path) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/entry-images/${path}` } }),
        }),
      },
    },
  };
});
jest.mock('../lib/systems', () => ({ saveSystems: jest.fn(async () => {}) }));

const { supabase } = require('../lib/supabase');
const { saveSystems } = require('../lib/systems');
const S = require('../lib/entrySharing');

const MIND_MAP = { nodes: [{ id: 'a', label: 'Root' }], edges: [] };
const ENTRY = {
  id: 'e1', user_id: 'owner', system: 'Cardiology', title: 'Digoxin toxicity', notes: '**Bold** notes',
  difficulty: 'Hard', images: [OWN_IMG], highlights: [{ start: 0, end: 4, color: '#fef08a' }],
  ai_sections: { keyPoints: { content: { topic: 'x', sections: [] }, sourceNotesLength: 14 }, flashcards: [{ q: 'Q', a: 'A' }], clinicalPearls: ['legacy'] },
  review_count: 7, next_review: '2026-12-01T00:00:00Z', pinned: true,
};
const VIZ_ROWS = [
  { viz_type: 'mind_map', graph_data: MIND_MAP, source_content_hash: 'h1', extra_context: null, ai_provider: 'groq', ai_model: 'm' },
  { viz_type: 'knowledge_network', graph_data: {}, source_content_hash: 'h2' },     // in-progress claim row
  { viz_type: 'not_a_type', graph_data: MIND_MAP, source_content_hash: 'h3' },
];

beforeEach(() => {
  mockCalls.length = 0;
  mockResults = {};
  process.env.REACT_APP_SUPABASE_URL = SUPA;
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) }));
  try { localStorage.clear(); } catch { /* jsdom */ }
});

describe('links', () => {
  const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';
  test('share URLs and parsing', () => {
    expect(S.shareUrl(TOKEN, 'https://medbook.app')).toBe(`https://medbook.app/s/${TOKEN}`);
    expect(S.parseShareToken(`/s/${TOKEN}`)).toBe(TOKEN);
    expect(S.parseShareToken(`/s/${TOKEN.toUpperCase()}/`)).toBe(TOKEN);
    expect(S.parseShareToken('/s/not-a-token')).toBeNull();
    expect(S.parseShareToken('/app')).toBeNull();
  });
  test('a pending link survives until taken once', () => {
    S.rememberPendingShare(TOKEN);
    expect(S.takePendingShare()).toBe(TOKEN);
    expect(S.takePendingShare()).toBeNull();
  });
});

describe('snapshot', () => {
  test('stable comparison ignores key order (jsonb reorders keys)', () => {
    expect(S.sameSnapshot({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(true);
    expect(S.sameSnapshot({ a: 1 }, { a: 2 })).toBe(false);
  });

  test('includes notes, highlights, images, Key Points, flashcard suggestions and real diagrams only', () => {
    const snap = S.snapshotFrom(ENTRY, VIZ_ROWS, '#dc2626');
    expect(snap).toMatchObject({
      v: 1, title: 'Digoxin toxicity', notes: '**Bold** notes', difficulty: 'Hard', system: 'Cardiology', systemColor: '#dc2626',
      highlights: ENTRY.highlights, images: [OWN_IMG], keyPoints: ENTRY.ai_sections.keyPoints, flashcards: ENTRY.ai_sections.flashcards,
    });
    expect(snap.visualizations).toEqual([{ vizType: 'mind_map', graphData: MIND_MAP, sourceContentHash: 'h1', extraContext: null, aiProvider: 'groq', aiModel: 'm' }]);
    // review progress, pin state and legacy AI fields are not shared
    expect(JSON.stringify(snap)).not.toMatch(/review_count|next_review|pinned|clinicalPearls/);
  });

  test('buildSnapshot reads the entry and its diagrams fresh', async () => {
    mockResults.entries = () => ({ data: ENTRY, error: null });
    mockResults.entry_visualizations = () => ({ data: VIZ_ROWS, error: null });
    const snap = await S.buildSnapshot('e1', '#dc2626');
    expect(snap.visualizations).toHaveLength(1);
    expect(mockCalls.find(c => c.table === 'entries').ops).toContainEqual(['eq', 'id', 'e1']);
    expect(mockCalls.find(c => c.table === 'entry_visualizations').ops).toContainEqual(['eq', 'entry_id', 'e1']);
  });
});

describe('owner share rows', () => {
  test('a duplicate create (another tab) returns the existing link', async () => {
    let n = 0;
    mockResults.shared_entries = (call) => {
      n += 1;
      if (call.ops.some(o => o[0] === 'insert')) return { data: null, error: { code: '23505', message: 'duplicate' } };
      return { data: { token: 't1', snapshot: { v: 1 } }, error: null };
    };
    await expect(S.createShare('e1', 'owner', { v: 1 })).resolves.toEqual({ token: 't1', snapshot: { v: 1 } });
    expect(n).toBe(2);
  });

  test('update writes the new snapshot to the same token', async () => {
    mockResults.shared_entries = () => ({ data: { token: 't1', snapshot: { v: 1, title: 'new' } }, error: null });
    await S.updateShare('t1', { v: 1, title: 'new' });
    const call = mockCalls.find(c => c.table === 'shared_entries');
    expect(call.ops[0][0]).toBe('update');
    expect(call.ops[0][1].snapshot).toEqual({ v: 1, title: 'new' });
    expect(call.ops).toContainEqual(['eq', 'token', 't1']);
  });
});

describe('recipient', () => {
  test('fetchSharedEntry returns null for an unavailable link', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(S.fetchSharedEntry('t')).resolves.toBeNull();
    supabase.rpc.mockResolvedValueOnce({ data: { snapshot: { v: 1 }, isOwner: false, entryId: null }, error: null });
    await expect(S.fetchSharedEntry('t')).resolves.toEqual({ snapshot: { v: 1 }, isOwner: false, entryId: null });
    expect(supabase.rpc).toHaveBeenCalledWith('get_shared_entry', { p_token: 't' });
  });

  test('only images in MedBook\'s own bucket are copied', () => {
    expect(S.isOwnStorageImage(OWN_IMG, SUPA)).toBe(true);
    expect(S.isOwnStorageImage('https://evil.example/x.png', SUPA)).toBe(false);
    expect(S.isOwnStorageImage(`${SUPA}/storage/v1/object/public/other-bucket/x.png`, SUPA)).toBe(false);
  });

  function mockSave() {
    const inserted = {};
    mockResults.entries = (call) => {
      const ins = call.ops.find(o => o[0] === 'insert');
      inserted.entry = ins[1];
      return { data: { id: 'new1', ...ins[1] }, error: null };
    };
    mockResults.entry_visualizations = (call) => { inserted.viz = call.ops.find(o => o[0] === 'insert')[1]; return { error: null }; };
    return inserted;
  }

  test('saves an independent copy: same system, copied images, Key Points, flashcards and diagrams, fresh progress', async () => {
    const inserted = mockSave();
    const snap = S.snapshotFrom(ENTRY, VIZ_ROWS, '#dc2626');
    const res = await S.saveSharedCopy(snap, 'friend', [{ name: 'Cardiology', color: '#111111' }]);

    expect(saveSystems).not.toHaveBeenCalled();
    expect(res.addedSystem).toBe(false);
    expect(res.failedImages).toBe(0);
    expect(res.failedDiagrams).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(OWN_IMG);
    const upload = mockCalls.find(c => c.table === 'storage').ops[0][1];
    expect(upload).toMatch(/^friend\/\d+_[a-z0-9]+\.png$/);

    expect(inserted.entry).toMatchObject({
      user_id: 'friend', system: 'Cardiology', title: 'Digoxin toxicity', notes: '**Bold** notes', difficulty: 'Hard',
      highlights: ENTRY.highlights, pinned: false, review_count: 0, last_reviewed: null,
      ai_sections: { keyPoints: ENTRY.ai_sections.keyPoints, flashcards: ENTRY.ai_sections.flashcards },
    });
    expect(inserted.entry.images).toEqual([expect.stringMatching(/\/entry-images\/friend\//)]);
    expect(inserted.entry.images[0]).not.toBe(OWN_IMG);
    expect(inserted.viz).toEqual([{ entry_id: 'new1', user_id: 'friend', viz_type: 'mind_map', graph_data: MIND_MAP,
      source_content_hash: 'h1', extra_context: null, ai_provider: 'groq', ai_model: 'm' }]);
  });

  test('a missing system is added to the friend\'s list with the sharer\'s colour', async () => {
    mockSave();
    const snap = S.snapshotFrom(ENTRY, [], '#dc2626');
    const res = await S.saveSharedCopy(snap, 'friend', [{ name: 'Surgery', color: '#000000' }]);
    expect(saveSystems).toHaveBeenCalledWith('friend', [{ name: 'Surgery', color: '#000000' }, { name: 'Cardiology', color: '#dc2626', custom: true }]);
    expect(res.addedSystem).toBe(true);
    expect(res.systems.map(s => s.name)).toEqual(['Surgery', 'Cardiology']);
  });

  test('images that can\'t be copied are skipped and counted; the entry still saves', async () => {
    const inserted = mockSave();
    const snap = { ...S.snapshotFrom(ENTRY, [], null), images: [OWN_IMG, 'https://evil.example/x.png', `${SUPA}/storage/v1/object/public/entry-images/owner/gone.jpg`] };
    global.fetch = jest.fn(async (url) => (url.includes('gone') ? { ok: false, status: 404 } : { ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) }));
    const res = await S.saveSharedCopy(snap, 'friend', [{ name: 'Cardiology', color: '#111111' }]);
    expect(res.failedImages).toBe(2);
    expect(inserted.entry.images).toHaveLength(1);
    expect(global.fetch).not.toHaveBeenCalledWith('https://evil.example/x.png');
  });

  test('a diagram insert failure keeps the entry and is reported', async () => {
    mockSave();
    mockResults.entry_visualizations = () => ({ error: { message: 'denied' } });
    const res = await S.saveSharedCopy(S.snapshotFrom(ENTRY, VIZ_ROWS, null), 'friend', [{ name: 'Cardiology' }]);
    expect(res.entry.id).toBe('new1');
    expect(res.failedDiagrams).toBe(1);
  });

  test('a failed entry insert surfaces an error', async () => {
    mockResults.entries = () => ({ data: null, error: { message: 'nope' } });
    await expect(S.saveSharedCopy(S.snapshotFrom(ENTRY, [], null), 'friend', [{ name: 'Cardiology' }])).rejects.toThrow('Save failed: nope');
  });
});
