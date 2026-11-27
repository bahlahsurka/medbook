// Saved diagrams belong to the entry: opening the entry page shows them
// straight away (read-only table read, never /api/visualize or Groq), they
// are labelled as saved to the entry, and they only go away via a confirmed
// Delete.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import VisualLearningPanel from '../components/visualization/VisualLearningPanel';
import VisualizationService from '../services/visualization';

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
      deleteSaved: jest.fn(async () => {}),
      generate: jest.fn(), pendingGenerations: jest.fn(() => []), generateMindMap: jest.fn(), recommend: jest.fn(),
      saveEdit: jest.fn(), restoreOriginal: jest.fn(),
    },
  };
});

jest.mock('../components/visualization/MindMapRenderer', () => ({
  __esModule: true,
  default: ({ diagram }) => <div data-testid="renderer">{`mind_map:${diagram?.nodes?.[0]?.label || ''}`}</div>,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_MIND_MAP = {
  id: 'v1', entryId: 'e1', vizType: 'mind_map',
  graphData: { nodes: [{ id: 'a', label: 'Serotonin syndrome' }], edges: [] },
  originalGraphData: null, isEdited: false, aiModel: 'openai/gpt-oss-20b', updatedAt: '2026-11-21T00:00:00Z',
};

let container, root;
beforeEach(() => {
  jest.clearAllMocks();
  VisualizationService.pendingGenerations.mockImplementation(() => []);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  document.body.removeChild(container);
});

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
async function mount() {
  await act(async () => {
    root.render(<ThemeProvider><VisualLearningPanel entryId="e1" notes="Some notes" /></ThemeProvider>);
  });
  await flush();
}
const button = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text) || b.getAttribute('aria-label') === text);
async function openDelete() {
  await act(async () => { button('More actions').click(); });
  await act(async () => { button('Delete').click(); });
}

test('opening the entry shows its saved mind map without generating anything', async () => {
  VisualizationService.listSaved.mockResolvedValue([SAVED_MIND_MAP]);
  await mount();
  expect(VisualizationService.listSaved).toHaveBeenCalledWith('e1');
  expect(container.querySelector('[data-testid="renderer"]').textContent).toBe('mind_map:Serotonin syndrome');
  expect(container.textContent).toContain('Saved · 21 Nov 2026');
  expect(container.textContent).not.toMatch(/cache/i);
  expect(VisualizationService.generate).not.toHaveBeenCalled();
  expect(global.fetch === undefined || !global.fetch.mock || global.fetch.mock.calls.length === 0).toBe(true);
});

test('an entry with nothing saved still offers Generate', async () => {
  VisualizationService.listSaved.mockResolvedValue([]);
  await mount();
  expect(container.querySelector('[data-testid="renderer"]')).toBeNull();
  expect(VisualizationService.generate).not.toHaveBeenCalled();
});

test('a failed saved-diagram read in the entry page is silent and leaves Generate available', async () => {
  VisualizationService.listSaved.mockRejectedValue(new Error('offline'));
  await mount();
  expect(container.textContent).not.toContain('offline');
  expect(button('Generate Mind Map')).toBeTruthy();
});

test('no extra helper text, model name or long disclaimer; format is a dropdown', async () => {
  VisualizationService.listSaved.mockResolvedValue([SAVED_MIND_MAP]);
  await mount();
  const text = container.textContent;
  expect(text).not.toMatch(/never changed|Preview|structural validation|additional medical context/i);
  expect(text).not.toContain(SAVED_MIND_MAP.aiModel);
  expect(container.querySelector('select[aria-label="Diagram format"]').value).toBe('mind_map');
  expect(button('About this diagram')).toBeFalsy();                 // no AI caveat tooltip
  expect(text).not.toMatch(/double-check|may not be shown|Edited by you|medical accuracy/i);
});

test('collapsible top mode starts expanded and can collapse', async () => {
  VisualizationService.listSaved.mockResolvedValue([SAVED_MIND_MAP]);
  const onHas = jest.fn();
  await act(async () => {
    root.render(<ThemeProvider><VisualLearningPanel entryId="e1" notes="Some notes" collapsible onHasDiagramChange={onHas} /></ThemeProvider>);
  });
  await flush();
  expect(onHas).toHaveBeenLastCalledWith(true);
  expect(container.querySelector('[data-testid="renderer"]')).not.toBeNull();
  await act(async () => { button('Collapse').click(); });
  expect(container.querySelector('[data-testid="renderer"]')).toBeNull();
  await act(async () => { button('Expand').click(); });
  expect(container.querySelector('[data-testid="renderer"]')).not.toBeNull();
});

test('Delete asks for confirmation and only then removes the saved diagram', async () => {
  VisualizationService.listSaved.mockResolvedValue([SAVED_MIND_MAP]);
  await mount();
  await openDelete();
  expect(VisualizationService.deleteSaved).not.toHaveBeenCalled();
  expect(container.textContent).toContain("This can't be undone");

  await act(async () => { button('Cancel').click(); });
  expect(container.querySelector('[data-testid="renderer"]')).not.toBeNull();

  await openDelete();
  await act(async () => { button('Yes, delete').click(); });
  await flush();
  expect(VisualizationService.deleteSaved).toHaveBeenCalledWith('mind_map', 'e1');
  expect(container.querySelector('[data-testid="renderer"]')).toBeNull();
});

test('a failed delete keeps the diagram and shows the error', async () => {
  VisualizationService.listSaved.mockResolvedValue([SAVED_MIND_MAP]);
  VisualizationService.deleteSaved.mockRejectedValueOnce(new Error('nope'));
  await mount();
  await openDelete();
  await act(async () => { button('Yes, delete').click(); });
  await flush();
  expect(container.querySelector('[data-testid="renderer"]')).not.toBeNull();
  expect(container.textContent).toContain('Something went wrong deleting this diagram.');
});
