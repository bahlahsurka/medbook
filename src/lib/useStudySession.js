import { useEffect, useRef } from 'react';

// Read directly (not via lib/supabase.js's client) — persist() below talks
// to PostgREST with a raw `fetch` instead of the supabase-js client, so it
// can pass `keepalive: true`. See persist()'s own comment for why.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

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
// behavior. 30s bounds how much a genuinely instant kill (no visibilitychange
// or pagehide at all — an OS force-quit, a crash) can ever lose to half of
// what it used to be, while still keeping the extra requests infrequent.
const HEARTBEAT_MS = 30000;

/**
 * useStudySession — records real study-session duration for the Insights
 * page's Study Time chart, backed by the `study_sessions` table (see
 * SUPABASE_MIGRATION_INSIGHTS.sql — must be run once per Supabase project
 * before this actually persists anything).
 *
 * Called once, app-wide, from App.js — `active` is just "signed in and the
 * tab is in front of you" (`!!session && !isRecovery`), so this measures
 * total app usage time rather than time on any one screen. It used to be
 * called separately from DetailView/ReviewQueue/FlashCards with narrower
 * `active` conditions scoped to each screen, which undercounted real usage
 * (adding entries, browsing, searching, managing systems all counted as
 * zero) — see the App.js call site for the current rationale.
 *
 * `active` toggles the timer on/off without unmounting the caller, so
 * Pause-equivalent conditions (e.g. tab hidden) stop the clock and coming
 * back resumes it, all within the same component instance. `accessToken`
 * is the signed-in user's current JWT (`session.access_token` from App.js) —
 * kept in a ref rather than an effect dependency (see tokenRef below) so a
 * routine token refresh never tears down and rebuilds the running timer.
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
 * A brief interruption — switching away to reply to a notification, a
 * quick app-switch — often elapses less than MIN_SECONDS_TO_LOG on its own.
 * That used to mean it was thrown away outright the instant the tab hid,
 * even though the user came straight back and kept studying: real regular
 * usage made of many such short hops could lose a meaningful amount of its
 * own total time this way, never reaching the floor each individual gap
 * was measured against. `pendingRef` carries an under-the-floor fragment
 * forward into the NEXT segment instead, so only the running TOTAL across a
 * string of brief interruptions has to clear the floor, not each one on its
 * own.
 *
 * Insert failures are swallowed (dev-only console.warn) — analytics must
 * never break or block the screen the user is actually trying to use.
 */
export function useStudySession(active, userId, context, accessToken) {
  const startRef = useRef(null);
  const pendingRef = useRef(0); // seconds carried over from a too-short-to-log gap
  // Always the LATEST token, read synchronously by persist() at call time —
  // not an effect dependency, so a routine token refresh (Supabase re-mints
  // the JWT roughly hourly, and again on every tab/app foreground — see
  // App.js's own comment on this) never tears down and restarts the running
  // timer the way including it in the effect's dependency array would.
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  useEffect(() => {
    if (!active || !userId) return;
    startRef.current = Date.now();
    pendingRef.current = 0;

    const persist = (elapsedSeconds, endedAt) => {
      if (!tokenRef.current) return; // not actually signed in — RLS would reject this anyway
      const row = {
        user_id: userId,
        started_at: new Date(endedAt - elapsedSeconds * 1000).toISOString(),
        duration_seconds: elapsedSeconds,
        context,
      };
      // Raw `fetch` with `keepalive: true` instead of the supabase-js
      // client — `keepalive` is the browser's own mechanism for "finish
      // sending this small request even though the page is being torn down
      // right now", which is exactly the situation every flush() path below
      // is triggered by (tab backgrounded/closed, pagehide, unmount). A
      // plain fetch (what the supabase-js client issues internally) racing
      // an actual navigation/close can get silently cancelled mid-flight
      // before it reaches the server — a real session's final seconds never
      // arriving even though the app computed and attempted to send them.
      // The pagination/heartbeat fixes elsewhere fixed WHAT gets counted and
      // WHEN; this fixes whether the write for a closing tab survives long
      // enough to land. Applied to every persist, not just teardown-
      // triggered ones, to keep one code path — the payload here is a few
      // dozen bytes, nowhere near keepalive's ~64KB combined-request cap, so
      // there's no downside while the tab stays open either.
      fetch(`${SUPABASE_URL}/rest/v1/study_sessions`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${tokenRef.current}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify([row]),
      }).then((res) => {
        if (!res.ok && process.env.NODE_ENV !== 'production') {
          res.text().then((msg) => {
            // eslint-disable-next-line no-console
            console.warn('[useStudySession] insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', res.status, msg);
          }).catch(() => {});
        }
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[useStudySession] insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', error.message);
        }
      });
    };

    // Session is pausing (hidden/unmounting). Stops the clock and rolls
    // whatever just elapsed into pendingRef, persisting only once the
    // carried-over TOTAL clears MIN_SECONDS_TO_LOG — see the doc comment
    // above for why this accumulates rather than each gap being judged
    // against the floor on its own.
    const flush = () => {
      if (!startRef.current) return;
      const now = Date.now();
      pendingRef.current += Math.round((now - startRef.current) / 1000);
      startRef.current = null;
      if (pendingRef.current >= MIN_SECONDS_TO_LOG) {
        persist(pendingRef.current, now);
        pendingRef.current = 0;
      }
    };

    const heartbeat = setInterval(() => {
      if (!startRef.current) return;
      const now = Date.now();
      // Always above the floor by construction (a full HEARTBEAT_MS has
      // elapsed), so this persists unconditionally and also sweeps up any
      // still-pending fragment from an earlier short gap.
      const elapsedSeconds = pendingRef.current + Math.round((now - startRef.current) / 1000);
      pendingRef.current = 0;
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
