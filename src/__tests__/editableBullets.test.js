import { handleBulletKeyDown, toggleBulletLines, handleRichPaste, inlineTextWithMarks } from '../lib/bulletList';

beforeAll(() => {
  document.execCommand = (cmd, ui, value) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    if (cmd === 'insertText') {
      const node = document.createTextNode(value);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
    } else if (cmd === 'insertHTML') {
      const tpl = document.createElement('template');
      tpl.innerHTML = value;
      const frag = tpl.content;
      const lastNode = frag.lastChild;
      range.insertNode(frag);
      if (lastNode) { range.setStartAfter(lastNode); range.collapse(true); }
    } else {
      return false;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  };
});

function makeEditable(initialText) {
  const div = document.createElement('div');
  div.setAttribute('contenteditable', 'true');
  document.body.appendChild(div);
  div.textContent = initialText;
  return div;
}
function setCaretAtEnd(div) {
  const textNode = div.lastChild;
  const range = document.createRange();
  range.setStart(textNode, textNode.textContent.length);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}
function fireKey(div, key, opts = {}) {
  const e = { key, shiftKey: !!opts.shiftKey, currentTarget: div, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  handleBulletKeyDown(e);
  return e;
}

test('Enter continues a bullet', () => {
  const div = makeEditable('• first item');
  setCaretAtEnd(div);
  const e = fireKey(div, 'Enter');
  expect(e.defaultPrevented).toBe(true);
  expect(inlineTextWithMarks(div)).toBe('• first item\n• ');
});

test('Enter on an empty bullet exits the list', () => {
  const div = makeEditable('• first\n• ');
  setCaretAtEnd(div);
  fireKey(div, 'Enter');
  expect(inlineTextWithMarks(div)).toBe('• first\n\n');
});

test('Enter on a plain line inserts a literal newline', () => {
  const div = makeEditable('just some text');
  setCaretAtEnd(div);
  const e = fireKey(div, 'Enter');
  expect(e.defaultPrevented).toBe(true);
  expect(inlineTextWithMarks(div)).toBe('just some text\n');
});

test('Tab indents a bullet line', () => {
  const div = makeEditable('• item');
  setCaretAtEnd(div);
  fireKey(div, 'Tab');
  expect(inlineTextWithMarks(div)).toBe('  • item');
});

test('Shift+Tab outdents an already-indented bullet', () => {
  const div = makeEditable('  • item');
  setCaretAtEnd(div);
  fireKey(div, 'Tab', { shiftKey: true });
  expect(inlineTextWithMarks(div)).toBe('• item');
});

test('toggleBulletLines adds a bullet to a plain line', () => {
  const div = makeEditable('plain line');
  const range = document.createRange();
  range.selectNodeContents(div);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  toggleBulletLines(div);
  expect(inlineTextWithMarks(div)).toBe('• plain line');
});

test('toggleBulletLines strips a bullet from an already-bulleted line', () => {
  const div = makeEditable('• already bulleted');
  const range = document.createRange();
  range.selectNodeContents(div);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  toggleBulletLines(div);
  expect(inlineTextWithMarks(div)).toBe('already bulleted');
});

test('rich paste (HTML clipboard) inserts real formatted DOM, not literal markers', () => {
  const div = makeEditable('');
  const range = document.createRange();
  range.selectNodeContents(div);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  const e = {
    clipboardData: { getData: (type) => type === 'text/html' ? '<p>Hello <strong>world</strong></p>' : '' },
    currentTarget: div, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
  };
  handleRichPaste(e, '#111827');
  expect(inlineTextWithMarks(div).trim()).toBe('Hello **world**');
  expect(div.querySelector('strong')).not.toBeNull();
});
