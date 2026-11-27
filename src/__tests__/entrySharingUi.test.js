// Share dialog (owner) and shared-entry preview (recipient).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';

jest.mock('../lib/entrySharing', () => {
  const actual = jest.requireActual('../lib/entrySharing');
  return {
    ...actual,
    buildSnapshot: jest.fn(), getShare: jest.fn(), createShare: jest.fn(), updateShare: jest.fn(),
    fetchSharedEntry: jest.fn(), saveSharedCopy: jest.fn(),
  };
});
const Sharing = require('../lib/entrySharing');
const ShareEntryDialog = require('../components/ShareEntryDialog').default;
const SharedEntryModal = require('../components/SharedEntryModal').default;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => {}) } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (el) => act(() => { root.render(<ThemeProvider>{el}</ThemeProvider>); });
async function flush() { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); }
const button = (label) => Array.from(document.body.querySelectorAll('button')).find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SNAP = { v: 1, title: 'Digoxin toxicity', notes: 'Yellow vision and **arrhythmias**.', difficulty: 'Hard', system: 'Cardiology',
  systemColor: '#dc2626', highlights: [], images: [], keyPoints: null, flashcards: [], visualizations: [] };

describe('ShareEntryDialog (owner)', () => {
  test('creates the link on open and copies it; no extra text', async () => {
    Sharing.getShare.mockResolvedValue(null);
    Sharing.buildSnapshot.mockResolvedValue(SNAP);
    Sharing.createShare.mockResolvedValue({ token: TOKEN, snapshot: SNAP });
    render(<ShareEntryDialog entryId="e1" entryTitle="Digoxin toxicity" userId="owner" color="#dc2626" onClose={() => {}} />);
    await flush();
    expect(Sharing.createShare).toHaveBeenCalledWith('e1', 'owner', SNAP);
    const input = document.body.querySelector('input[aria-label="Share link"]');
    expect(input.value).toBe(`${window.location.origin}/s/${TOKEN}`);
    expect(button('Update shared copy')).toBeUndefined();
    await act(async () => { button('Copy link').click(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(input.value);
    expect(button('Copied')).toBeTruthy();
    const dialogText = document.body.querySelector('[aria-label="Share entry"]').textContent;
    expect(dialogText).not.toMatch(/anyone|disclaimer|expire|privacy|note:/i);
  });

  test('reuses an existing link; offers "Update shared copy" only when the entry changed', async () => {
    Sharing.getShare.mockResolvedValue({ token: TOKEN, snapshot: { ...SNAP, notes: 'old' } });
    Sharing.buildSnapshot.mockResolvedValue(SNAP);
    Sharing.updateShare.mockResolvedValue({ token: TOKEN, snapshot: SNAP });
    render(<ShareEntryDialog entryId="e1" userId="owner" onClose={() => {}} />);
    await flush();
    expect(Sharing.createShare).not.toHaveBeenCalled();
    await act(async () => { button('Update shared copy').click(); });
    await flush();
    expect(Sharing.updateShare).toHaveBeenCalledWith(TOKEN, SNAP);
    expect(document.body.querySelector('input[aria-label="Share link"]').value).toContain(TOKEN); // same link
  });

  test('an unchanged entry shows no update button (key order doesn\'t matter)', async () => {
    const reordered = Object.fromEntries(Object.entries(SNAP).reverse());
    Sharing.getShare.mockResolvedValue({ token: TOKEN, snapshot: reordered });
    Sharing.buildSnapshot.mockResolvedValue(SNAP);
    render(<ShareEntryDialog entryId="e1" userId="owner" onClose={() => {}} />);
    await flush();
    expect(button('Update shared copy')).toBeUndefined();
  });

  test('Escape closes', async () => {
    Sharing.getShare.mockResolvedValue({ token: TOKEN, snapshot: SNAP });
    Sharing.buildSnapshot.mockResolvedValue(SNAP);
    const onClose = jest.fn();
    render(<ShareEntryDialog entryId="e1" userId="owner" onClose={onClose} />);
    await flush();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SharedEntryModal (recipient)', () => {
  test('previews the entry and saves a copy', async () => {
    Sharing.fetchSharedEntry.mockResolvedValue({ snapshot: SNAP, isOwner: false, entryId: null });
    const result = { entry: { id: 'new1', system: 'Cardiology' }, systems: [], addedSystem: false, failedImages: 0, failedDiagrams: 0 };
    Sharing.saveSharedCopy.mockResolvedValue(result);
    const onSaved = jest.fn();
    const systems = [{ name: 'Cardiology', color: '#111' }];
    render(<SharedEntryModal token={TOKEN} userId="friend" userSystems={systems} onClose={() => {}} onOpenOwn={() => {}} onSaved={onSaved} />);
    await flush();
    const text = document.body.textContent;
    expect(text).toContain('Digoxin toxicity');
    expect(text).toContain('Cardiology');
    expect(text).toContain('arrhythmias');
    expect(text).not.toContain('**');
    await act(async () => { button('Save to my MedBook').click(); });
    await flush();
    expect(Sharing.saveSharedCopy).toHaveBeenCalledWith(SNAP, 'friend', systems);
    expect(onSaved).toHaveBeenCalledWith(result);
  });

  test('a link to your own entry opens it instead', async () => {
    Sharing.fetchSharedEntry.mockResolvedValue({ snapshot: SNAP, isOwner: true, entryId: 'e1' });
    const onOpenOwn = jest.fn();
    render(<SharedEntryModal token={TOKEN} userId="owner" userSystems={[]} onClose={() => {}} onOpenOwn={onOpenOwn} onSaved={() => {}} />);
    await flush();
    expect(onOpenOwn).toHaveBeenCalledWith('e1');
    expect(button('Save to my MedBook')).toBeUndefined();
  });

  test('an unavailable link says so; a failed save shows the error and allows retry', async () => {
    Sharing.fetchSharedEntry.mockResolvedValueOnce(null);
    render(<SharedEntryModal token={TOKEN} userId="f" userSystems={[]} onClose={() => {}} onOpenOwn={() => {}} onSaved={() => {}} />);
    await flush();
    expect(document.body.textContent).toContain('This link isn\'t available.');
    act(() => root.unmount());
    root = createRoot(container);

    Sharing.fetchSharedEntry.mockResolvedValueOnce({ snapshot: SNAP, isOwner: false });
    Sharing.saveSharedCopy.mockRejectedValueOnce(new Error('Save failed: offline'));
    render(<SharedEntryModal token={TOKEN} userId="f" userSystems={[]} onClose={() => {}} onOpenOwn={() => {}} onSaved={() => {}} />);
    await flush();
    await act(async () => { button('Save to my MedBook').click(); });
    await flush();
    expect(document.body.textContent).toContain('Save failed: offline');
    expect(button('Save to my MedBook').disabled).toBe(false);
  });
});
