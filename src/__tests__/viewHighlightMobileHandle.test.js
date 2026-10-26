// Regression test for: "can't highlight the last line" reported on Android
// Chrome, using double-tap a word (selects it) then dragging the native OS
// selection HANDLE to extend it further — the common way to extend a
// selection onward to the end of a paragraph on mobile.
//
// Root cause: the floating-popover's rect AND the static toolbar's
// selection state were both updated together inside one `sync()`, gated on
// `pointerDown.current` ("while the user is still dragging, don't pop the
// bar up under their finger"). pointerDown is set true by a touchstart and
// cleared by a matching touchend. A drag-selection HANDLE is browser-chrome
// UI, not a page element — dragging it frequently never fires a matching
// touchend back to the page's `document` listener, so pointerDown stays
// stuck true for the rest of that interaction. With selRange gated the
// same way, the toolbar then never recognized the extended selection at
// all, reading as "I can't highlight this" — most noticeable extending
// onto an entry's LAST line, the natural end point of that gesture.
//
// Fixed by never gating selRange (what the static toolbar's "Apply:"
// state is driven by) on pointerDown — only selRect (the floating
// popover's position, where briefly avoiding a jump mid-press is purely
// cosmetic) stays gated.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import DetailView from '../components/DetailView';

global.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom doesn't implement Range.getBoundingClientRect — readSelection()
// needs a non-zero rect to accept a selection as real.
if (!Range.prototype.getBoundingClientRect) {
  // eslint-disable-next-line no-extend-native
  Range.prototype.getBoundingClientRect = function () {
    return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 };
  };
}

const ENTRY = {
  id: 'e1',
  title: 'Test Entry',
  system: 'Internal Medicine',
  difficulty: 'Medium',
  created_at: new Date().toISOString(),
  pinned: false,
  images: [],
  highlights: [],
  notes: 'First line of the review. Second line here. '
    + 'The last line of this entry ends right here.',
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

function mount() {
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
        />
      </ThemeProvider>
    );
  });
}

function clickHighlightToggle() {
  const btn = Array.from(container.querySelectorAll('button'))
    .find(b => b.textContent.trim() === 'Highlight');
  act(() => { btn.click(); });
}

function toolbarText() {
  return container.textContent;
}

function selectLastLine() {
  const notesEl = container.querySelector('[data-selectable="true"]');
  const walker = document.createTreeWalker(notesEl, NodeFilter.SHOW_TEXT);
  let node, lastNode = null;
  while ((node = walker.nextNode())) {
    if (node.textContent.includes('last line')) lastNode = node;
  }
  const idx = lastNode.textContent.indexOf('last line');
  const range = document.createRange();
  range.setStart(lastNode, idx);
  range.setEnd(lastNode, lastNode.textContent.length);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

test('a selection made while pointerDown is stuck true (native handle-drag) still reaches the static toolbar', () => {
  mount();
  clickHighlightToggle();

  // Simulate the native selection-handle drag: a touchstart lands on the
  // page (from the initial double-tap), but the handle-drag's own touchend
  // never reaches `document` — pointerDown.current is left stuck true.
  act(() => {
    document.dispatchEvent(new Event('touchstart'));
  });

  // The handle drag extends the selection onto the last line. This fires
  // 'selectionchange' the same way a real OS-driven handle-drag does.
  act(() => {
    selectLastLine();
    document.dispatchEvent(new Event('selectionchange'));
  });

  // Even with pointerDown still stuck true, the static toolbar must
  // recognize the real selection — this is the actual guarantee the fix
  // provides (the floating popover's position is allowed to lag; the
  // static toolbar must not).
  expect(toolbarText()).toContain('Apply:');
  expect(toolbarText()).not.toContain('Select text:');
});

test('the floating popover still stays hidden while pointerDown is true — the fix only decouples selRange, not all gating', () => {
  mount();
  clickHighlightToggle();

  act(() => { document.dispatchEvent(new Event('touchstart')); });
  act(() => {
    selectLastLine();
    document.dispatchEvent(new Event('selectionchange'));
  });

  // The static toolbar recognizes the selection (the actual bug fix)...
  expect(toolbarText()).toContain('Apply:');
  // ...but the floating popover (selRect-driven) is still deliberately
  // withheld while a press/drag is still active — that gating is
  // intentional UX (don't pop it up under the user's finger) and the fix
  // must not remove it wholesale.
  expect(container.querySelector('[role="toolbar"][aria-label="Highlight selection"]')).toBeNull();

  // Releasing the press (a normal touchend/mouseup, not the stuck-handle
  // case) lets the popover appear, confirming selRect still works at all.
  act(() => { document.dispatchEvent(new Event('touchend')); });
  expect(container.querySelector('[role="toolbar"][aria-label="Highlight selection"]')).not.toBeNull();
});
