// components/ImportedDecks/CardRenderer.js
//
// Phase J + J1 — renders ImportedCard -> CardType -> {Basic,Cloze,
// ImageOcclusion}Renderer, inside a sandboxed iframe.
//
// ── SECURITY (Phase J1) ─────────────────────────────────────────────────
// Imported HTML/CSS is untrusted external content. The iframe below is
// given NO sandbox tokens at all — no allow-scripts, no allow-same-origin,
// no allow-forms, no allow-top-navigation, nothing. An empty `sandbox`
// attribute is the browser's maximally-restrictive mode: the frame gets an
// opaque origin, cannot run any JavaScript at all, cannot read/write
// cookies or storage, cannot navigate the parent, cannot submit forms out.
// That satisfies "imported card JavaScript should NOT execute by default"
// as literally as possible, and makes the allow-scripts+allow-same-origin
// combination the spec warns against a non-issue — neither is ever granted.
//
// The tradeoff this forces (documented, not hidden): a real Anki card's
// own JS (rare, but exists — e.g. some custom "type answer" plugins, or
// dynamic image-occlusion reveal scripts) will NOT run. Cloze/image-
// occlusion reveal is instead handled by the PARENT React component,
// which computes the question-state and answer-state HTML strings itself
// (see templateRender.js) and swaps the iframe's srcDoc between them —
// no code exec inside the frame is needed for the core study flow this
// deck actually uses (Basic / Cloze / Image Occlusion Enhanced, per the
// parser POC). If a future deck genuinely needs in-card script execution,
// that requires deliberately widening this boundary with real review, not
// a default.
//
// Height (J2's "predictable viewport"): without allow-scripts the iframe
// can't postMessage its own content height back to the parent for
// auto-resize. Rather than fake it, the card gets a bounded, responsive
// height with its OWN internal scroll (overflow-y auto in the injected
// reset CSS) — a tall card scrolls within its box instead of the page
// needing dynamic resize logic that would require script access.

import { useMemo, useRef, useState, useEffect } from 'react';
import { renderTemplate, renderCloze, substituteMedia, extractMediaFilenames, extractImageSrcs } from '../../lib/importedDecks/templateRender';

const RESET_CSS = `
  html,body{margin:0;padding:0;}
  html{height:100%;}
  body{
    /* min-height (not height) + flex column: lets the single .mb-card-inner
       child below be vertically centered via its own auto margins. */
    min-height:100%; display:flex; flex-direction:column;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
  }
  /* Vertical centering lives on this ONE wrapper (auto top/bottom margins),
     not on body as a flex container of every top-level node — that would
     also make each node a flex item and stretch/shrink-wrap it, which
     quietly breaks two things: an image's default cross-axis stretch would
     blow it up to the full card width regardless of its own size, and a
     shrink-wrapped text node loses the full-width box a deck's own
     text-align:center needs to have any visible effect. Auto-margin
     centering on a single full-width child avoids both, and, unlike
     justify-content:center on body itself, never clips a tall card's
     top: on overflow the auto margins simply resolve to 0 instead of
     pushing the box above the viewport. Short cards (a single line of
     text, one image) end up centered in the space the study screen
     actually gives them, instead of pinned to the top with a dead gap
     above the rating buttons. */
  .mb-card-inner{
    margin:auto 0; padding:16px; box-sizing:border-box;
    overflow-wrap:break-word; word-break:break-word;
  }
  img{max-width:100%;height:auto;}
  .cloze-blank{font-weight:700;color:#2563eb;border-bottom:2px solid #2563eb;padding:0 2px;}
  .cloze-reveal{font-weight:700;color:#16a34a;background:#f0fdf4;padding:0 3px;border-radius:3px;}
  .media-missing{display:inline-block;background:#f3f4f6;color:#9ca3af;border:1px dashed #d1d5db;
    border-radius:6px;padding:6px 10px;font-size:12px;font-family:sans-serif;}
`;

