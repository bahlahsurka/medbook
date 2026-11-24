import { getSavedKeyPoints, isKeyPointsStale, splitLeadTerm } from '../lib/keyPoints';
import { hasKeyPoints } from '../components/ReviewKeyPoints';
import { normalizeSections } from '../services/ai';

const NEW_KP = {
  content: {
    topic: 'Serotonin syndrome',
    sections: [
      { heading: 'Recognition', bullets: [
        { text: 'Triad: autonomic instability, neuromuscular findings, altered mental status', emphasis: 'high_yield', sourceRef: 'x' },
        { text: 'Hyperthermia >41.1C with rigidity is an emergency', emphasis: 'red_flag', sourceRef: 'y' },
      ] },
    ],
  },
  generatedAt: '2026-11-20T10:00:00Z', model: 'openai/gpt-oss-20b', sourceNotesLength: 120,
  fidelityWarnings: ['A number may be missing'], fidelityDisclaimer: 'Heuristic only.',
};

describe('getSavedKeyPoints', () => {
  test('returns the new-format Key Points in a render-safe shape', () => {
    const out = getSavedKeyPoints({ keyPoints: NEW_KP });
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].heading).toBe('Recognition');
    expect(out.sections[0].bullets.map(b => b.emphasis)).toEqual(['high_yield', 'red_flag']);
    expect(out.fidelityWarnings).toEqual(['A number may be missing']);
    expect(out.sourceNotesLength).toBe(120);
  });

  test('returns null for legacy-only, empty, and missing ai_sections', () => {
    expect(getSavedKeyPoints({ keyLearningPoints: ['a'], redFlags: ['b'] })).toBeNull();
    expect(getSavedKeyPoints(null)).toBeNull();
    expect(getSavedKeyPoints(undefined)).toBeNull();
    expect(getSavedKeyPoints({ keyPoints: { content: { topic: 'x', sections: [] } } })).toBeNull();
    expect(getSavedKeyPoints({ keyPoints: null })).toBeNull();
  });

  test('drops malformed sections/bullets and normalizes unknown emphasis instead of throwing', () => {
    const out = getSavedKeyPoints({ keyPoints: { content: { sections: [
      null,
      { heading: 'Empty', bullets: [] },
      { heading: 'Mixed', bullets: [{ text: '  ok  ', emphasis: 'weird' }, { text: '' }, { nope: 1 }, 'str'] },
    ] } } });
    expect(out.sections).toEqual([{ heading: 'Mixed', bullets: [{ text: 'ok', emphasis: 'normal' }] }]);
  });
});

describe('hasKeyPoints (new two-argument form)', () => {
  test('a Key-Points-only entry now has something to show in review', () => {
    const aiSections = { keyPoints: NEW_KP };
    expect(hasKeyPoints(normalizeSections(aiSections), getSavedKeyPoints(aiSections))).toBe(true);
  });

  test('legacy-only entries still qualify via the fallback', () => {
    const aiSections = { highYield: ['Fact'] };
    expect(hasKeyPoints(normalizeSections(aiSections), getSavedKeyPoints(aiSections))).toBe(true);
  });

  test('entries with neither show nothing', () => {
    expect(hasKeyPoints(normalizeSections(null), getSavedKeyPoints(null))).toBe(false);
  });
});

describe('isKeyPointsStale', () => {
  const saved = getSavedKeyPoints({ keyPoints: NEW_KP });
  test('flags a notes-length change since generation', () => {
    expect(isKeyPointsStale(saved, 'x'.repeat(121))).toBe(true);
    expect(isKeyPointsStale(saved, 'x'.repeat(120))).toBe(false);
  });
  test('never flags when there is no length recorded', () => {
    expect(isKeyPointsStale({ ...saved, sourceNotesLength: null }, 'anything')).toBe(false);
    expect(isKeyPointsStale(null, 'anything')).toBe(false);
  });
});

describe('splitLeadTerm', () => {
  test('splits a short "Term: explanation" label', () => {
    expect(splitLeadTerm('Triad: autonomic instability')).toEqual({ lead: 'Triad', rest: 'autonomic instability' });
    expect(splitLeadTerm('First-line treatment: cyproheptadine 12mg')).toEqual({ lead: 'First-line treatment', rest: 'cyproheptadine 12mg' });
  });
  test('leaves ordinary sentences and long labels alone', () => {
    const sentence = 'Treatment is usually supportive. Note: escalate if worsening';
    expect(splitLeadTerm(sentence)).toEqual({ lead: '', rest: sentence });
    const long = 'This is a much longer opening clause that keeps going: and then more';
    expect(splitLeadTerm(long)).toEqual({ lead: '', rest: long });
    expect(splitLeadTerm('No colon here')).toEqual({ lead: '', rest: 'No colon here' });
    expect(splitLeadTerm('Ratio 2:1 is normal')).toEqual({ lead: '', rest: 'Ratio 2:1 is normal' });
  });
});
