// Renders text containing rich-paste markers (bold/italic/size — see
// lib/bulletList.js and lib/highlights.js's splitRich) as real inline
// elements: <strong>/<em>/a resized <span>. The ONE implementation of this,
// shared by every place a note's text is displayed — DetailView.js (both
// its view-mode render and, via rawStart, its highlight-offset mapping),
// ReviewQueue.js, SystemReview.js, and EntryCard.js's list-preview snippet
// — so none of them can quietly drift from how the others render the exact
// same marker syntax.
//
// Bold and a lg/xl size bump up to the theme's full-contrast text colour
// (surrounding note text is often a dimmer theme colour) — on a small base
// font, bold/bigger text in that SAME dim colour barely reads as different
// at all; sm (fine print) stays the surrounding colour, since it's meant to
// read smaller, not louder.
//
// `highlights`, if given, renders highlight colour bands TOGETHER with
// marker formatting via buildFormattedParts — never by slicing `text` at
// highlight boundaries before calling this component (the bug that used to
// cause a highlight landing inside a **bold** run to either drop that run's
// own bold styling or "leak" it onto adjacent, unrelated text — see
// buildFormattedParts' own comment in lib/highlights.js for the mechanism).
// Every RenderedNotes caller passes the FULL note text plus its highlights
// array here, not a pre-sliced fragment. `isDark` resolves each highlight's
// colour the same way (resolveHL) — only meaningful alongside `highlights`.
//
// `rawStart` is this text's own offset into the full RAW stored string
// (markers included) — 0 for every current caller now that none of them
// pre-slice `text` any more, kept only so a future caller that genuinely
// does pass a fragment still gets correct data-raw-start values. Every run
// gets a data-raw-start attribute carrying its absolute raw offset; only
// DetailView.js's view-mode highlight capture (readSelection/rawOffsetAt)
// actually reads it back, to translate a selection made in the rendered,
// marker-stripped DOM into the same raw-string coordinates storage and
// every other render already use. Harmless, and free, for every other
// caller that never queries it.
import { useTheme } from './theme';
import { splitRich, buildFormattedParts, resolveHL, RICH_SIZE_STYLE } from './highlights';

export default function RichRuns({ text, rawStart = 0, highlights, isDark }) {
  const { t } = useTheme();
  const runs = (highlights && highlights.length)
    ? buildFormattedParts(text, highlights)
    : splitRich(text).map(r => ({ ...r, hl: null }));
  return runs.map((r, j) => {
    let el = r.t;
    if (r.bold) el = <strong style={{ color: t.text }}>{el}</strong>;
    if (r.italic) el = <em>{el}</em>;
    if (r.size) {
      const strong = r.size === 'lg' || r.size === 'xl';
      el = <span style={{ ...RICH_SIZE_STYLE[r.size], color: strong ? t.text : undefined }}>{el}</span>;
    }
    if (r.hl) {
      const c = resolveHL(r.hl, isDark);
      el = <mark style={{ background: c.bg, color: c.text, borderRadius: 2, padding: '0 2px' }}>{el}</mark>;
    }
    return <span key={j} data-raw-start={rawStart + r.start}>{el}</span>;
  });
}
