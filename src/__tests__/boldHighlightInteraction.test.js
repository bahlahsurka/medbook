// Regression test for: highlighting text that starts or ends PARTWAY
// THROUGH a **bold** (or italic/sized) run used to corrupt that run —
// losing its bold styling entirely, or "leaking" bold onto adjacent,
// unrelated text, or losing the space between two now-adjacent words —
// and could leave literal, unconverted "**" characters visible in the
// rendered text. Two compounding root causes, both fixed here:
//
//   1. The old buildHighlightParts sliced the raw marker string at
//      highlight boundaries FIRST, then parsed markers within each
//      resulting slice independently — so a highlight boundary landing
//      inside a bold run split its opening and closing "**" tokens into
//      two slices that never saw each other. Fixed by buildFormattedParts
//      (lib/highlights.js), which parses markers across the FULL text
//      once, then slices each resulting run — never the other way around.
//   2. wrapMarks (lib/bulletList.js) used to .trim() a bold/italic/sized
//      element's own text when re-serializing the DOM back to a marker
//      string — fine when such an element's edges never legitimately held
//      a real space, but buildFormattedParts' fix means a highlight
//      boundary can now split one bold run into two adjacent <strong>
//      elements, one of which legitimately starts or ends with a real,
//      meaningful space. Trimming it there silently ate the space between
//      two words the next time that run was serialized. Fixed by
//      collapsing internal whitespace runs (still needed for messy pasted
//      HTML) without trimming the edges.
//
// This exercises the real useHighlight.applyHL path (the exact code
// AddEntry.js/DetailView.js's edit mode uses), mounted for real, same as
// editableHighlight.test.js.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useHighlight } from '../lib/useHighlight';
import { inlineTextWithMarks } from '../lib/bulletList';
import { splitRich } from '../lib/highlights';
import { ThemeProvider } from '../lib/theme';
import { RenderedNotes } from '../components/DetailView';

// A highlight boundary falling inside a bold run legitimately re-serializes
// as two ADJACENT "**...**" pairs (one per resulting <strong> element)
// rather than one merged pair — e.g. "**bold ****word**" instead of
// "**bold word**". That's harmless noise, not corruption: splitRich reads
// adjacent "**" tokens as independent toggles (off then immediately back
// on), so the two pieces parse back as one continuous bold run either way.
// This checks ACTUAL bold coverage after a real splitRich parse, rather
// than demanding one exact, human-looking marker string — which is what
// the raw text is free not to be.
function strippedAndBold(raw) {
  const runs = splitRich(raw);
  return { text: runs.map(r => r.t).join(''), bold: runs.filter(r => r.bold).map(r => r.t).join('') };
}

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
  const a = findPos(editable, start);
  const b = findPos(editable, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

function Harness({ apiRef, initialHtml }) {
  const rootRef = React.useRef(null);
  const theme = { textColor: '#111827', isDark: false };
  const hl = useHighlight(rootRef, [], theme);
  apiRef.current = { hl, rootRef };
  return (
    <div ref={rootRef} contentEditable suppressContentEditableWarning
      dangerouslySetInnerHTML={{ __html: initialHtml }} />
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

function mount(initialHtml) {
  const apiRef = { current: null };
  const root = createRoot(container);
  act(() => { root.render(<Harness apiRef={apiRef} initialHtml={initialHtml} />); });
  return apiRef;
}

test('highlighting from inside a bold run out into trailing plain text keeps the bold boundary intact', async () => {
  // Rendered (marker-stripped) text: "Hello bold word there today."
  const apiRef = mount('Hello <strong>bold word</strong> there today.');
  const editable = apiRef.current.rootRef.current;

  // Select "word there" — starts inside the bold run, ends in plain text.
  const rendered = editable.textContent;
  const start = rendered.indexOf('word there');
  const end = start + 'word there'.length;
  selectRange(editable, start, end);

  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#fef08a', text: '#713f12', label: 'Yellow' });
    await new Promise(r => setTimeout(r, 50));
  });

  // No stray, unconverted marker characters anywhere in the rendered text.
  expect(editable.textContent).not.toMatch(/\*\*/);
  // Full text content reconstructs exactly, with every original space intact.
  expect(editable.textContent).toBe('Hello bold word there today.');

  // The bold run's OWN boundary is still exactly "bold word" — not shrunk
  // (losing "word"'s bold styling) and not grown onto "there"/"today". A
  // highlight boundary falling partway through it legitimately splits it
  // into adjacent <strong> elements (CSS-equivalent to one merged tag) —
  // what matters is their concatenated text, not the element count.
  const strongs = editable.querySelectorAll('strong');
  const boldText = Array.from(strongs).map(s => s.textContent).join('');
  expect(boldText).toBe('bold word');

  // The highlight itself still covers exactly "word there" — "word" inside
  // the mark AND still bold, "there" inside the mark but plain.
  const marks = editable.querySelectorAll('mark');
  expect(marks.length).toBeGreaterThanOrEqual(1);
  const highlightedText = Array.from(marks).map(m => m.textContent).join('');
  expect(highlightedText).toBe('word there');
  expect(Array.from(marks).some(m => m.querySelector('strong'))).toBe(true);

  // The raw marker string round-trips losslessly — re-parsing it reproduces
  // the exact plain text AND the exact bold coverage (never a dangling,
  // unconverted "**" left over from a slice that never saw its partner).
  const raw = inlineTextWithMarks(editable);
  const parsed = strippedAndBold(raw);
  expect(parsed.text).toBe('Hello bold word there today.');
  expect(parsed.bold).toBe('bold word');
});

test('highlighting from leading plain text in through the start of a bold run keeps it intact', async () => {
  const apiRef = mount('Leading text then <strong>a bold word</strong> and trailing text.');
  const editable = apiRef.current.rootRef.current;

  const rendered = editable.textContent;
  const start = rendered.indexOf('then a bold');
  const end = start + 'then a bold'.length;
  selectRange(editable, start, end);

  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#bbf7d0', text: '#14532d', label: 'Green' });
    await new Promise(r => setTimeout(r, 50));
  });

  expect(editable.textContent).not.toMatch(/\*\*/);
  expect(editable.textContent).toBe('Leading text then a bold word and trailing text.');

  // Same reasoning as the first test — the highlight boundary falls inside
  // the bold run ("a") so it legitimately splits into adjacent <strong>
  // elements; their concatenated text is what must stay intact.
  const strongs = editable.querySelectorAll('strong');
  const boldText = Array.from(strongs).map(s => s.textContent).join('');
  expect(boldText).toBe('a bold word');

  const raw = inlineTextWithMarks(editable);
  const parsed = strippedAndBold(raw);
  expect(parsed.text).toBe('Leading text then a bold word and trailing text.');
  expect(parsed.bold).toBe('a bold word');
});

