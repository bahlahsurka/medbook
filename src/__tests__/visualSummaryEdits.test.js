import { updateHighlight, addHighlight, deleteHighlight, moveHighlight } from '../components/visualization/visualSummaryEdits';

function baseDiagram() {
  return {
    topic: 'Test',
    highlights: [
      { id: 'h1', headline: 'One', detail: 'x', importance: 'high', category: 'key_fact', sourceType: 'entry', sourceRef: 'y' },
      { id: 'h2', headline: 'Two', detail: 'x', importance: 'standard', category: 'pearl', sourceType: 'entry', sourceRef: 'y' },
    ],
  };
}

describe('addHighlight', () => {
  test('appends a new highlight with a unique id and user_added provenance', () => {
    const { diagram: next, id } = addHighlight(baseDiagram());
    expect(next.highlights).toHaveLength(3);
    const added = next.highlights.find(h => h.id === id);
    expect(added.sourceType).toBe('user_added');
  });
});

describe('updateHighlight', () => {
  test('patches only the targeted highlight', () => {
    const next = updateHighlight(baseDiagram(), 'h1', { headline: 'Renamed' });
    expect(next.highlights.find(h => h.id === 'h1').headline).toBe('Renamed');
    expect(next.highlights.find(h => h.id === 'h2').headline).toBe('Two');
  });
});

describe('deleteHighlight', () => {
  test('removes exactly that highlight', () => {
    const next = deleteHighlight(baseDiagram(), 'h1');
    expect(next.highlights.map(h => h.id)).toEqual(['h2']);
  });
});

describe('moveHighlight', () => {
  test('swaps order with its up/down neighbor', () => {
    const down = moveHighlight(baseDiagram(), 'h1', 'down');
    expect(down.highlights.map(h => h.id)).toEqual(['h2', 'h1']);
  });

  test('is a no-op past either edge', () => {
    const d = baseDiagram();
    expect(moveHighlight(d, 'h1', 'up').highlights.map(h => h.id)).toEqual(['h1', 'h2']);
    expect(moveHighlight(d, 'h2', 'down').highlights.map(h => h.id)).toEqual(['h1', 'h2']);
  });
});
