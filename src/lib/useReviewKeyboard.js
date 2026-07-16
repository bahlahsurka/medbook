import { useEffect } from 'react';

/**
 * useReviewKeyboard — keyboard shortcuts for review/flashcard screens.
 *
 *   Space           → reveal the answer (only while not yet flipped)
 *   Enter           → "easy" rating, or just advance if there's no rating step
 *   g               → "good"
 *   h               → "hard"
 *   a               → "again"
 *
 * Safety rules, because this listens globally on `document`:
 *   - Disabled while any input/textarea/contentEditable has focus, so typing
 *     "g" into a note never gets hijacked.
 *   - Disabled while `enabled` is false (e.g. the screen isn't mounted, or a
 *     modal like the image lightbox is open on top of it).
 *   - Space is prevented from also scrolling the page (its normal behaviour).
 *
 * `handlers` — only the ones you pass are wired up, so FlashCards (which has
 * no difficulty rating) can supply just { onFlip, onNext } and skip the rest.
 */
export function useReviewKeyboard(enabled, { flipped, onFlip, onAgain, onHard, onGood, onEasy, onNext }) {
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

      if (e.code === 'Space') {
        e.preventDefault(); // stop the page from scrolling
        if (!flipped && onFlip) onFlip();
        else if (flipped && onNext && !onAgain && !onGood) onNext(); // flip-only screens: Space also advances
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
  }, [enabled, flipped, onFlip, onAgain, onHard, onGood, onEasy, onNext]);
}
