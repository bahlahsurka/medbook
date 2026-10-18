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
// `rawStart` is this text's own offset into the full RAW stored string
// (markers included) — the enclosing buildHighlightParts slice's `start`,
// or 0 for a caller that doesn't track that (most of them). Every run gets
// a data-raw-start attribute carrying its absolute raw offset; only
// DetailView.js's view-mode highlight capture (readSelection/rawOffsetAt)
// actually reads it back, to translate a selection made in the rendered,
// marker-stripped DOM into the same raw-string coordinates storage and
// every other render already use. Harmless, and free, for every other
// caller that never queries it.
import { useTheme } from './theme';
import { splitRich, RICH_SIZE_STYLE } from './highlights';

export default function RichRuns({ text, rawStart = 0 }) {
  const { t } = useTheme();
  return splitRich(text).map((r, j) => {
    let el = r.t;
    if (r.bold) el = <strong style={{ color: t.text }}>{el}</strong>;
    if (r.italic) el = <em>{el}</em>;
    if (r.size) {
      const strong = r.size === 'lg' || r.size === 'xl';
      el = <span style={{ ...RICH_SIZE_STYLE[r.size], color: strong ? t.text : undefined }}>{el}</span>;
    }
    return <span key={j} data-raw-start={rawStart + r.start}>{el}</span>;
  });
}
