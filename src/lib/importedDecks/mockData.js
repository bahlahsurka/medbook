// lib/importedDecks/mockData.js
//
// Seed data for building the Imported Decks UI before/alongside a working
// live import. Shapes here MUST mirror exactly what api/import-process.mjs
// and MediaService actually write — every field name below was taken
// directly from those files, not guessed. Where the backend has a real gap
// (see NOTE on due_cards), the mock still includes the field so UI code can
// be written against the intended final shape; api.js documents the gap.
//
// Anything here is illustrative content about a real, widely-used medical
// education deck ("Tzanki") for the purpose of exercising realistic UI
// states — not sourced from or reproducing that deck's actual proprietary
// content.

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
const hoursFromNow = (h) => new Date(now + h * 3600_000).toISOString();
const daysFromNow = (d) => new Date(now + d * 86_400_000).toISOString();

/* ------------------------------------------------------------------ */
/* imported_decks — hierarchy via parent_id                            */
/* ------------------------------------------------------------------ */

export const mockDecks = [
  {
    id: 'deck-root', user_id: 'mock-user', anki_deck_id: 1, parent_id: null,
    full_name: 'Tzanki Step 2', display_name: 'Tzanki Step 2', is_root: true,
    total_cards: 7043, new_cards: 4102, due_cards: 318, archived: false,
    new_cards_per_day: null, max_reviews_per_day: null,
  },
  {
    id: 'deck-cardio', user_id: 'mock-user', anki_deck_id: 2, parent_id: 'deck-root',
    full_name: 'Tzanki Step 2::Cardiology', display_name: 'Cardiology', is_root: false,
    total_cards: 612, new_cards: 340, due_cards: 41, archived: false,
  },
  {
    id: 'deck-arrhythmia', user_id: 'mock-user', anki_deck_id: 3, parent_id: 'deck-cardio',
    full_name: 'Tzanki Step 2::Cardiology::Arrhythmias', display_name: 'Arrhythmias', is_root: false,
    total_cards: 210, new_cards: 120, due_cards: 15, archived: false,
  },
  {
    id: 'deck-hf', user_id: 'mock-user', anki_deck_id: 4, parent_id: 'deck-cardio',
    full_name: 'Tzanki Step 2::Cardiology::Heart Failure', display_name: 'Heart Failure', is_root: false,
    total_cards: 178, new_cards: 90, due_cards: 12, archived: false,
  },
  {
    id: 'deck-neuro', user_id: 'mock-user', anki_deck_id: 5, parent_id: 'deck-root',
    full_name: 'Tzanki Step 2::Neurology', display_name: 'Neurology', is_root: false,
    total_cards: 540, new_cards: 300, due_cards: 28, archived: false,
  },
  {
    id: 'deck-peds', user_id: 'mock-user', anki_deck_id: 6, parent_id: 'deck-root',
    full_name: 'Tzanki Step 2::Pediatrics', display_name: 'Pediatrics', is_root: false,
    total_cards: 390, new_cards: 210, due_cards: 19, archived: false,
  },
  // A second, smaller, already-archived deck — exercises the "archived" deck-action state.
  {
    id: 'deck-small-root', user_id: 'mock-user', anki_deck_id: 100, parent_id: null,
    full_name: 'INBDE Booster', display_name: 'INBDE Booster', is_root: true,
    total_cards: 3591, new_cards: 0, due_cards: 0, archived: true,
  },
];

/* ------------------------------------------------------------------ */
/* imported_models                                                     */
/* ------------------------------------------------------------------ */

export const mockModels = [
  {
    id: 'model-basic', root_deck_id: 'deck-root', anki_model_id: 1,
    name: 'Basic', is_cloze: false,
    field_names: ['Front', 'Back'],
    templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id="answer">{{Back}}' }],
    css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
  },
  {
    id: 'model-cloze', root_deck_id: 'deck-root', anki_model_id: 2,
    name: 'Cloze', is_cloze: true,
    field_names: ['Text', 'Extra'],
    templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }],
    css: '.card { font-family: arial; font-size: 20px; text-align: left; } .cloze { font-weight: bold; color: #2563eb; }',
  },
  {
    id: 'model-io', root_deck_id: 'deck-root', anki_model_id: 3,
    name: 'Image Occlusion Enhanced', is_cloze: false,
    field_names: ['ID', 'Header', 'Image', 'Question Mask', 'Answer Mask', 'Remarks'],
    templates: [{ name: 'Card 1', qfmt: '{{Header}}<br>{{Image}}{{Question Mask}}', afmt: '{{Header}}<br>{{Image}}{{Answer Mask}}<br>{{Remarks}}' }],
    css: '.card { font-family: arial; font-size: 18px; text-align: center; } .io-occlusion-rect { fill: #ff8080; stroke: #000; }',
  },
];

/* ------------------------------------------------------------------ */
/* imported_notes + imported_cards                                     */
/*                                                                      */
/* Field arrays follow the ANKI_FIELD_SEP-split shape import-process    */
/* writes: fields[i] corresponds positionally to model.field_names[i]. */
/* ------------------------------------------------------------------ */

