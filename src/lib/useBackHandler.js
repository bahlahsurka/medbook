// lib/useBackHandler.js
//
// Makes the Android hardware/gesture back button (and, for free, a mouse/
// trackpad "Back" press in a normal browser tab) step back through
// MedBook's in-app screens instead of exiting the app or leaving the page.
//
// Why this exists: MedBook's navigation (App.js's `view`, FlashCards.js's
// own area/sub-state, etc.) is plain React state, not real browser history
// — nothing ever calls history.pushState. Wrapped in Capacitor's native
// WebView, that means `WebView.canGoBack()` is always false, so with NO
// custom handling the hardware back button has nothing to step back
// through and the app just exits immediately from wherever you are. That's
// true in a plain mobile browser tab too, just less jarring there since
// "back" leaving the page is at least the expected browser behavior.
//
// The fix leans on the same History API the WebView (and browser) already
// wire the hardware/gesture back button to: each active "screen" pushes
// one history entry, and popping it back off — via the actual back button,
// not a JS call — is what triggers the corresponding in-app transition.
// Capacitor needs no separate `backButton` listener for this to work; its
// default (un-configured) Android behavior already calls the WebView's own
// `goBack()` whenever `canGoBack()` is true, which is exactly what having
// real pushState entries makes true.
//
// Usage: call `useBackHandler(active, onBack)` from any component that
// represents a "screen" or "layer" (a whole view, an open modal, an
// expanded sub-mode, an open drawer). `active` is whether that layer is
// currently the front-most thing on screen; `onBack` closes/un-drills it —
// it should NOT touch history itself, popping already happened by the time
// it's called. Multiple call sites nest correctly regardless of which
// component registers them or in what file: the most recently activated
// layer always gets the back press first, then whatever's under it, same
// as a native Android back stack — because ordering is tracked by *when*
// each one activated, not by React component-tree position.
import { useEffect, useRef } from 'react';

const MARK = '__mbBack';

// One process-wide stack, not per-hook-instance — a single shared History
// timeline is what lets layers registered from entirely different
// components (App.js's top-level view, FlashCards.js's own sub-state,
// a modal three components deep) still nest in the right order.
let stack = [];
let idCounter = 0;
// Incremented right before a cleanup-triggered `history.back()` so the
// popstate that call produces doesn't get mistaken for a real back-button
// press and cascade into the next handler too (see the cleanup below for
// why that call happens at all).
let suppressNext = 0;

// `event.state` on a popstate is the entry being navigated TO, not the one
// just left — so it names whatever is now BELOW the layer that just
// closed, never the layer itself. Matching it against our own stack's top
// id (an earlier version of this file tried exactly that) can never work.
// The only thing a popstate reliably signals here is "the history position
// moved back by one" — which, since nothing else in this app touches
// history, is equivalent to "one of our own pushed entries was just
// consumed". So: pop whatever's actually on top of OUR stack and fire it,
// unconditionally, rather than trying to correlate against event.state.
function onPopState() {
  if (suppressNext > 0) { suppressNext--; return; }
  const top = stack.pop();
  if (!top) return; // nothing of ours was open — a real navigation, let it proceed
  top.onBack();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', onPopState);
}

export function useBackHandler(active, onBack) {
  // A ref, not a dependency — `onBack` is typically a fresh closure every
  // render (it reads current component state), and re-running the push/pop
  // effect every time it changes would push a new history entry per
  // keystroke-equivalent re-render instead of once per screen. Only a
  // change in `active` should push or pop.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;

    const id = ++idCounter;
    stack.push({ id, onBack: () => onBackRef.current() });
    window.history.pushState({ [MARK]: id }, '');

    return () => {
      // Still on the stack means this layer closed WITHOUT the back button
      // — a Cancel/✕ button, finishing a flow, switching tabs, etc. Pop our
      // own bookkeeping, and if our pushState entry is still the current
      // one, consume it with a real history.back() too so the browser's
      // actual history stays in sync with what's still open — otherwise a
      // later real back press would land on this stale entry and silently
      // do nothing instead of closing whatever's now on top.
      const idx = stack.findIndex(e => e.id === id);
      if (idx === -1) return;
      stack.splice(idx, 1);
      if (window.history.state && window.history.state[MARK] === id) {
        suppressNext++;
        window.history.back();
      }
    };
  }, [active]);
}
