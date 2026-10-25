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

// The single live useStudySession instance's checkpoint function (there is
// only ever one — it's mounted once, app-wide, from App.js), so another part
// of the app can force an immediate commit of elapsed-but-not-yet-persisted
// time instead of waiting for the next heartbeat tick or a tab hide. See
// flushStudySessionNow below for why this exists.
let liveCheckpoint = null;

/**
 * Force the app-wide study timer to commit whatever's elapsed so far RIGHT
 * NOW, without stopping the clock (unlike the internal flush() used for
 * hide/pagehide/unmount, which deliberately stops timing until the tab is
 * next visible). Call this at a meaningful "I just finished a real chunk of
 * studying" boundary — e.g. completing a Review Queue session — so that
 * time is reflected in the Study Time total immediately.
 *
 * Why this is needed even though useStudySession already runs continuously
 * across the whole app (it never unmounts just because the visible screen
 * changes, Review Queue included): its own heartbeat only commits every
 * HEARTBEAT_MS, and in-app navigation between screens doesn't trigger
 * visibilitychange/pagehide at all (the tab itself never actually hides).
 * A reported bug — finishing a Review Queue session and seeing it in
 * Insights' "Recent study sessions" list but NOT reflected in the Study
 * Time total — was exactly this: the elapsed time was sitting, correctly
 * tracked but uncommitted, in the running timer's startRef/pendingRef,
 * waiting on a heartbeat tick or a tab hide that might be a while off (or
 * might not come at all if the user closes the tab right after finishing).
 * This checkpoints that same running timer at the moment it's most likely
 * to matter to the user, rather than introducing a second, parallel
 * "credit this session's time" write that could double-count the same real
 * minutes the heartbeat/flush path already accounts for.
 *
 * A no-op if no session is currently running (e.g. signed out, or called
 * before App's effect has mounted) — safe to call unconditionally.
 */
export function flushStudySessionNow() {
  if (liveCheckpoint) liveCheckpoint();
}

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
 * Four ways progress gets saved, so a session's time is never all-or-
 * nothing on one fragile event:
 *   - heartbeat — every HEARTBEAT_MS while still active, commit what's
 *     elapsed so far as its own row, then keep the clock running from now.
 *   - on demand — another part of the app calls flushStudySessionNow()
 *     (exported above) at a meaningful boundary, e.g. finishing a Review
 *     Queue session, so that time is reflected immediately rather than
 *     waiting for the next heartbeat tick.
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

    // Commits elapsed-so-far WITHOUT stopping the clock (unlike flush(),
    // which deliberately stops timing until the tab is next visible) — the
    // heartbeat tick below is just this called on a timer, and
    // flushStudySessionNow (exported above) is this called on demand from
    // elsewhere in the app. Floor-respects the same way flush() does: a
    // too-small-on-its-own amount carries forward in pendingRef rather than
    // writing a noise row, so an on-demand checkpoint fired moments after
    // the clock last restarted can't spam tiny rows.
    const checkpoint = () => {
      if (!startRef.current) return;
      const now = Date.now();
      const elapsedSeconds = pendingRef.current + Math.round((now - startRef.current) / 1000);
      startRef.current = now; // keep timing — this is a commit, not a pause
      if (elapsedSeconds >= MIN_SECONDS_TO_LOG) {
        persist(elapsedSeconds, now);
        pendingRef.current = 0;
      } else {
        pendingRef.current = elapsedSeconds;
      }
    };
    liveCheckpoint = checkpoint;

    const heartbeat = setInterval(checkpoint, HEARTBEAT_MS);

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
      liveCheckpoint = null;
    };
  }, [active, userId, context]);
}
