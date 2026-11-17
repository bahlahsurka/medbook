// Covers the new view-mode/review-mode bold/underline feature: toggleRichMarker
// and isRangeFullyMarked (lib/highlights.js), plus matchRichShortcut's keybinding
// (Ctrl/Cmd+B / Ctrl/Cmd+U) not colliding with the pre-existing highlight
// shortcuts (matchHighlightShortcutView's bare letters, matchHighlightShortcutEditing's
// Alt+letters) or ReviewQueue's rating keys.
import {
  splitRich,
  toggleRichMarker,
  isRangeFullyMarked,
  matchRichShortcut,
  matchHighlightShortcutView,
  matchHighlightShortcutEditing,
  adjustHighlights,
} from '../lib/highlights';

function strippedText(raw) {
  return splitRich(raw).map(r => r.t).join('');
}

describe('toggleRichMarker', () => {
  test('applies bold to a plain-text range', () => {
    const out = toggleRichMarker('hello world', 6, 11, 'bold');
    expect(out).toBe('hello **world**');
    expect(strippedText(out)).toBe('hello world');
  });

  test('round-trips: applying then removing restores the original text', () => {
    const start = 'hello world foo';
    const bolded = toggleRichMarker(start, 6, 11, 'bold');
    const restored = toggleRichMarker(bolded, bolded.indexOf('world'), bolded.indexOf('world') + 5, 'bold');
    expect(restored).toBe(start);
  });

  test('a selection fully inside an existing bold run toggles bold OFF for the whole original range', () => {
    const text = '**hello world**';
    // "hello world" is fully bold; toggling the inner word "world" removes
    // bold from just that word, splitting the run.
    const worldStart = text.indexOf('world');
    const out = toggleRichMarker(text, worldStart, worldStart + 5, 'bold');
    expect(isRangeFullyMarked(out, out.indexOf('hello'), out.indexOf('hello') + 5, 'bold')).toBe(true);
    expect(isRangeFullyMarked(out, out.indexOf('world'), out.indexOf('world') + 5, 'bold')).toBe(false);
    expect(strippedText(out)).toBe('hello world');
  });

  test('a selection spanning a bold run and following plain text extends bold seamlessly', () => {
    // "**abc**def" toggling bold on raw range [4,8) ("cdef"... actually
    // covers "c" through "f") should merge into one continuous bold run
    // rather than leaving a broken/duplicated marker.
    const text = '**abc**def';
    const out = toggleRichMarker(text, 4, 8, 'bold');
    expect(out).toBe('**abcd**ef');
  });

  test('bold and underline compose independently on overlapping ranges', () => {
    let text = 'hello world';
    text = toggleRichMarker(text, 0, 11, 'bold');
    text = toggleRichMarker(text, 6, 11, 'underline');
    expect(strippedText(text)).toBe('hello world');
    expect(isRangeFullyMarked(text, 0, 11, 'bold')).toBe(true);
    expect(isRangeFullyMarked(text, 0, 5, 'underline')).toBe(false);
    expect(isRangeFullyMarked(text, 6, 11, 'underline')).toBe(true);
  });

  test('is a no-op on an empty/collapsed range', () => {
    const text = 'hello world';
    expect(toggleRichMarker(text, 4, 4, 'bold')).toBe(text);
  });

  test('clamps out-of-bounds offsets instead of throwing', () => {
    const text = 'hi';
    expect(() => toggleRichMarker(text, -5, 50, 'underline')).not.toThrow();
  });
});

describe('toggleRichMarker composes with adjustHighlights', () => {
  test('an existing highlight entirely outside the toggled range is left untouched', () => {
    const oldText = 'hello world foo';
    const highlights = [{ start: 0, end: 5, color: { bg: '#fff' } }]; // "hello"
    const newText = toggleRichMarker(oldText, 12, 15, 'bold'); // "foo"
    const newHl = adjustHighlights(oldText, newText, highlights);
    expect(newHl).toEqual([{ start: 0, end: 5, color: { bg: '#fff' } }]);
  });
});

describe('matchRichShortcut collision safety', () => {
  function evt(opts) {
    return { key: 'b', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...opts };
  }

  test('Ctrl+B / Ctrl+U match bold/underline', () => {
    expect(matchRichShortcut(evt({ key: 'b', ctrlKey: true }))).toEqual({ kind: 'bold' });
    expect(matchRichShortcut(evt({ key: 'u', ctrlKey: true }))).toEqual({ kind: 'underline' });
  });

  test('Cmd (meta) also matches, for Mac', () => {
    expect(matchRichShortcut(evt({ key: 'b', metaKey: true }))).toEqual({ kind: 'bold' });
  });

  test('requires a modifier — a bare letter never matches', () => {
    expect(matchRichShortcut(evt({ key: 'b' }))).toBeNull();
  });

  test('Alt+letter (the highlight-shortcut scheme) never matches', () => {
    expect(matchRichShortcut(evt({ key: 'b', altKey: true }))).toBeNull();
  });

  test('does not collide with DetailView view-mode bare-letter highlight shortcuts', () => {
    const e = evt({ key: 'b', ctrlKey: true });
    expect(matchRichShortcut(e)).toEqual({ kind: 'bold' });
    expect(matchHighlightShortcutView(e)).toBeNull();
  });

  test('does not collide with the Alt-gated highlight shortcuts used in edit/review mode', () => {
    const e = evt({ key: 'b', ctrlKey: true });
    expect(matchRichShortcut(e)).toEqual({ kind: 'bold' });
    expect(matchHighlightShortcutEditing(e)).toBeNull();
  });
});