function wrapDocument(bodyHtml, deckCss) {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${RESET_CSS}</style>` +
    `<style>${deckCss || ''}</style>` +
    `</head><body class="card"><div class="mb-card-inner">${bodyHtml}</div></body></html>`;
}

/**
 * Builds { question, answer } HTML for one card, per its model's type.
 * Pure — no DOM, so it's testable and reusable outside the iframe wrapper.
 */
export function buildCardHtml({ card, note, model, resolvedMedia = {} }) {
  const fields = Object.fromEntries((model.field_names || []).map((name, i) => [name, note.fields[i] || '']));
  const tmpl = model.templates?.[0] || { qfmt: '', afmt: '' };

  if (model.is_cloze) {
    // Cloze: mask/reveal happens on the Text field BEFORE template
    // substitution — {{cloze:Text}} in the template then just drops in
    // whichever version was built.
    const questionFields = { ...fields, Text: renderCloze(fields.Text, card.template_ord, false) };
    const answerFields   = { ...fields, Text: renderCloze(fields.Text, card.template_ord, true) };
    return {
      question: substituteMedia(renderTemplate(tmpl.qfmt, questionFields), resolvedMedia),
      answer: substituteMedia(renderTemplate(tmpl.afmt.replace('{{FrontSide}}', renderTemplate(tmpl.qfmt, questionFields)), answerFields), resolvedMedia),
    };
  }

  // Basic and Image Occlusion Enhanced both reduce to plain template
  // substitution — IOE's occlusion rectangles are already baked into its
  // Question Mask / Answer Mask field HTML by Anki's own IOE add-on at
  // note-creation time, so no separate occlusion-metadata parsing is
  // needed here; {{Question Mask}} / {{Answer Mask}} substitute exactly
  // like any other field. (If the real Tzanki export turns out to encode
  // occlusion differently, this is the one function that needs updating —
  // documented here as the seam, not guessed further without real data.)
  const questionHtml = renderTemplate(tmpl.qfmt, fields);
  const answerHtml = renderTemplate(tmpl.afmt.replace('{{FrontSide}}', questionHtml), fields);
  return {
    question: substituteMedia(questionHtml, resolvedMedia),
    answer: substituteMedia(answerHtml, resolvedMedia),
  };
}

/** Every media filename this card's rendered HTML (both sides) references. */
export function cardMediaFilenames({ card, note, model }) {
  const fields = Object.fromEntries((model.field_names || []).map((name, i) => [name, note.fields[i] || '']));
  const tmpl = model.templates?.[0] || { qfmt: '', afmt: '' };
  const q = renderTemplate(tmpl.qfmt, fields);
  const a = renderTemplate(tmpl.afmt.replace('{{FrontSide}}', q), fields);
  return [...new Set([...extractMediaFilenames(q), ...extractMediaFilenames(a)])];
}

/**
 * Batch 2 — image expansion. Resolved image URLs actually visible on the
 * CURRENT side (question or answer) of this card, for the study screen's
 * "expand image" affordance.
 *
 * Deliberately does NOT reach into the iframe to find out what was tapped —
 * it can't. The iframe's `sandbox=""` (see the file header) gives it an
 * opaque origin with no script execution, so there is no channel — no
 * postMessage, no cross-frame click bubbling, nothing — for the parent to
 * learn what's inside it. Weakening the sandbox to get one is explicitly
 * off the table (batch 1 and batch 2 both require preserving it). Instead
 * this reuses buildCardHtml()'s already-substituted output — the same
 * resolved-URL HTML the iframe itself renders — and just re-extracts the
 * <img> srcs from it with the same regex-based extractMediaFilenames()
 * already used for the resolveMedia() request. A missing/unresolved image
 * already isn't an <img> tag in that HTML (substituteMedia swaps it for a
 * ".media-missing" placeholder span), so this naturally only ever returns
 * images that actually rendered.
 */
export function cardSideImages({ card, note, model, resolvedMedia = {}, revealed }) {
  const { question, answer } = buildCardHtml({ card, note, model, resolvedMedia });
  return extractImageSrcs(revealed ? answer : question);
}

/**
 * Phase L5 — theme rule: the MedBook SHELL around the iframe follows
 * MedBook's theme; the card's OWN content inside the iframe keeps its
 * original Anki styling untouched (deck CSS is injected as-is, never
 * recolored/inverted). If a card is genuinely unreadable in its original
 * styling, that's a content problem to flag, not something to fix by
 * overriding its CSS globally.
 */
// Defaults suit a small "quick glance" context (Browse's CardPreviewModal,
// a compact popup) — a fixed minHeight/maxHeight. StudySession — the actual
// study screen — passes `fill` instead: the card should be exactly as tall
// as whatever space its flex parent actually has, not a vh guess made
// independent of the header/rating-buttons around it (a vh cap either
// clipped a long card early or left dead space below the buttons on a
// short one). `fill` requires the parent to be a flex column with
// minHeight:0 on this element's wrapper — see StudySession.js.
export default function CardRenderer({ card, note, model, resolvedMedia, revealed, minHeight = 180, maxHeight = '55vh', fill = false }) {
  const html = useMemo(() => {
    const { question, answer } = buildCardHtml({ card, note, model, resolvedMedia });
    return wrapDocument(revealed ? answer : question, model.css);
  }, [card, note, model, resolvedMedia, revealed]);

  // Batch 2 — a subtle (~180ms) fade when the CARD itself changes, not on
  // every flip: revealing the answer already has its own "Show Answer"
  // press feedback, and fading there would just delay the answer becoming
  // clearly legible. This is a plain opacity transition on a WRAPPER div —
  // the iframe below is never given a `key` and is never remounted, so its
  // srcDoc still updates in place exactly as it always did. Nothing about
  // this can cause an extra image reload: the fade is paint-only, it
  // doesn't touch how or when srcDoc changes.
  const [visible, setVisible] = useState(true);
  const prevCardId = useRef(card?.id);
  useEffect(() => {
    if (prevCardId.current === card?.id) return;
    prevCardId.current = card?.id;
    setVisible(false);
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [card?.id]);

  return (
    <div className="mb-card-fade" style={{
      ...(fill ? { flex: 1, minHeight: 0 } : {}),
      display: 'flex', flexDirection: 'column',
      opacity: visible ? 1 : 0,
    }}>
      <style>{`
        .mb-card-fade { transition: opacity .18s ease; }
        @media (prefers-reduced-motion: reduce) { .mb-card-fade { transition: none; } }
      `}</style>
      <iframe
        title="card"
        srcDoc={html}
        sandbox=""
        referrerPolicy="no-referrer"
        style={{
          width: '100%',
          ...(fill ? { flex: 1, minHeight: 0 } : { minHeight, maxHeight }),
          border: 'none',
          borderRadius: 12,
          background: '#fff', // the card's OWN background — not a MedBook theme token, deliberately
          display: 'block',
        }}
      />
    </div>
  );
}
