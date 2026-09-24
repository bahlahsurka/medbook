// lib/studyInteraction.js
//
// Shared "study content interaction" scope, applied to the deep-reading
// surfaces identified in the native-app-feel audit (Review Notes, AI
// Analysis, MedBook's own Flashcards). See public/index.html for the
// .mb-study-scope CSS this class name activates.
//
// The goal is a native-app FEEL, not a locked-down page: text inside a
// scoped surface stays selectable (drag-select, read, copy via Ctrl/Cmd+C
// all keep working everywhere), but the surrounding browser/OS chrome that
// makes a page feel like "a webpage" — the right-click menu, iOS's
// long-press callout — is suppressed within that one surface. This is the
// exact pattern already proven for the native Capacitor build
// (body.cap-native + [data-selectable="true"] in public/index.html),
// generalized to the ordinary web/PWA build and scoped per-component
// instead of body-wide.
//
// Deliberately NOT applied here: inputs, textareas, contenteditable, forms,
// nav, settings — .mb-study-scope's own CSS already opts those back in
// wherever one happens to live inside a scoped container, so nothing needs
// to avoid this class defensively.
export const STUDY_SCOPE_CLASS = 'mb-study-scope';

// Suppresses the plain webpage right-click context menu on ONE element
// (never document-level — see the audit's SelectableCard precedent in
// App.js, which already does exactly this for a different purpose). Text
// selection itself is untouched: Ctrl/Cmd+C and drag-select keep working,
// this only hides the browser's own menu so MedBook's own UI (where one
// exists) is what a visitor sees instead.
export function suppressContextMenu(e) {
  e.preventDefault();
}
