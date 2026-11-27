// Phase 6: mounts the real ReviewQueue/SystemReview and exercises Key Points
// + the Visual Learning drawer, asserting the review session is never
// disturbed (same card, still revealed, nothing rated) and that nothing ever
// generates (no /api/visualize, no Groq — only the read-only listSaved).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import ReviewQueue from '../components/ReviewQueue';
import SystemReview from '../components/SystemReview';
import VisualizationService from '../services/visualization';

jest.mock('../lib/supabase', () => {
  const chain = {
    select: () => chain, insert: () => chain, update: () => chain, delete: () => chain, upsert: () => chain,
    eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    single: () => chain, maybeSingle: () => chain, then: (resolve) => resolve({ data: null, error: null }),
  };
  return { supabase: { from: () => chain, rpc: jest.fn().mockResolvedValue({ error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) } } };
});

jest.mock('../services/visualization', () => {
  class VisualizationServiceError extends Error {}
  return {
    __esModule: true,
    VisualizationServiceError,
    default: {
      isConfigured: () => true,
      listSaved: jest.fn(),
      peekSaved: jest.fn(() => undefined),
      getSavedTypes: jest.fn(() => undefined),
      subscribeSaved: jest.fn(() => () => {}),
      getSavedRevision: jest.fn(() => 0),
      prefetchSavedTypes: jest.fn(async () => {}),
      generate: jest.fn(), pendingGenerations: jest.fn(() => []), generateMindMap: jest.fn(), recommend: jest.fn(),
      saveEdit: jest.fn(), restoreOriginal: jest.fn(),
    },
  };
});

// Records which heavy renderer modules get loaded, and when.
const mockLoaded = [];
function mockRenderer(type) {
  mockLoaded.push(type);
  const R = ({ diagram }) => {
    const label = diagram?.nodes?.[0]?.label || diagram?.subjects?.[0]?.label || diagram?.highlights?.[0]?.title || '';
    return <div data-testid="renderer">{`${type}:${label}`}</div>;
  };
  return { __esModule: true, default: R };
}
jest.mock('../components/visualization/MindMapRenderer', () => mockRenderer('mind_map'));
jest.mock('../components/visualization/KnowledgeNetworkRenderer', () => mockRenderer('knowledge_network'));
jest.mock('../components/visualization/ClinicalFlowchartRenderer', () => mockRenderer('clinical_flowchart'));
jest.mock('../components/visualization/MechanismDiagramRenderer', () => mockRenderer('mechanism_diagram'));
jest.mock('../components/visualization/ComparisonMapRenderer', () => mockRenderer('comparison_map'));
jest.mock('../components/visualization/VisualSummaryRenderer', () => mockRenderer('visual_summary'));

global.IS_REACT_ACT_ENVIRONMENT = true;

const NEW_KEY_POINTS = {
  content: { topic: 'Alpha', sections: [{ heading: 'Recognition', bullets: [
    { text: 'Triad: fever, rigidity, confusion', emphasis: 'high_yield', sourceRef: 'x' },
    { text: 'Temperature above 41.1C is an emergency', emphasis: 'red_flag', sourceRef: 'y' },
  ] }] },
  generatedAt: '2026-11-20T10:00:00Z', model: 'm', sourceNotesLength: 999,
  fidelityWarnings: [], fidelityDisclaimer: '',
};

function entry(id, title, aiSections, overdueDays) {
  return {
    id, title, system: 'Cardiology', difficulty: 'Medium', highlights: [], images: [],
    notes: `Detailed notes for ${title}, long enough to have been diagrammed.`,
    ai_sections: aiSections,
    review_interval: 3, ease_factor: 2.5, review_count: 1,
    next_review: new Date(Date.now() - overdueDays * 86400000).toISOString(),
    last_reviewed: new Date(Date.now() - 6 * 86400000).toISOString(),
  };
}
// Alpha: new Key Points AND old fields (must not show both). Beta: legacy only.
const ALPHA = entry('alpha', 'Alpha Entry', { keyPoints: NEW_KEY_POINTS, clinicalPearls: ['Old pearl text'], keyLearningPoints: ['Old learning point'] }, 3);
const BETA = entry('beta', 'Beta Entry', { highYield: ['Legacy high-yield fact'] }, 2);

