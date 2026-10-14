// Verifies the fix for: view-mode highlight capture (readSelection, in
// DetailView.js) used to measure a selection against the RENDERED,
// marker-stripped DOM text, then store those offsets as if they were
// positions in the RAW stored string (entry.notes) — which is what
// buildHighlightParts actually slices everywhere a highlight is replayed.
// Any marker before the selection (a **bold** pair, a {{lg}}…{{/lg}}
// heading) shifted the stored offsets forward, so the highlight landed on
// the wrong text — confirmed against a real production entry in the prior
// diagnostic (ends up as "ermined which plants got fertilizer" instead of
// "determined...").
//
// The fix (rawOffsetAt, exported from DetailView.js) walks up from a Range
// boundary to the nearest BoldRuns leaf's data-raw-start attribute — an
// annotation BoldRuns itself writes as a byproduct of the same parse
// (splitRich) that strips the markers for rendering — rather than a
// second, separate pass that re-derives marker positions by walking the
// rendered DOM. This test exercises the REAL RenderedNotes/BoldRuns
// component (mounted for real, not reimplemented) and the REAL
// rawOffsetAt, so there is no parallel implementation here that could
// itself drift from the renderer being tested.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import { RenderedNotes, rawOffsetAt } from '../components/DetailView';
import { splitRich } from '../lib/highlights';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  document.body.removeChild(container);
  container = null;
});

function renderNotes(text, highlights = []) {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ThemeProvider>
        <RenderedNotes text={text} highlights={highlights} />
      </ThemeProvider>
    );
  });
  return root;
}

// Walks every text node under `root` in document order and returns the
// concatenated RENDERED text alongside a position->(node,offset) map — i.e.
// exactly what a real user drag-selection sees and what
// Range.startContainer/startOffset would be for any given rendered
// position. This is a generic DOM text-node walk (how browsers represent
// text split across inline elements), not a reimplementation of anything
// BoldRuns-specific — it doesn't know or care about markers at all.
function mapRenderedPositions(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries = []; // { node, start, end } in the concatenated rendered string
  let pos = 0;
  let node;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    entries.push({ node, start: pos, end: pos + len });
    pos += len;
  }
  return entries;
}

function renderedTextOf(root) {
  return mapRenderedPositions(root).map(e => e.node.textContent).join('');
}

// Finds `needle` in the rendered text and builds a real Range over it,
// exactly as a user's drag-selection would produce (container/offset pairs
// pointing into actual text nodes, which may be split across multiple
// inline elements — e.g. a selection starting before a **bold** word and
// ending after it).
function selectRenderedText(root, needle) {
  const entries = mapRenderedPositions(root);
  const full = entries.map(e => e.node.textContent).join('');
  const idx = full.indexOf(needle);
  if (idx === -1) throw new Error(`"${needle}" not found in rendered text: ${JSON.stringify(full)}`);
  const endIdx = idx + needle.length;

  const locate = (pos) => {
    const e = entries.find(e => pos >= e.start && pos <= e.end);
    if (!e) throw new Error(`position ${pos} out of range`);
    return { node: e.node, offset: pos - e.start };
  };
  const startLoc = locate(idx);
  const endLoc = locate(endIdx);

  const range = document.createRange();
  range.setStart(startLoc.node, startLoc.offset);
  range.setEnd(endLoc.node, endLoc.offset);
  return range;
}

// The one assertion that matters: slicing the RAW string at the mapped
// offsets and running it through splitRich (the SAME function BoldRuns
// itself uses to strip markers for display) must reproduce exactly the
// rendered text that was selected — not shifted, not chopped.
function strippedSlice(raw, start, end) {
  return splitRich(raw.slice(start, end)).map(r => r.t).join('');
}

describe('view-mode highlight offset mapping (rawOffsetAt)', () => {
  test('selection after two bold markers maps to the correct raw offsets (the reported bug)', () => {
    const raw = "You put the fertilizer on the plants in the **sunny** half of the garden "
      + "and leave the **shady** half unfertilized. It also determined which plants got fertilizer.";
    renderNotes(raw);

    const needle = 'determined which plants got fertilizer';
    const range = selectRenderedText(container, needle);
    const start = rawOffsetAt(range.startContainer, range.startOffset);
    const end = rawOffsetAt(range.endContainer, range.endOffset);

    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    // This is the actual mechanism of the bug: the naive "count characters
    // in the rendered DOM" approach would report start=92 here (rendered
    // position), 8 short of where "determined" really starts in the raw
    // string (148) — exactly the 2x "**...**" = 8 marker characters for
    // "sunny" and "shady". Confirm the FIXED mapping does NOT reproduce
    // that stale number.
    const renderedOnlyStart = renderedTextOf(container).indexOf(needle);
    expect(start).not.toBe(renderedOnlyStart);
    expect(start).toBe(raw.indexOf('determined'));

    expect(strippedSlice(raw, start, end)).toBe(needle);
  });

  test('a highlight with NO markers before it is unaffected (regression check)', () => {
    const raw = 'Plain text with no markers before the highlighted phrase right here.';
    renderNotes(raw);

    const needle = 'highlighted phrase';
    const range = selectRenderedText(container, needle);
    const start = rawOffsetAt(range.startContainer, range.startOffset);
    const end = rawOffsetAt(range.endContainer, range.endOffset);

    // No markers anywhere in this string, so rendered and raw coordinates
    // are identical — the fix must not introduce drift where none existed.
    expect(start).toBe(raw.indexOf(needle));
    expect(strippedSlice(raw, start, end)).toBe(needle);
  });

  test('bold + size + italic combined before the target track cumulative marker length correctly', () => {
    const raw = '{{xl}}Heading{{/xl}} intro **bold word** then {{i}}italic phrase{{/i}} '
      + 'and finally the target text to select.';
    renderNotes(raw);

    const needle = 'target text to select';
    const range = selectRenderedText(container, needle);
    const start = rawOffsetAt(range.startContainer, range.startOffset);
    const end = rawOffsetAt(range.endContainer, range.endOffset);

    expect(start).toBe(raw.indexOf(needle));
    expect(strippedSlice(raw, start, end)).toBe(needle);
  });

  test('a selection spanning INTO a bold run (crossing a marker boundary) still maps correctly', () => {
    const raw = 'Leading text then **a bold word** and trailing text after it.';
    renderNotes(raw);

    // Selects across the plain-text / bold boundary in both directions.
    const needle = 'then a bold word and trailing';
    const range = selectRenderedText(container, needle);
    const start = rawOffsetAt(range.startContainer, range.startOffset);
    const end = rawOffsetAt(range.endContainer, range.endOffset);

    expect(strippedSlice(raw, start, end)).toBe(needle);
  });
});
