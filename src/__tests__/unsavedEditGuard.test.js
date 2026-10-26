// Regression test for: editing an existing entry and navigating away via
// the sidebar (or any other App.js-level navigation) silently discarded
// every unsaved change with zero warning — the sidebar stays rendered and
// clickable the whole time DetailView is in edit mode, and nothing tracked
// whether there was anything unsaved to lose.
//
// AddEntry.js already auto-persists a brand-new entry's draft to
// localStorage on every change (verified directly in its own source before
// writing this fix — see DRAFT_KEY/saveDraft), so navigating away from an
// in-progress NEW entry never actually loses it; this gap was specific to
// editing an EXISTING entry, which has no such persistence.
//
// Fix: DetailView reports its own dirty state up via `onDirtyChange`, and
// App.js's `navigate`/`switchView`/`backToList` — the few functions every
// navigation trigger (sidebar included) already routes through — confirm
// before proceeding if there's something unsaved.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import DetailView from '../components/DetailView';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = {
  id: 'e1',
  title: 'Original Title',
  system: 'Internal Medicine',
  difficulty: 'Medium',
  created_at: new Date().toISOString(),
  pinned: false,
  images: [],
  highlights: [],
  notes: 'Original notes.',
};

let container, root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  document.body.removeChild(container);
  container = null;
});

function mount(onDirtyChange) {
  act(() => {
    root.render(
      <ThemeProvider>
        <DetailView
          entry={ENTRY}
          onBack={() => {}}
          onDeleted={() => {}}
          onUpdated={() => {}}
          userId="test-user"
          onPrev={() => {}}
          onNext={() => {}}
          hasPrev={false}
          hasNext={false}
          onDirtyChange={onDirtyChange}
        />
      </ThemeProvider>
    );
  });
}

function clickByLabel(label) {
  const btn = Array.from(container.querySelectorAll('button'))
    .find(b => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  act(() => { btn.click(); });
  return btn;
}

test('entering edit mode and changing the title reports dirty; Cancel clears it', () => {
  const calls = [];
  mount(v => calls.push(v));

  clickByLabel('Edit entry');
  expect(calls.at(-1)).toBe(false); // opening edit with no changes yet isn't dirty

  const titleInput = container.querySelector('input');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(titleInput, 'Changed Title');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(calls.at(-1)).toBe(true);

  clickByLabel('Cancel');
  expect(calls.at(-1)).toBe(false);
});

test('unmounting mid-edit (e.g. navigating to a different entry) clears the dirty flag', () => {
  const calls = [];
  mount(v => calls.push(v));

  clickByLabel('Edit entry');
  const titleInput = container.querySelector('input');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(titleInput, 'Changed Title');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(calls.at(-1)).toBe(true);

  act(() => { root.unmount(); });
  expect(calls.at(-1)).toBe(false);
});

test('a beforeunload listener is armed only while there are real unsaved changes', () => {
  mount(() => {});

  const addSpy = jest.spyOn(window, 'addEventListener');
  clickByLabel('Edit entry');
  const titleInput = container.querySelector('input');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(titleInput, 'Changed Title');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(addSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
  addSpy.mockRestore();
});
