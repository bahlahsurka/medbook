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
      prefetchSavedTypes: jest.fn(async () => {}),
      generate: jest.fn(), generateMindMap: jest.fn(), recommend: jest.fn(),
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

const SAVED = {
  alpha: [
    { id: 'v1', entryId: 'alpha', vizType: 'mind_map', graphData: { nodes: [{ id: 'a', label: 'Edited root' }], edges: [] },
      originalGraphData: { nodes: [{ id: 'a', label: 'Original root' }], edges: [] }, isEdited: true, updatedAt: '2026-11-21T00:00:00Z' },
    { id: 'v2', entryId: 'alpha', vizType: 'comparison_map', graphData: { subjects: [{ id: 's', label: 'Drug A' }], dimensions: [], cells: [{}] },
      originalGraphData: null, isEdited: false, updatedAt: '2026-11-21T00:00:00Z' },
  ],
  beta: [],
};

const SAVED_TYPES = Object.fromEntries(Object.entries(SAVED).map(([id, list]) => [id, list.map(v => v.vizType)]));

let container, root, warnSpy;
beforeEach(() => {
  window.localStorage.clear();
  mockLoaded.length = 0;
  jest.clearAllMocks();
  VisualizationService.listSaved.mockImplementation(async (id) => SAVED[id] || []);
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
    expect(drawer().textContent).not.toContain('Knowledge Network');   // only saved types offered
    const select = drawer().querySelector('select[aria-label="Diagram format"]');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['mind_map', 'comparison_map']);
    act(() => { select.value = 'comparison_map'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(drawer().textContent).toContain('comparison_map:Drug A');
  } else {
    expect(drawer().textContent).toContain('No saved visualizations yet');
  }
  // No generation controls in review.
  expect(findButton(b => /Generate|Regenerate|Suggest|Edit$|Delete|More actions/.test(b.textContent + (b.getAttribute('aria-label') || '')))).toBeUndefined();

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

test('ReviewQueue: Key Points and Visual Learning never disturb the session or generate anything', async () => {
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
  expect(mockLoaded).toEqual([]); // no visualization code loaded before opening
  expect(VisualizationService.listSaved).not.toHaveBeenCalled(); // no diagram payloads fetched just by reviewing
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
  await openDrawerAndCheck(second, onReviewed);

  expect(onReviewed).toHaveBeenCalledTimes(1);
  expectNoGeneration();
});

test('SystemReview: Key Points and Visual Learning never disturb the session or generate anything', async () => {
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
  expect(mockLoaded).toEqual([]);

  await openDrawerAndCheck(first, onReviewed);

  key('g');
  expect(onReviewed).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain(second.title);

  act(() => { findButton(b => b.textContent.includes('Tap to reveal')).click(); });
  expectKeyPointsFor(second);
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