const BASE_SAVED = {
  alpha: [
    { id: 'v1', entryId: 'alpha', vizType: 'mind_map', graphData: { nodes: [{ id: 'a', label: 'Edited root' }], edges: [] },
      originalGraphData: { nodes: [{ id: 'a', label: 'Original root' }], edges: [] }, isEdited: true, updatedAt: '2026-11-21T00:00:00Z' },
    { id: 'v2', entryId: 'alpha', vizType: 'comparison_map', graphData: { subjects: [{ id: 's', label: 'Drug A' }], dimensions: [], cells: [{}] },
      originalGraphData: null, isEdited: false, updatedAt: '2026-11-21T00:00:00Z' },
  ],
  beta: [],
};

// A tiny in-memory stand-in for the service's saved index: generate() mocks
// call saveDiagram() to record a new diagram and notify subscribers, like
// the real service does after a successful generation.
let SAVED, SAVED_TYPES, revisions, savedListeners;
function resetSaved() {
  SAVED = Object.fromEntries(Object.entries(BASE_SAVED).map(([id, list]) => [id, [...list]]));
  SAVED_TYPES = Object.fromEntries(Object.entries(SAVED).map(([id, list]) => [id, list.map(v => v.vizType)]));
  revisions = {};
  savedListeners = new Set();
}
function saveDiagram(v) {
  SAVED[v.entryId] = [...(SAVED[v.entryId] || []).filter(x => x.vizType !== v.vizType), v];
  SAVED_TYPES[v.entryId] = SAVED[v.entryId].map(x => x.vizType);
  revisions[v.entryId] = (revisions[v.entryId] || 0) + 1;
  savedListeners.forEach(fn => fn());
}
const diagramFor = (entryId, vizType, label, updatedAt = '2026-11-27T00:00:00Z') => ({
  id: `${entryId}-${vizType}`, entryId, vizType, graphData: { nodes: [{ id: 'r', label }], edges: [] },
  originalGraphData: null, isEdited: false, updatedAt,
});

let container, root, warnSpy;
beforeEach(() => {
  window.localStorage.clear();
  mockLoaded.length = 0;
  jest.clearAllMocks();
  resetSaved();
  VisualizationService.listSaved.mockImplementation(async (id) => SAVED[id] || []);
  VisualizationService.subscribeSaved.mockImplementation(fn => { savedListeners.add(fn); return () => savedListeners.delete(fn); });
  VisualizationService.getSavedRevision.mockImplementation(id => revisions[id] || 0);
  VisualizationService.generate.mockReset();
  VisualizationService.pendingGenerations.mockImplementation(() => []);
  // Stable arrays per entry, as the real service returns (useSyncExternalStore requires it).
  VisualizationService.getSavedTypes.mockImplementation(id => SAVED_TYPES[id]);
  global.fetch = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  act(() => { root.unmount(); });
  document.body.removeChild(container);
  warnSpy.mockRestore();
});

const buttons = () => Array.from(document.body.querySelectorAll('button'));
const findButton = (pred) => buttons().find(pred);
const drawer = () => document.body.querySelector('[data-testid="review-visual-learning"]');
const currentEntry = () => (container.textContent.includes('Alpha Entry') ? ALPHA : BETA);
const ratingBarVisible = () => container.textContent.includes('How well did you know this?');
const key = (k, target = document.body) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true }));
});
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

// The latest saved diagram sits on the card above the notes; an entry with
// none loads no diagram code and reads no diagram payloads.
const cardDiagram = () => container.querySelector('[data-testid="review-card-diagram"]');
function expectCardDiagramFor(e) {
  if (e === ALPHA) {
    expect(cardDiagram().textContent).toContain('mind_map:Edited root');
    expect(cardDiagram().textContent).toContain('Mind Map');
    expect(VisualizationService.listSaved).toHaveBeenCalledWith('alpha');
  } else {
    expect(cardDiagram()).toBeNull();
    expect(VisualizationService.listSaved).not.toHaveBeenCalledWith('beta');
  }
}

function expectKeyPointsFor(e) {
  if (e === ALPHA) {
    expect(container.textContent).toContain('Recognition');
    expect(container.textContent).toContain('Triad: fever, rigidity, confusion');
    expect(container.textContent).toContain('Review edited since'); // sourceNotesLength mismatch
    expect(container.textContent).not.toContain('Old pearl text');   // no duplicate legacy summary
    expect(container.textContent).not.toContain('Clinical Pearls');
  } else {
    expect(container.textContent).toContain('Legacy high-yield fact'); // legacy fallback preserved
  }
}

