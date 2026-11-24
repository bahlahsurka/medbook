// Universal text zoom: steps, persistence, CSS variable, account sync, and
// the top-bar control.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ZoomControl from '../components/ZoomControl';
import * as sharedZoom from '../lib/uiZoom';
import { ThemeProvider } from '../lib/theme';

const mockUpdateUser = jest.fn(async () => ({ data: {}, error: null }));
let mockSession = { user: { id: 'u1' } };
jest.mock('../lib/supabase', () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    updateUser: (...args) => mockUpdateUser(...args),
  } },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

let zoomLib;
function load() {
  jest.isolateModules(() => { zoomLib = require('../lib/uiZoom'); });
}
const cssZoom = () => document.documentElement.style.getPropertyValue('--mb-zoom');

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  document.documentElement.style.removeProperty('--mb-zoom');
  mockUpdateUser.mockClear();
  mockSession = { user: { id: 'u1' } };
  load();
});
afterEach(() => { jest.useRealTimers(); });

async function flushSync() {
  await act(async () => { jest.advanceTimersByTime(700); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test('starts at 100% and steps through 90–150%, clamped at both ends', () => {
  expect(zoomLib.getZoom()).toBe(1);
  expect(cssZoom()).toBe('1');
  zoomLib.zoomOut(); expect(zoomLib.getZoom()).toBe(0.9);
  zoomLib.zoomOut(); expect(zoomLib.getZoom()).toBe(0.9);
  for (let i = 0; i < 10; i++) zoomLib.zoomIn();
  expect(zoomLib.getZoom()).toBe(1.5);
  expect(cssZoom()).toBe('1.5');
  zoomLib.resetZoom(); expect(zoomLib.getZoom()).toBe(1);
});

test('snaps odd values to the nearest step and ignores junk', () => {
  expect(zoomLib.normalizeZoom(1.3)).toBe(1.25);
  expect(zoomLib.normalizeZoom('1.42')).toBe(1.4);
  expect(zoomLib.normalizeZoom(5)).toBe(1.5);
  expect(zoomLib.normalizeZoom('abc')).toBe(1);
  expect(zoomLib.normalizeZoom(null)).toBe(1);
});

test('remembers the choice on the device and restores it on the next load', () => {
  zoomLib.setZoom(1.25);
  expect(window.localStorage.getItem('medbook_ui_zoom')).toBe('1.25');
  load();
  expect(zoomLib.getZoom()).toBe(1.25);
  expect(cssZoom()).toBe('1.25');
});

test('saves to the account once (debounced) after changes', async () => {
  zoomLib.zoomIn(); zoomLib.zoomIn(); zoomLib.zoomIn();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  await flushSync();
  expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  expect(mockUpdateUser).toHaveBeenCalledWith({ data: { ui_zoom: 1.4 } }); // 100 → 110 → 125 → 140
});

test('does not try to save to an account when signed out', async () => {
  mockSession = null;
  zoomLib.zoomIn();
  await flushSync();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(zoomLib.getZoom()).toBe(1.1);
});

test("adopts the account's saved zoom on sign-in; no saved value keeps the device's", () => {
  zoomLib.syncZoomFromUser({ user_metadata: { ui_zoom: 1.4 } });
  expect(zoomLib.getZoom()).toBe(1.4);
  expect(cssZoom()).toBe('1.4');
  zoomLib.syncZoomFromUser({ user_metadata: {} });
  expect(zoomLib.getZoom()).toBe(1.4);
  zoomLib.syncZoomFromUser(null);
  expect(zoomLib.getZoom()).toBe(1.4);
});

test('a change not yet sent is not overwritten by the older account value', async () => {
  zoomLib.zoomIn(); // 1.1, pending
  zoomLib.syncZoomFromUser({ user_metadata: { ui_zoom: 0.9 } });
  expect(zoomLib.getZoom()).toBe(1.1);
  await flushSync();
  expect(mockUpdateUser).toHaveBeenCalledWith({ data: { ui_zoom: 1.1 } });
});

describe('ZoomControl', () => {
  let container, root;
  beforeEach(() => {
    zoomLib = sharedZoom; // the instance the component itself uses
    act(() => { zoomLib.resetZoom(); });
    jest.advanceTimersByTime(700);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<ThemeProvider><ZoomControl /></ThemeProvider>); });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const btn = (label) => container.querySelector(`button[aria-label="${label}"]`)
    || [...container.querySelectorAll('button')].find(b => b.textContent.includes(label));

  test('opens a panel and changes the size with − / + / Reset', () => {
    act(() => { btn('Text size (100%)').click(); });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(btn('Reset to 100%').disabled).toBe(true);
    act(() => { btn('Larger text').click(); });
    expect(zoomLib.getZoom()).toBe(1.1);
    expect(container.textContent).toContain('110%');
    act(() => { btn('Smaller text').click(); });
    act(() => { btn('Smaller text').click(); });
    expect(zoomLib.getZoom()).toBe(0.9);
    expect(btn('Smaller text').disabled).toBe(true);
    act(() => { btn('Reset to 100%').click(); });
    expect(zoomLib.getZoom()).toBe(1);
  });

  test('closes on Escape and on an outside click', () => {
    act(() => { btn('Text size (100%)').click(); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => { btn('Text size (100%)').click(); });
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test('the top-bar button shows the current % when not 100%', () => {
    act(() => { zoomLib.setZoom(1.25); });
    expect(btn('Text size (125%)').textContent).toContain('125%');
  });
});