let _id = 0;
const nid = (prefix) => `${prefix}-${++_id}`;

function makeNote({ deckId, modelId, fields, tags = [], sortField }) {
  return {
    id: nid('note'), user_id: 'mock-user', root_deck_id: 'deck-root', model_id: modelId,
    anki_note_id: _id, anki_guid: `guid-${_id}`, fields, tags, sort_field: sortField || fields[0],
    _deckId: deckId, // mock-only convenience; real cards carry deck_id, not notes
  };
}

function makeCard({ note, deckId, state, dueAt, ord = 0, flag = 0 }) {
  return {
    id: nid('card'), user_id: 'mock-user', deck_id: deckId, note_id: note.id,
    anki_card_id: _id, template_ord: ord, state, due_at: dueAt ?? null, flag,
    model_id: note.model_id, // denormalized for the mock browse UI; real query joins via note
    tags: note.tags, fields: note.fields, sort_field: note.sort_field,
  };
}

const basicNote1 = makeNote({
  deckId: 'deck-arrhythmia', modelId: 'model-basic', tags: ['arrhythmia', 'high_yield'],
  fields: [
    'What is the first-line pharmacologic treatment for stable monomorphic ventricular tachycardia?',
    'IV <b>amiodarone</b><br><img src="vtach_strip.jpg">',
  ],
});
const basicNote2 = makeNote({
  deckId: 'deck-hf', modelId: 'model-basic', tags: ['heart_failure'],
  fields: [
    'Which medication class reduces mortality in HFrEF via aldosterone antagonism?',
    'Mineralocorticoid receptor antagonists (e.g. spironolactone) [sound:mra_pronunciation.mp3]',
  ],
});
// A card whose media reference points at a file that was never actually
// stored — exercises the "malformed/missing media" requirement.
const basicNoteMissingMedia = makeNote({
  deckId: 'deck-hf', modelId: 'model-basic', tags: ['heart_failure', 'imaging'],
  fields: [
    'CXR finding in acute decompensated HF: <img src="cxr_pulmonary_edema_MISSING.jpg">',
    'Kerley B lines, cephalization, perihilar batwing opacities',
  ],
});
const clozeNote1 = makeNote({
  deckId: 'deck-arrhythmia', modelId: 'model-cloze', tags: ['arrhythmia', 'ecg'],
  fields: [
    'In {{c1::Wolff-Parkinson-White}} syndrome, the ECG classically shows a {{c2::delta wave}} and a {{c3::short PR interval}}.',
    'Caused by an accessory pathway (bundle of Kent) bypassing the AV node.',
  ],
});
const clozeNote2 = makeNote({
  deckId: 'deck-neuro', modelId: 'model-cloze', tags: ['stroke'],
  fields: [
    'Occlusion of the {{c1::middle cerebral artery}} classically presents with {{c1::contralateral face/arm-predominant weakness}} and, if dominant hemisphere, {{c2::aphasia}}.',
    '',
  ],
});
const ioNote1 = makeNote({
  deckId: 'deck-neuro', modelId: 'model-io', tags: ['neuroanatomy', 'image_occlusion'],
  fields: [
    '1', 'Circle of Willis — identify the labeled structures',
    '<img src="circle_of_willis.jpg">',
    '<img src="circle_of_willis.jpg" class="io-question">',
    '<img src="circle_of_willis.jpg" class="io-answer">',
    'Anterior communicating, posterior communicating, basilar artery',
  ],
});

export const mockNotes = [basicNote1, basicNote2, basicNoteMissingMedia, clozeNote1, clozeNote2, ioNote1];

export const mockCards = [
  makeCard({ note: basicNote1, deckId: 'deck-arrhythmia', state: 'new' }),
  makeCard({ note: basicNote2, deckId: 'deck-hf', state: 'review', dueAt: hoursAgo(6) }),        // due now
  makeCard({ note: basicNoteMissingMedia, deckId: 'deck-hf', state: 'learning', dueAt: hoursFromNow(0.1) }),
  makeCard({ note: clozeNote1, deckId: 'deck-arrhythmia', state: 'review', dueAt: daysFromNow(3), ord: 0 }),
  makeCard({ note: clozeNote1, deckId: 'deck-arrhythmia', state: 'suspended', dueAt: daysFromNow(3), ord: 1 }),
  makeCard({ note: clozeNote2, deckId: 'deck-neuro', state: 'new', ord: 0 }),
  makeCard({ note: clozeNote2, deckId: 'deck-neuro', state: 'new', ord: 1 }),
  makeCard({ note: ioNote1, deckId: 'deck-neuro', state: 'review', dueAt: hoursAgo(1) }),         // due now
];

/* ------------------------------------------------------------------ */
/* imported_media — content-hash dedup, resolveMany() shape             */
/* ------------------------------------------------------------------ */

