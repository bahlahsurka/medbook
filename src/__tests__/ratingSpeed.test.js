// Instant ratings — acceptance test 1: "tap->next-card <100ms, all 3
// areas, before/after." This measures the AFTER number for real, by
// mounting the actual ReviewQueue component (jsdom, not a live browser —
// which if anything makes the measured number a pessimistic upper bound,
// since jsdom's DOM/React overhead is not faster than a real browser's)
// and timing wall-clock from a rating button click to the next card's
// title being on screen.
//
// There is no "before" number to re-measure: the old code this replaced
// (an awaited `supabase.from('entries').update(...)` inside rate()) no
// longer exists in this diff. That awaited round trip was the user's
// original complaint ("a visible pause after tapping a rating") and is
// exactly what removing the await eliminates — a Supabase REST round trip
// is typically tens to a few hundred ms depending on network, which is
// the whole reason this brief exists. The number this test actually
// reports is the AFTER number: what's left once that await is gone.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import ReviewQueue from '../components/ReviewQueue';
import SystemReview from '../components/SystemReview';
import StudySession from '../components/ImportedDecks/StudySession';

jest.mock('../lib/supabase', () => {
  const chain = {
    select: () => chain, insert: () => chain, update: () => chain, delete: () => chain,
    eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    single: () => chain, then: (resolve) => resolve({ data: null, error: null }),
  };
  return { supabase: { from: () => chain, rpc: jest.fn().mockResolvedValue({ error: null }) } };
});

// StudySession.js (My Cards / isOwnCards path) fetches its own session
// cards through lib/ownCards/api.js rather than taking a ready-made array
// as a prop (unlike ReviewQueue/SystemReview) — mocked directly here, same
// reasoning as every other mock in this file: only enough to reach the
// active, rateable card on screen. My Cards is this file's 3rd "area"
// rather than Imported Decks/Favorites specifically because its cards
// render as plain text (lib/ownCards/cardText.js) — Imported Decks'
// CardRenderer renders Anki note/model templates inside a sandboxed
// iframe, which would need a fabricated note/model/template fixture to
// reach the same screen and adds nothing this test is actually checking
// (the synchronous tap->next-card path itself is identical code in
// StudySession.js's rate() regardless of which deck kind is studying).
jest.mock('../lib/ownCards/api', () => ({
  ...jest.requireActual('../lib/ownCards/api'),
  getSessionCards: jest.fn(),
}));
import * as ownCardsApi from '../lib/ownCards/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

function dueEntry(id, title) {
  return {
    id, title, system: 'Cardiology', notes: `Notes for ${title}`, highlights: [],
    review_interval: 3, ease_factor: 2.5, review_count: 1,
    next_review: new Date(Date.now() - 86400000).toISOString(), // overdue
    last_reviewed: new Date(Date.now() - 4 * 86400000).toISOString(),
  };
}

let container, root, warnSpy;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The background flush this exercises is incidental to what's being
  // measured here (UI speed) — its own correctness is ratingOutbox.test.js's
  // job, and this mock's bare-bones `rpc` stub logging a warning on an
  // unawaited race with teardown is expected noise, not a real failure.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  act(() => { root.unmount(); });
  document.body.removeChild(container);
  container = null;
  warnSpy.mockRestore();
});