test('a highlight entirely INSIDE a bold run (both edges inside it) preserves the full bold run', async () => {
  const apiRef = mount('Some <strong>very important point</strong> to remember.');
  const editable = apiRef.current.rootRef.current;

  const rendered = editable.textContent;
  const start = rendered.indexOf('important');
  const end = start + 'important'.length;
  selectRange(editable, start, end);

  await act(async () => {
    apiRef.current.hl.applyHL({ bg: '#bfdbfe', text: '#1e3a8a', label: 'Blue' });
    await new Promise(r => setTimeout(r, 50));
  });

  expect(editable.textContent).not.toMatch(/\*\*/);
  expect(editable.textContent).toBe('Some very important point to remember.');

  // "very important point" as a whole must STILL be entirely bold — not
  // just the highlighted middle word, and not losing the bold run's edges.
  const strongs = editable.querySelectorAll('strong');
  const boldText = Array.from(strongs).map(s => s.textContent).join('');
  expect(boldText).toBe('very important point');

  const raw = inlineTextWithMarks(editable);
  const parsed = strippedAndBold(raw);
  expect(parsed.text).toBe('Some very important point to remember.');
  expect(parsed.bold).toBe('very important point');
});

// The same bug's OTHER half: read-only view-mode rendering (ReviewQueue.js/
// SystemReview.js/DetailView.js's RenderedNotes, all now sharing RichRuns'
// buildFormattedParts path) for an entry.highlights range already saved
// against a raw marker string, where the range cuts through a bold run.
describe('view-mode rendering of a stored highlight that cuts through a bold run', () => {
  function renderNotes(text, highlights) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        <ThemeProvider>
          <RenderedNotes text={text} highlights={highlights} />
        </ThemeProvider>
      );
    });
    return el;
  }

  test('a saved highlight starting inside a bold run keeps the run intact and visible asterisk-free', () => {
    const raw = 'Hello **bold word** there today.';
    // "word there" — raw.indexOf('word') is inside the bold run, end is
    // in the plain text after it.
    const start = raw.indexOf('word');
    const end = raw.indexOf(' today') ; // up to and including "there"
    const el = renderNotes(raw, [{ start, end, color: { bg: '#fef08a', text: '#713f12', label: 'Yellow' } }]);

    expect(el.textContent).not.toMatch(/\*\*/);
    expect(el.textContent).toBe('Hello bold word there today.');

    const strongs = el.querySelectorAll('strong');
    const boldText = Array.from(strongs).map(s => s.textContent).join('');
    expect(boldText).toBe('bold word');

    const marks = el.querySelectorAll('mark');
    const highlightedText = Array.from(marks).map(m => m.textContent).join('');
    expect(highlightedText).toBe('word there');

    document.body.removeChild(el);
  });

  test('a saved highlight entirely inside a bold run does not bleed bold onto trailing text', () => {
    const raw = 'Some **very important point** to remember.';
    const start = raw.indexOf('important');
    const end = start + 'important'.length;
    const el = renderNotes(raw, [{ start, end, color: { bg: '#bfdbfe', text: '#1e3a8a', label: 'Blue' } }]);

    expect(el.textContent).not.toMatch(/\*\*/);
    expect(el.textContent).toBe('Some very important point to remember.');

    // The whole original bold phrase must still read bold — in particular
    // "point" (after the highlight) must NOT have incorrectly become bold
    // (the "bleeds onto adjacent text" failure mode of the old per-slice
    // splitRich calls), and "to remember." must NOT be bold at all.
    const strongs = el.querySelectorAll('strong');
    const boldText = Array.from(strongs).map(s => s.textContent).join('');
    expect(boldText).toBe('very important point');
    expect(el.textContent.endsWith('to remember.')).toBe(true);
    const trailingPlain = el.textContent.slice(el.textContent.indexOf('to remember.'));
    expect(trailingPlain).toBe('to remember.');

    document.body.removeChild(el);
  });
});