export const mockMedia = [
  { id: 'media-1', anki_filename: 'vtach_strip.jpg', content_type: 'image/jpeg', storage_provider: 'mock' },
  { id: 'media-2', anki_filename: 'mra_pronunciation.mp3', content_type: 'audio/mpeg', storage_provider: 'mock' },
  { id: 'media-3', anki_filename: 'circle_of_willis.jpg', content_type: 'image/jpeg', storage_provider: 'mock' },
  // Deliberately no 'cxr_pulmonary_edema_MISSING.jpg' — proves the
  // resolver/renderer degrade gracefully (Phase J4/K).
];

/**
 * Mimics MediaService.resolveMany()'s return shape: { filename: url|null }.
 * Uses tiny inline data: URI placeholders so the renderer has something
 * real to paint without needing network/storage access during UI dev.
 */
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#94a3b8"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" fill="#fff" text-anchor="middle" dy=".3em">mock image</text></svg>'
);

export function mockResolveMany(filenames) {
  const known = new Set(mockMedia.map(m => m.anki_filename));
  const out = {};
  for (const name of filenames) out[name] = known.has(name) ? PLACEHOLDER_IMG : null;
  return Promise.resolve(out);
}

/* ------------------------------------------------------------------ */
/* import_jobs — active / failed / completed                           */
/* ------------------------------------------------------------------ */

export const mockJobs = {
  active: {
    id: 'job-active', user_id: 'mock-user', status: 'importing_media',
    deck_id: 'deck-root', blob_url: 'https://mock.blob/deck.apkg',
    total_notes: 6496, notes_cursor: 6496, imported_notes: 6496,
    total_cards: 7043,
    total_media: 3314, media_cursor: 1820, imported_media: 1820,
    import_media: true, error_message: null, error_detail: null,
    created_at: hoursAgo(0.2), updated_at: hoursAgo(0.01), completed_at: null,
  },
  failed: {
    id: 'job-failed', user_id: 'mock-user', status: 'failed',
    deck_id: 'deck-root', blob_url: 'https://mock.blob/deck.apkg',
    total_notes: 6496, notes_cursor: 6496, imported_notes: 6496,
    total_cards: 7043,
    total_media: 3314, media_cursor: 150, imported_media: 150,
    import_media: true,
    error_message: 'Failed to record media: duplicate key value violates unique constraint "imported_media_dedup_idx" [code=23505, details=null, hint=null]',
    error_detail: { stack: 'Error: Failed to record media...' },
    created_at: hoursAgo(2), updated_at: hoursAgo(1.9), completed_at: null,
  },
  completed: {
    id: 'job-completed', user_id: 'mock-user', status: 'completed',
    deck_id: 'deck-small-root', blob_url: 'https://mock.blob/small-deck.apkg',
    total_notes: 3330, notes_cursor: 3330, imported_notes: 3330,
    total_cards: 3591,
    total_media: 562, media_cursor: 562, imported_media: 562,
    import_media: true, error_message: null, error_detail: null,
    created_at: hoursAgo(5), updated_at: hoursAgo(4.9), completed_at: hoursAgo(4.9),
  },
};

/* ------------------------------------------------------------------ */
/* helpers used by mock-backed UI components                           */
/* ------------------------------------------------------------------ */

export function childDecksOf(parentId) {
  return mockDecks.filter(d => d.parent_id === parentId && !d.archived);
}

export function rootDecks() {
  return mockDecks.filter(d => d.parent_id === null && !d.archived);
}

/** Mirrors api.browseCards()'s { rows, total } shape, filtered client-side
 *  over the small mock set — the real implementation paginates server-side. */
export function browseCards({ deckId, search, state, tag, flag, page = 0, pageSize = 50 } = {}) {
  let rows = mockCards;
  if (deckId) rows = rows.filter(c => c.deck_id === deckId);
  if (state) rows = rows.filter(c => c.state === state);
  if (tag) rows = rows.filter(c => (c.tags || []).includes(tag));
  if (flag != null) rows = rows.filter(c => (c.flag || 0) === flag);
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(c => (c.sort_field || '').toLowerCase().includes(q));
  }
  const total = rows.length;
  const start = page * pageSize;
  return Promise.resolve({ rows: rows.slice(start, start + pageSize), total });
}

/** Mirrors api.getSessionCards() — due first, then new, same ordering
 *  buildSessionQuery() specifies, just applied in-memory over mock cards. */
export function sessionCards(deckIds, limit = 50) {
  const nowMs = Date.now();
  const inScope = mockCards.filter(c => !deckIds || deckIds.includes(c.deck_id));
  const eligible = inScope.filter(c =>
    c.state !== 'suspended' && (c.state === 'new' || (c.due_at && new Date(c.due_at).getTime() <= nowMs))
  );
  const due = eligible.filter(c => c.state !== 'new')
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const fresh = eligible.filter(c => c.state === 'new');
  return Promise.resolve([...due, ...fresh].slice(0, limit));
}

const mock = {
  decks: mockDecks, models: mockModels, notes: mockNotes, cards: mockCards, media: mockMedia,
  jobs: mockJobs, childDecksOf, rootDecks, browseCards, sessionCards, resolveMany: mockResolveMany,
};

export default mock;
