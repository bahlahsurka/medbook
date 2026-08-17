import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

// Ignore accidental near-instant opens/navigations — someone tapping into
// an entry and immediately backing out shouldn't count as "studying".
const MIN_SECONDS_TO_LOG = 5;

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
 * Handles two ways a session can end without a clean unmount:
 *   - tab hidden/backgrounded (visibilitychange) — flush what elapsed so
 *     far, then resume timing from zero if the tab comes back while still
 *     `active`, so backgrounding doesn't silently drop or inflate time.
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

    const flush = () => {
      if (!startRef.current) return;
      const elapsedSeconds = Math.round((Date.now() - startRef.current) / 1000);
      startRef.current = null;
      if (elapsedSeconds < MIN_SECONDS_TO_LOG) return;
      supabase.from('study_sessions').insert({
        user_id: userId,
        started_at: new Date(Date.now() - elapsedSeconds * 1000).toISOString(),
        duration_seconds: elapsedSeconds,
        context,
      }).then(({ error }) => {
        if (error && process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[useStudySession] insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', error.message);
        }
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (document.visibilityState === 'visible') startRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [active, userId, context]);
}