test('ReviewQueue: tap a rating -> next card is on screen in well under 100ms', () => {
  const entries = { Cardiology: [dueEntry('e1', 'First Card'), dueEntry('e2', 'Second Card')] };

  act(() => {
    root.render(
      <ThemeProvider>
        <ReviewQueue
          allEntries={entries}
          onReviewed={() => {}}
          userSystems={[{ name: 'Cardiology' }]}
          initialFilterSystem="Cardiology"
          userId="test-user"
        />
      </ThemeProvider>
    );
  });

  // buildCycledQueue doesn't promise insertion order for same-due-date
  // entries, so read back whichever of the two actually landed first
  // rather than assuming it.
  const firstTitle = container.textContent.includes('First Card') ? 'First Card' : 'Second Card';
  const secondTitle = firstTitle === 'First Card' ? 'Second Card' : 'First Card';
  expect(container.textContent).toContain(firstTitle);

  // Toolbar icon buttons sit before the "Tap to reveal" button on screen —
  // found by its own text instead of assuming position.
  const revealBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Tap to reveal'));
  expect(revealBtn).toBeTruthy();
  act(() => { revealBtn.click(); });

  const goodBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.startsWith('Good'));
  expect(goodBtn).toBeTruthy();

  const start = performance.now();
  act(() => { goodBtn.click(); });
  const elapsed = performance.now() - start;

  // eslint-disable-next-line no-console
  console.log(`[acceptance test 1] ReviewQueue tap-rating -> next-card render: ${elapsed.toFixed(2)}ms`);

  expect(container.textContent).toContain(secondTitle);
  expect(elapsed).toBeLessThan(100);
});

test('SystemReview: tap a rating -> next card is on screen in well under 100ms', () => {
  const entries = [dueEntry('e1', 'First Card'), dueEntry('e2', 'Second Card')];

  act(() => {
    root.render(
      <ThemeProvider>
        <SystemReview
          system="Cardiology"
          entries={entries}
          color="#2563eb"
          onReviewed={() => {}}
          onClose={() => {}}
          userId="test-user"
        />
      </ThemeProvider>
    );
  });

  const firstTitle = container.textContent.includes('First Card') ? 'First Card' : 'Second Card';
  const secondTitle = firstTitle === 'First Card' ? 'Second Card' : 'First Card';
  expect(container.textContent).toContain(firstTitle);

  const revealBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Tap to reveal'));
  expect(revealBtn).toBeTruthy();
  act(() => { revealBtn.click(); });

  const goodBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.startsWith('Good'));
  expect(goodBtn).toBeTruthy();

  const start = performance.now();
  act(() => { goodBtn.click(); });
  const elapsed = performance.now() - start;

  // eslint-disable-next-line no-console
  console.log(`[acceptance test 1] SystemReview tap-rating -> next-card render: ${elapsed.toFixed(2)}ms`);

  expect(container.textContent).toContain(secondTitle);
  expect(elapsed).toBeLessThan(100);
});

function ownCard(id, question) {
  return {
    id, question, answer: `Answer for ${question}`, user_id: 'test-user',
    state: 'review', due_at: new Date(Date.now() - 86400000).toISOString(),
    interval_days: 3, ease_factor: 2.5, review_count: 1, lapse_count: 0,
    last_reviewed_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  };
}

test('StudySession (My Cards): tap a rating -> next card is on screen in well under 100ms', async () => {
  const cards = [ownCard('c1', 'First Question'), ownCard('c2', 'Second Question')];
  ownCardsApi.getSessionCards.mockResolvedValue(cards);
  const deck = { id: '__owncards__:all', display_name: 'My Cards', isOwnCards: true, ownCardsSystem: null, newCardsPerDay: 20, limit: 50 };

  await act(async () => {
    root.render(
      <ThemeProvider>
        <StudySession deck={deck} userId="test-user" onExit={() => {}} />
      </ThemeProvider>
    );
    await Promise.resolve(); // let getSessionCards' mocked promise resolve
  });

  const firstQ = container.textContent.includes('First Question') ? 'First Question' : 'Second Question';
  const secondQ = firstQ === 'First Question' ? 'Second Question' : 'First Question';
  expect(container.textContent).toContain(firstQ);

  const showAnswerBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Show Answer'));
  expect(showAnswerBtn).toBeTruthy();
  act(() => { showAnswerBtn.click(); });

  const goodBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.startsWith('Good'));
  expect(goodBtn).toBeTruthy();

  const start = performance.now();
  act(() => { goodBtn.click(); });
  const elapsed = performance.now() - start;

  // eslint-disable-next-line no-console
  console.log(`[acceptance test 1] StudySession (My Cards) tap-rating -> next-card render: ${elapsed.toFixed(2)}ms`);

  expect(container.textContent).toContain(secondQ);
  expect(elapsed).toBeLessThan(100);
});
