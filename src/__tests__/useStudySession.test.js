// Regression tests for study-time tracking bugs reported together as
// "regular app usage isn't reflected in the main Study Time chart" / "still
// not consistent":
//
//   1. useStudySession used to throw away a too-short-to-log fragment
//      outright the instant the tab hid (switching away to reply to a
//      notification, a quick app-switch), even though the user came
//      straight back and kept studying — real usage made of many such
//      brief interruptions never reached the floor EACH gap was measured
//      against. Fixed by carrying an under-the-floor fragment forward
//      (pendingRef) into the next segment, so only the running TOTAL has
//      to clear the floor.
//   2. Insights' study_sessions fetch had no explicit pagination, so a
//      regular, heavy user (a heartbeat adds up fast over weeks of daily
//      use) could silently lose everything past Supabase/PostgREST's
//      default 1000-row response cap — see fetchAllRows's own test below.
//   3. persist() used to go through the supabase-js client (a plain
//      `fetch` under the hood), which can get silently cancelled mid-flight
//      when it races an actual page unload/close rather than just a
//      background/hide — the exact moment every flush() path here fires in.
//      Fixed by issuing the insert as a raw `fetch` with `keepalive: true`,
//      the browser's own "finish sending this even though the page is being
//      torn down" mechanism. These tests mock `global.fetch` (not
//      `supabase.from`, which this hook no longer calls) and assert every
//      persisted request carries `keepalive: true`.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useStudySession } from '../lib/useStudySession';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mockFetch() {
  const calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url, opts, row: JSON.parse(opts.body)[0] });
    return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
  });
  return calls;
}

function Harness({ active, userId }) {
  useStudySession(active, userId, 'app', 'fake-access-token');
  return null;
}

let container, root, unmounted;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  unmounted = false;
  jest.useFakeTimers();
});
afterEach(async () => {
  // Unmounting runs the hook's own cleanup (removes its visibilitychange/
  // pagehide listeners) — without this, a still-mounted instance from an
  // earlier test keeps reacting to the NEXT test's dispatched events too,
  // since they're both listening on the same global `document`/`window`.
  // Guarded since the unmount test below already unmounts itself.
  if (!unmounted) await act(async () => { root.unmount(); });
  jest.useRealTimers();
  document.body.removeChild(container);
  container = null;
});

function setHidden(hidden) {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

test('a single short gap below the floor is not logged on its own (unchanged behavior)', async () => {
  const calls = mockFetch();
  act(() => { root.render(<Harness active={true} userId="u1" />); });

  act(() => { jest.advanceTimersByTime(2000); }); // 2s active
  await act(async () => { setHidden(true); }); // hide -> flush: 2s, below the 5s floor

  expect(calls.length).toBe(0);
});

test('two short gaps that individually miss the floor combine and ARE logged once their total clears it', async () => {
  const calls = mockFetch();
  act(() => { root.render(<Harness active={true} userId="u1" />); });

  // First brief interruption: 3s active, then hidden (3s pending, < 5s floor — not logged yet).
  act(() => { jest.advanceTimersByTime(3000); });
  await act(async () => { setHidden(true); });
  expect(calls.length).toBe(0);

  // Comes right back, studies 3 more seconds, hides again.
  await act(async () => { setHidden(false); });
  act(() => { jest.advanceTimersByTime(3000); });
  await act(async () => { setHidden(true); });

  // Combined pending (3s + 3s = 6s) clears the floor — logged as ONE row,
  // not silently dropped twice.
  expect(calls.length).toBe(1);
  expect(calls[0].url).toContain('/rest/v1/study_sessions');
  expect(calls[0].row.duration_seconds).toBe(6);
});

test('a pending fragment carries into the next heartbeat and is included in its total, with no time lost', async () => {
  const calls = mockFetch();
  act(() => { root.render(<Harness active={true} userId="u1" />); });

  // 3s, hide (pending=3, below floor, not logged), come back immediately.
  act(() => { jest.advanceTimersByTime(3000); });
  await act(async () => { setHidden(true); });
  await act(async () => { setHidden(false); });

  // The heartbeat's own 30s cycle is anchored to when the effect first
  // mounted, not reset by a resume — so it fires 27s after the resume here
  // (30s since mount minus the 3s already spent before the gap), not a
  // fresh 30s later. That's correct, not a second bug: 3s (pending, before
  // the gap) + 27s (since resuming) covers exactly the 30s of real elapsed
  // time since mount, with nothing lost or double-counted.
  await act(async () => { jest.advanceTimersByTime(30000); });

  expect(calls.length).toBe(1);
  expect(calls[0].row.duration_seconds).toBe(30);
});

test('unmounting with only a sub-floor pending fragment logs nothing (still respects the floor at session end)', async () => {
  const calls = mockFetch();
  act(() => { root.render(<Harness active={true} userId="u1" />); });

  act(() => { jest.advanceTimersByTime(2000); });
  await act(async () => { root.unmount(); });
  unmounted = true;

  expect(calls.length).toBe(0);
});

test('every persisted request is sent with keepalive so it survives an actual tab close, not just a background', async () => {
  const calls = mockFetch();
  act(() => { root.render(<Harness active={true} userId="u1" />); });

  act(() => { jest.advanceTimersByTime(10000); });
  await act(async () => { setHidden(true); }); // flush on hide/teardown

  expect(calls.length).toBe(1);
  expect(calls[0].opts.keepalive).toBe(true);
  expect(calls[0].opts.headers.Authorization).toBe('Bearer fake-access-token');
});

test('nothing is persisted when there is no access token (would fail RLS anyway)', async () => {
  const calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
  });

  function NoTokenHarness({ active, userId }) {
    useStudySession(active, userId, 'app', null);
    return null;
  }
  act(() => { root.render(<NoTokenHarness active={true} userId="u1" />); });

  act(() => { jest.advanceTimersByTime(10000); });
  await act(async () => { setHidden(true); });

  expect(calls.length).toBe(0);
});
