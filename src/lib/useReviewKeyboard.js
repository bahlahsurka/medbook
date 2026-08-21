import { useEffect } from 'react';

/**
 * useReviewKeyboard — keyboard shortcuts for review/flashcard screens.
 *
 *   Space           → reveal the answer (only while not yet flipped)
 *   Enter           → "easy" rating, or just advance if there's no rating step
 *   g               → "good"
 *   h               → "hard"
 *   a               → "again"
 *   ← (ArrowLeft)   → previous card, regardless of flip state
 *
 * Safety rules, because this listens globally on `document`:
 *   - Disabled while any input/textarea/contentEditable has focus, so typing
 *     "g" into a note never gets hijacked.
 *   - Disabled while `enabled` is false (e.g. the screen isn't mounted, or a
 *     modal like the image lightbox is open on top of it).
 *   - Space is prevented from also scrolling the page (its normal behaviour).
 *   - A focused <button> (from a mouse click on Previous/Pause/etc.) is
 *     blurred before we act on a key this hook handles. A native button
 *     activates on its OWN Enter/Space keypress too, so leaving one focused
 *     meant the next Enter both rated/advanced the card via this hook AND
 *     silently re-fired that button's onClick — e.g. click Previous, then
 *     press Enter to rate: it advances, then immediately re-triggers
 *     Previous, landing right back where you started. Blurring here fixes
 *     it for every button on the screen, not just the ones we remember to
 *     special-case with onMouseDown={preventDefault}.
 *
 * `handlers` — only the ones you pass are wired up, so FlashCards (which has
 * no difficulty rating) can supply just { onFlip, onNext } and skip the rest.
 * `onPrev` is likewise optional — pass it to enable ← for "previous card";
 * omit it (e.g. on the first card, where there's nothing to go back to) and
 * ArrowLeft simply does nothing.
 */
export function useReviewKeyboard(enabled, { flipped, onFlip, onAgain, onHard, onGood, onEasy, onNext, onPrev }) {
  useEffect(() => {
    if (!enabled) return;

    const isTypingTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };

    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // don't fight browser shortcuts
      if (isTypingTarget(document.activeElement)) return;

      // Only blur when we're actually about to act on this key — not on
      // every keystroke, so normal Tab-based keyboard navigation between
      // buttons is left alone.
      const isHandledKey = e.code === 'Space' || e.key === 'ArrowLeft' ||
        (flipped && ['Enter','g','G','h','H','a','A'].includes(e.key));
      if (isHandledKey && document.activeElement?.tagName === 'BUTTON') {
        document.activeElement.blur();
      }

      if (e.code === 'Space') {
        e.preventDefault(); // stop the page from scrolling
        if (!flipped && onFlip) onFlip();
        else if (flipped && onNext && !onAgain && !onGood) onNext(); // flip-only screens: Space also advances
        return;
      }

      // Unlike the rating/advance keys below, going back makes sense from
      // either side of a card (question or answer), so this isn't gated on
      // `flipped`.
      if (e.key === 'ArrowLeft') {
        if (onPrev) onPrev();
        return;
      }

      if (!flipped) return; // rating/advance keys only make sense once revealed

      switch (e.key) {
        case 'Enter':
          if (onEasy) onEasy();
          else if (onNext) onNext();
          break;
        case 'g': case 'G':
          if (onGood) onGood();
          break;
        case 'h': case 'H':
          if (onHard) onHard();
          break;
        case 'a': case 'A':
          if (onAgain) onAgain();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, flipped, onFlip, onAgain, onHard, onGood, onEasy, onNext, onPrev]);
}