// The persisted resume snapshot(s), minus fields that change with time alone.
function sessionSnapshots() {
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    try {
      const v = JSON.parse(window.localStorage.getItem(k));
      if (v && typeof v === 'object' && 'idx' in v) {
        const { lastActiveAt, elapsedSec, ...stable } = v;
        out[k] = stable;
      }
    } catch { /* not JSON */ }
  }
  return out;
}

async function openDrawerAndCheck(e, onReviewed) {
  const titleBefore = e.title;
  const ratedBefore = onReviewed.mock.calls.length;
  const snapshotBefore = sessionSnapshots();
  // Saved count is shown before opening (from the lightweight prefetch index).
  const trigger = findButton(b => b.textContent.startsWith('Visual Learning'));
  expect(trigger.textContent).toContain(e === ALPHA ? '2 saved' : 'none yet');
  expect(Object.keys(snapshotBefore).length).toBeGreaterThan(0);
  act(() => { findButton(b => b.textContent.startsWith('Visual Learning')).click(); });
  await flush();
  expect(drawer()).toBeTruthy();
  expect(VisualizationService.listSaved).toHaveBeenLastCalledWith(e.id);
  // Focus goes to the drawer panel, never to a button a habitual Enter/Space would click.
  expect(drawer().contains(document.activeElement)).toBe(true);
  expect(document.activeElement.tagName).not.toBe('BUTTON');

  if (e === ALPHA) {
    expect(drawer().textContent).toContain('mind_map:Edited root');    // saved edit wins
    expect(drawer().textContent).not.toContain('Edited by you');      // no provenance badge
    // Every format is offered; saved ones are ticked.
    const select = drawer().querySelector('select[aria-label="Diagram format"]');
    const opts = Array.from(select.options);
    expect(opts).toHaveLength(6);
    expect(opts.filter(o => o.textContent.includes('✓')).map(o => o.value)).toEqual(['mind_map', 'comparison_map']);
    expect(findButton(b => b.textContent.includes('Regenerate'))).toBeTruthy();
    act(() => { select.value = 'comparison_map'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(drawer().textContent).toContain('comparison_map:Drug A');
  } else {
    // Nothing saved yet: the drawer offers generation right here.
    expect(drawer().querySelector('select[aria-label="Diagram format"]').value).toBe('mind_map');
    expect(findButton(b => b.textContent.includes('Generate Mind Map'))).toBeTruthy();
    expect(findButton(b => b.textContent.includes('Suggest the best format'))).toBeTruthy();
  }
  // Editing, deleting and restoring stay on the entry page.
  expect(findButton(b => /✎ Edit|Delete|Restore/.test(b.textContent) || b.getAttribute('aria-label') === 'More actions')).toBeUndefined();

  // Review shortcuts must be inert while the drawer is open.
  key('g'); key('Enter'); key('a'); key('ArrowLeft'); key(' ');
  key('g', drawer());
  expect(onReviewed).toHaveBeenCalledTimes(ratedBefore);
  expect(drawer()).toBeTruthy();
  expect(container.textContent).toContain(titleBefore);
  expect(ratingBarVisible()).toBe(true);

  key('Escape');
  expect(drawer()).toBeNull();
  expect(container.textContent).toContain(titleBefore);
  expect(ratingBarVisible()).toBe(true);
  expect(sessionSnapshots()).toEqual(snapshotBefore); // resume position/progress untouched
}

function expectNoGeneration() {
  expect(VisualizationService.generate).not.toHaveBeenCalled();
  expect(VisualizationService.recommend).not.toHaveBeenCalled();
  expect(VisualizationService.saveEdit).not.toHaveBeenCalled();
  expect(VisualizationService.restoreOriginal).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
}

test('ReviewQueue: Key Points and Visual Learning never disturb the session or generate on their own', async () => {
  const onReviewed = jest.fn();
  act(() => {
    root.render(
      <ThemeProvider>
        <ReviewQueue allEntries={{ Cardiology: [ALPHA, BETA] }} onReviewed={onReviewed}
          userSystems={[{ name: 'Cardiology' }]} initialFilterSystem="Cardiology" userId="test-user" />
      </ThemeProvider>
    );
  });

  const first = currentEntry();
  const second = first === ALPHA ? BETA : ALPHA;
  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  expectKeyPointsFor(first);
  await flush();
  expectCardDiagramFor(first);
  // Only the lightweight saved-types lookup, batched for the queue window.
  expect(VisualizationService.prefetchSavedTypes).toHaveBeenCalled();
  expect(VisualizationService.prefetchSavedTypes.mock.calls[0][0]).toEqual(expect.arrayContaining(['alpha', 'beta']));

  // Collapsing Key Points is purely local.
  const kpToggle = () => findButton(b => b.textContent.startsWith('Key Points'));
  act(() => { kpToggle().click(); });
  expect(kpToggle().getAttribute('aria-expanded')).toBe('false');
  // Collapsed, the header still flags hidden red flags.
  if (first === ALPHA) expect(kpToggle().textContent).toContain('🚩 1');
  expect(ratingBarVisible()).toBe(true);
  act(() => { kpToggle().click(); });
  expect(kpToggle().getAttribute('aria-expanded')).toBe('true');
  expectKeyPointsFor(first);

  await openDrawerAndCheck(first, onReviewed);

  // Shortcuts work again once closed: rating advances to the next card.
  key('g');
  expect(onReviewed).toHaveBeenCalledTimes(1);
  expect(onReviewed.mock.calls[0][0].id).toBe(first.id);
  expect(container.textContent).toContain(second.title);

  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  expectKeyPointsFor(second);
  await flush();
  expectCardDiagramFor(second);
  await openDrawerAndCheck(second, onReviewed);

  expect(onReviewed).toHaveBeenCalledTimes(1);
  expectNoGeneration();
});

test('SystemReview: Key Points and Visual Learning never disturb the session or generate on their own', async () => {
  const onReviewed = jest.fn();
  act(() => {
    root.render(
      <ThemeProvider>
        <SystemReview system="Cardiology" entries={[ALPHA, BETA]} color="#2563eb"
          onReviewed={onReviewed} onClose={() => {}} userId="test-user" />
      </ThemeProvider>
    );
  });

  const first = currentEntry();
  const second = first === ALPHA ? BETA : ALPHA;
  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  expectKeyPointsFor(first);
  await flush();
  expectCardDiagramFor(first);

  await openDrawerAndCheck(first, onReviewed);

  key('g');
  expect(onReviewed).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain(second.title);

  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  expectKeyPointsFor(second);
  await flush();
  expectCardDiagramFor(second);
  await openDrawerAndCheck(second, onReviewed);

  expectNoGeneration();
});

test('"Back to review" returns to the same revealed card, and mouse rating still works afterwards', async () => {
  const onReviewed = jest.fn();
  act(() => {
    root.render(
      <ThemeProvider>
        <SystemReview system="Cardiology" entries={[ALPHA, BETA]} color="#2563eb"
          onReviewed={onReviewed} onClose={() => {}} userId="test-user" />
      </ThemeProvider>
    );
  });
  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  act(() => { findButton(b => b.textContent.startsWith('Visual Learning')).click(); });
  await flush();
  expect(drawer()).toBeTruthy();
  // "Back to review" button returns to the same card.
  act(() => { findButton(b => b.textContent.includes('Back to review')).click(); });
  expect(drawer()).toBeNull();
  expect(ratingBarVisible()).toBe(true);
  // Clicking a rating button (the mouse path) still rates normally afterwards.
  act(() => { findButton(b => b.textContent.startsWith('Good')).click(); });
  expect(onReviewed).toHaveBeenCalledTimes(1);
  expect(drawer()).toBeNull();
});

test('generating from the review drawer: the drawer closes when it finishes and the diagram shows on the card above the notes', async () => {
  const onReviewed = jest.fn();
  VisualizationService.generate.mockImplementation(async (vizType, entryId) => {
    const v = diagramFor(entryId, vizType, 'Generated root');
    saveDiagram(v);
    return { cached: false, stale: false, visualization: v };
  });
  act(() => {
    root.render(
      <ThemeProvider>
        <SystemReview system="Cardiology" entries={[BETA]} color="#2563eb"
          onReviewed={onReviewed} onClose={() => {}} userId="test-user" />
      </ThemeProvider>
    );
  });
  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  await flush();
  expect(cardDiagram()).toBeNull(); // nothing saved yet
  const snapshotBefore = sessionSnapshots();
  act(() => { findButton(b => b.textContent.startsWith('Visual Learning')).click(); });
  await flush();
  expect(VisualizationService.generate).not.toHaveBeenCalled(); // opening alone never generates

  act(() => { findButton(b => b.textContent.includes('Generate Mind Map')).click(); });
  await flush();
  expect(VisualizationService.generate).toHaveBeenCalledTimes(1);
  expect(VisualizationService.generate).toHaveBeenCalledWith('mind_map', 'beta', { regenerate: false });
  // Drawer closed by itself; the new diagram is on the card, above the notes.
  expect(drawer()).toBeNull();
  expect(cardDiagram().textContent).toContain('mind_map:Generated root');
  const card = cardDiagram().parentElement;
  expect(card.textContent.indexOf('mind_map:Generated root')).toBeLessThan(card.textContent.indexOf('Detailed notes for Beta Entry'));
  expect(ratingBarVisible()).toBe(true);
  expect(onReviewed).not.toHaveBeenCalled();
  expect(sessionSnapshots()).toEqual(snapshotBefore);

  // Collapse hides it on this card only.
  act(() => { findButton(b => b.textContent.includes('Collapse')).click(); });
  expect(cardDiagram().textContent).not.toContain('mind_map:Generated root');
  act(() => { findButton(b => b.textContent.includes('Expand')).click(); });
  expect(cardDiagram().textContent).toContain('mind_map:Generated root');

  // Regenerate from the drawer also closes it and updates the card.
  VisualizationService.generate.mockImplementation(async (vizType, entryId) => {
    const v = diagramFor(entryId, vizType, 'Regenerated root', '2026-11-27T01:00:00Z');
    saveDiagram(v);
    return { cached: false, stale: false, visualization: v };
  });
  act(() => { findButton(b => b.textContent.startsWith('Visual Learning')).click(); });
  await flush();
  expect(findButton(b => /✎ Edit/.test(b.textContent))).toBeUndefined();
  act(() => { findButton(b => b.textContent.includes('Regenerate')).click(); });
  await flush();
  expect(VisualizationService.generate).toHaveBeenLastCalledWith('mind_map', 'beta', { regenerate: true });
  expect(drawer()).toBeNull();
  expect(cardDiagram().textContent).toContain('mind_map:Regenerated root');
  expect(onReviewed).not.toHaveBeenCalled();
});

test('the card shows the most recent of several saved diagrams', async () => {
  SAVED.alpha = [...SAVED.alpha, diagramFor('alpha', 'knowledge_network', 'Newest network', '2026-11-25T00:00:00Z')];
  SAVED_TYPES.alpha = SAVED.alpha.map(v => v.vizType);
  act(() => {
    root.render(
      <ThemeProvider>
        <SystemReview system="Cardiology" entries={[ALPHA]} color="#2563eb"
          onReviewed={jest.fn()} onClose={() => {}} userId="test-user" />
      </ThemeProvider>
    );
  });
  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  await flush();
  expect(cardDiagram().textContent).toContain('knowledge_network:Newest network');
  expect(cardDiagram().textContent).toContain('Knowledge Network');
  expect(cardDiagram().textContent).not.toContain('mind_map:');
});

test('re-opening the drawer while a generation started earlier is still running shows its progress; it closes when that finishes', async () => {
  let finish;
  const promise = new Promise(r => { finish = r; });
  VisualizationService.pendingGenerations.mockImplementation(id => (id === 'beta' ? [{ vizType: 'knowledge_network', promise, startedAt: Date.now() }] : []));
  act(() => {
    root.render(
      <ThemeProvider>
        <SystemReview system="Cardiology" entries={[BETA]} color="#2563eb"
          onReviewed={jest.fn()} onClose={() => {}} userId="test-user" />
      </ThemeProvider>
    );
  });
  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  act(() => { findButton(b => b.textContent.startsWith('Visual Learning')).click(); });
  await flush();
  expect(drawer().querySelector('select[aria-label="Diagram format"]').value).toBe('knowledge_network');
  expect(drawer().textContent).toMatch(/Generating…|Still working/);
  expect(VisualizationService.generate).not.toHaveBeenCalled();
  VisualizationService.pendingGenerations.mockImplementation(() => []);
  const v = diagramFor('beta', 'knowledge_network', 'Net root');
  await act(async () => { saveDiagram(v); finish({ cached: false, visualization: v }); });
  await flush();
  expect(drawer()).toBeNull();
  expect(cardDiagram().textContent).toContain('knowledge_network:Net root');
});
