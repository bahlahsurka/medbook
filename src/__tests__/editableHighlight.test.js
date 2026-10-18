import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useHighlight } from '../lib/useHighlight';
import { inlineTextWithMarks, locateInMarkedText } from '../lib/bulletList';

global.IS_REACT_ACT_ENVIRONMENT = true;

function findPos(root, offset) {
  let acc = 0;
  function walk(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const len = child.textContent.length;
        if (acc + len >= offset) return { node: child, offset: offset - acc };
        acc += len;
      } else {
        const r = walk(child);
        if (r) return r;
      }
    }
    return null;
  }
  return walk(root) || { node: root, offset: root.childNodes.length };
}

function selectRange(editable, start, end) {
  const text = inlineTextWithMarks(editable);
  const a = findPos(editable, start);
  const b = findPos(editable, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  return text;
}

function Harness({ apiRef }) {
  const rootRef = React.useRef(null);
  const theme = { textColor: '#111827', isDark: false };
  const hl = useHighlight(rootRef, [], theme);
  apiRef.current = { hl, rootRef };
  return (
    <div ref={rootRef} contentEditable suppressContentEditableWarning>
      Hello world, this is a test sentence.
    </div>
  );
}

let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.removeChild(container);
  container = null;
});

test('applyHL creates a real <mark> and tracks correct raw offsets', async () => {
  const apiRef = { current: null };
  const root = createRoot(container);
  act(() => { root.render(<Harness apiRef={apiRef} />); });

  const editable = apiRef.current.rootRef.current;
  selectRange(editable, 6, 11); // "world"

  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#fef08a', text: '#713f12', label: 'Yellow' });
    await new Promise(r => setTimeout(r, 50));
  });

  const marks = editable.querySelectorAll('mark');
  expect(marks.length).toBe(1);
  expect(marks[0].textContent).toBe('world');
  expect(apiRef.current.hl.highlights).toEqual([{ start: 6, end: 11, color: { bg: '#fef08a', text: '#713f12', label: 'Yellow' } }]);
  expect(inlineTextWithMarks(editable)).toBe('Hello world, this is a test sentence.');

  // caret restored right after the highlighted text
  const sel = window.getSelection();
  const r = sel.getRangeAt(0);
  expect(locateInMarkedText(editable, r.startContainer, r.startOffset)).toBe(11);
});

test('a second applyHL adds a second <mark> without disturbing the first', async () => {
  const apiRef = { current: null };
  const root = createRoot(container);
  act(() => { root.render(<Harness apiRef={apiRef} />); });

  const editable = apiRef.current.rootRef.current;
  selectRange(editable, 6, 11); // "world"
  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#fef08a', text: '#713f12', label: 'Yellow' });
    await new Promise(r => setTimeout(r, 50));
  });

  const text = inlineTextWithMarks(editable);
  const idx = text.indexOf('test sentence');
  selectRange(editable, idx, idx + 'test sentence'.length);
  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#bbf7d0', text: '#14532d', label: 'Green' });
    await new Promise(r => setTimeout(r, 50));
  });

  const marks = editable.querySelectorAll('mark');
  expect(marks.length).toBe(2);
  expect(apiRef.current.hl.highlights.length).toBe(2);
});

test('removeHL clears exactly the selected highlight, leaving the other intact', async () => {
  const apiRef = { current: null };
  const root = createRoot(container);
  act(() => { root.render(<Harness apiRef={apiRef} />); });

  const editable = apiRef.current.rootRef.current;
  selectRange(editable, 6, 11); // "world"
  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#fef08a', text: '#713f12', label: 'Yellow' });
    await new Promise(r => setTimeout(r, 50));
  });
  const text = inlineTextWithMarks(editable);
  const idx = text.indexOf('test sentence');
  selectRange(editable, idx, idx + 'test sentence'.length);
  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#bbf7d0', text: '#14532d', label: 'Green' });
    await new Promise(r => setTimeout(r, 50));
  });

  selectRange(editable, 6, 11); // "world" again
  await act(async () => {
    apiRef.current.hl.removeHL();
    await new Promise(r => setTimeout(r, 50));
  });

  const marks = editable.querySelectorAll('mark');
  expect(marks.length).toBe(1);
  expect(marks[0].textContent).toBe('test sentence');
  expect(apiRef.current.hl.highlights.length).toBe(1);
});
