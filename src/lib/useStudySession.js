import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

// Ignore accidental near-instant opens/navigations — someone tapping into
// an entry and immediately backing out shouldn't count as "studying".
const MIN_SECONDS_TO_LOG = 5;

// Persist progress this often while a session is still running, instead of
// only at the very end. Without this, a session that never cleanly ends —
// left open in the same tab while checking Insights elsewhere, or a mobile
// browser/PWA killing the page without a warning — never gets written at
// all, even though real time elapsed. Confirmed via Supabase's own request
// logs: real usage produced zero insert attempts because nothing had
// unmounted or backgrounded yet to trigger the old flush-only-at-the-end
// behavior. 60s keeps the extra requests infrequent while still making
// "I'm using it right now" show up well within a normal study session.
const HEARTBEAT_MS = 60000;

/**
 * useStudySession — records real study-session duration for the Insights
 * page's Study Time chart, backed by the `study_sessions` table (see
 * SUPABASE_MIGRATION_INSIGHTS.sql — must be run once per Supabase project
 * before this actually persists anything).
 *
 * `active` toggles the timer on/off without unmounting the caller — e.g.
 * ReviewQueue passes `sessionStarted && !ended && !done` so Pause stops the
 * clock and Resume restarts it, all within the same component instance.
 *
 * Three ways progress gets saved, so a session's time is never all-or-
 * nothing on one fragile event:
 *   - heartbeat — every HEARTBEAT_MS while still active, persist what's
 *     elapsed so far as its own row, then restart the clock from now.
 *   - tab hidden/backgrounded (visibilitychange) or the page being torn
 *     down (pagehide — fires more reliably than visibilitychange on some
 *     mobile browsers) — flush immediately, then resume timing from zero
 *     if the tab comes back while still `active`.
 *   - actual unmount — same flush, via the effect's cleanup.
 *
 * Insert failures are swallowed (dev-only console.warn) — analytics must
 * never break or block the screen the user is actually trying to use.
 */
export function useStudySession(active, userId, context) {
  const startRef = useRef(null);

  useEffect(() => {
    if (!active || !userId) return;
    startRef.current = Date.now();

    const persist = (elapsedSeconds, endedAt) => {
      if (elapsedSeconds < MIN_SECONDS_TO_LOG) return;
      supabase.from('study_sessions').insert({
        user_id: userId,
        started_at: new Date(endedAt - elapsedSeconds * 1000).toISOString(),
        duration_seconds: elapsedSeconds,
        context,
      }).then(({ error }) => {
        if (error && process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[useStudySession] insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', error.message);
        }
      });
    };

    // Final flush — session is ending (hidden/unmounting). Stops the clock.
    const flush = () => {
      if (!startRef.current) return;
      const now = Date.now();
      const elapsedSeconds = Math.round((now - startRef.current) / 1000);
      startRef.current = null;
      persist(elapsedSeconds, now);
    };

    const heartbeat = setInterval(() => {
      if (!startRef.current) return;
      const now = Date.now();
      const elapsedSeconds = Math.round((now - startRef.current) / 1000);
      persist(elapsedSeconds, now);
      startRef.current = now; // restart the clock, don't double-count next tick
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (document.visibilityState === 'visible') startRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Belt-and-suspenders alongside visibilitychange: some mobile browsers
    // fire pagehide but not (or not promptly) visibilitychange when a PWA
    // is swiped away. flush() is safe to call twice — the second call is a
    // no-op once startRef has already been cleared by the first.
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      clearInterval(heartbeat);
      flush();
    };
  }, [active, userId, context]);
}
