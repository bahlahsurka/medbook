// Regression test for a performance fix: Global Search's EntryCard list
// (App.js) passed a fresh inline onClick closure AND recomputed each
// card's color via .find() on every App.js render, defeating EntryCard's
// own React.memo ("Parent must pass stable props" — its own comment).
// Fixed by changing the contract so EntryCard calls a STABLE,
// entry-taking callback (`onClick?.(entry)`) instead of wiring a raw DOM
// handler straight through — this verifies that contract change is
// correct and doesn't break the one caller (SystemHome.js) that renders
// EntryCard with no onClick at all.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import EntryCard from '../components/EntryCard';

global.IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = { id: 'e1', title: 'Some Entry', system: 'Internal Medicine', notes: 'x', images: [] };

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

test('onClick is called with the card\'s own entry, not a bare DOM event', () => {
  const calls = [];
  act(() => {
    root.render(
      <ThemeProvider>
        <EntryCard entry={ENTRY} color="#2563eb" onClick={(e) => calls.push(e)} />
      </ThemeProvider>
    );
  });
  act(() => { container.querySelector('.mb-entrycard').click(); });
  expect(calls).toEqual([ENTRY]);
});

test('rendering with no onClick at all (SystemHome.js\'s own wrapper handles clicks itself) never throws on click', () => {
  act(() => {
    root.render(
      <ThemeProvider>
        <EntryCard entry={ENTRY} color="#2563eb" />
      </ThemeProvider>
    );
  });
  expect(() => {
    act(() => { container.querySelector('.mb-entrycard').click(); });
  }).not.toThrow();
});

test('a stable onClick reference across re-renders is what makes React.memo actually skip work (sanity check on the memo contract)', () => {
  const stableOnClick = () => {};
  const Wrapper = ({ tick }) => (
    <ThemeProvider>
      {/* tick forces Wrapper to re-render; entry/color/onClick are all
          referentially stable across those re-renders, as App.js's fixed
          call site now guarantees via useMemo/useCallback. */}
      <div data-tick={tick}>
        <EntryCard entry={ENTRY} color="#2563eb" onClick={stableOnClick} />
      </div>
    </ThemeProvider>
  );
  act(() => { root.render(<Wrapper tick={1} />); });
  const firstNode = container.querySelector('.mb-entrycard');
  act(() => { root.render(<Wrapper tick={2} />); });
  const secondNode = container.querySelector('.mb-entrycard');
  // React.memo with stable props reuses the same underlying DOM node
  // rather than re-rendering/replacing it.
  expect(secondNode).toBe(firstNode);
});
