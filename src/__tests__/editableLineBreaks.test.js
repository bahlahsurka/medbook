// Regression test for a real-browser-only bug: real Chrome/Safari do NOT
// insert a literal "\n" character for Enter in a contentEditable, even
// via execCommand('insertText', false, '\n') — they wrap each new line in
// its own <div> (an empty line becomes <div><br></div>). This was only
// caught by testing against an actual browser (Playwright/real Chromium);
// jsdom has no execCommand implementation at all, so a jsdom-mocked one
// (see editableBullets.test.js) that literally inserts the given string
// cannot by itself reproduce or catch this — these tests instead build the
// exact DOM shape a real browser produces directly, independent of any
// execCommand mock, and check the parser understands it.
import { inlineTextWithMarks, locateInMarkedText, domPositionAt } from '../lib/bulletList';

function el(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

test('a sequence of <div>-wrapped lines (real Chrome/Safari Enter behavior) serializes with newlines', () => {
  // Mirrors exactly what Chrome produced in real-browser testing for:
  // "Plain line one" [Enter] "• bullet item" [Enter] "second bullet item"
  // [Enter] [Enter] "Hello **bold** paragraph."
  const root = el(
    'Plain line one' +
    '<div>• bullet item</div>' +
    '<div>second bullet item</div>' +
    '<div><br></div>' +
    '<div>Hello <strong>bold</strong> paragraph.</div>'
  );
  expect(inlineTextWithMarks(root)).toBe(
    'Plain line one\n• bullet item\nsecond bullet item\n\nHello **bold** paragraph.'
  );
});

test('an empty line (<div><br></div>) contributes exactly ONE blank line, not two', () => {
  const root = el('first<div>second</div><div><br></div><div>third</div>');
  const text = inlineTextWithMarks(root);
  expect(text).toBe('first\nsecond\n\nthird');
  // Specifically: splitting on "\n" should show exactly one empty entry
  // for the blank line, not two (which a naive "both the div boundary AND
  // its inner <br> count as a newline" implementation would produce).
  expect(text.split('\n')).toEqual(['first', 'second', '', 'third']);
});

test('locateInMarkedText finds a position inside a <div>-wrapped line correctly', () => {
  const root = el('first<div>second line</div>');
  const divTextNode = root.querySelector('div').firstChild;
  // caret after "sec" inside "second line"
  const pos = locateInMarkedText(root, divTextNode, 3);
  expect(pos).toBe('first\nsec'.length);
});

test('domPositionAt is the exact inverse of locateInMarkedText across a <div> boundary', () => {
  const root = el('first<div>second line</div><div>third</div>');
  const text = inlineTextWithMarks(root);
  const target = text.indexOf('third'); // start of the third line
  const { node, offset } = domPositionAt(root, target);
  // Round-trip: locating that exact DOM position should give back the same offset.
  expect(locateInMarkedText(root, node, offset)).toBe(target);
  expect(node.textContent.slice(offset)).toBe('third');
});

test('a bullet line inside a <div> is still recognized as a bullet (BULLET_RE match via serialization)', () => {
  // This is what made bullet-continuation silently stop working in real
  // Chrome before the fix: the second bullet line is wrapped in its own
  // <div>, and the serializer has to understand that to see it as a line
  // starting with "• " at all.
  const root = el('• first<div>• second</div>');
  const text = inlineTextWithMarks(root);
  expect(text).toBe('• first\n• second');
});
