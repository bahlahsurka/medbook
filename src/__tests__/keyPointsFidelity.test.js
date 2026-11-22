// Practical, no-extra-AI-call source-fidelity checks for Key Points — see
// keyPointsFidelity.js's own header for what this is and isn't (heuristic
// text/number matching, never a correctness guarantee).
import { checkKeyPointsFidelity, KEY_POINTS_FIDELITY_DISCLAIMER } from '../services/ai/keyPointsFidelity';

const NOTES = 'Severe hyperthermia above 41.1C with rigidity is a medical emergency requiring aggressive cooling. ' +
  'Cyproheptadine 12mg is given for moderate-severe cases. Treatment is usually supportive.';

function kpWith(sections) {
  return { topic: 'Test', sections };
}

describe('checkKeyPointsFidelity — a faithful summary flags nothing', () => {
  test('bullets that cover the numbers, urgency language, and are well-sourced produce no warnings', () => {
    const kp = kpWith([{
      heading: 'Management',
      bullets: [
        { text: 'Severe hyperthermia above 41.1C with rigidity is a medical emergency needing aggressive cooling', emphasis: 'red_flag', sourceRef: 'Severe hyperthermia above 41.1C with rigidity is a medical emergency requiring aggressive cooling' },
        { text: 'Cyproheptadine 12mg is given for moderate-severe cases', emphasis: 'normal', sourceRef: 'Cyproheptadine 12mg is given for moderate-severe cases' },
      ],
    }]);
    const { warnings, disclaimer } = checkKeyPointsFidelity(NOTES, kp);
    expect(warnings).toEqual([]);
    expect(disclaimer).toBe(KEY_POINTS_FIDELITY_DISCLAIMER);
  });
});

describe('checkKeyPointsFidelity — missing numerics', () => {
  test('flags a clinically-significant number from the source absent from every bullet', () => {
    const kp = kpWith([{
      heading: 'Management',
      bullets: [{ text: 'Cyproheptadine is given for moderate-severe cases', emphasis: 'normal', sourceRef: 'Cyproheptadine is given for moderate-severe cases' }],
    }]);
    const { warnings } = checkKeyPointsFidelity(NOTES, kp);
    expect(warnings.some(w => /missing from key points/i.test(w) && w.includes('12'))).toBe(true);
  });
});

describe('checkKeyPointsFidelity — altered/unsourced numerics', () => {
  test('flags a bullet number that does not appear anywhere in the original notes', () => {
    const kp = kpWith([{
      heading: 'Management',
      bullets: [{ text: 'Cyproheptadine 20mg is given for moderate-severe cases', emphasis: 'normal', sourceRef: 'Cyproheptadine 12mg is given for moderate-severe cases' }],
    }]);
    const { warnings } = checkKeyPointsFidelity(NOTES, kp);
    expect(warnings.some(w => /altered or added/i.test(w) && w.includes('20mg'))).toBe(true);
  });
});

describe('checkKeyPointsFidelity — missing urgent findings', () => {
  test('flags an urgency-sounding clause in the source with no overlapping bullet', () => {
    const notesWithUrgency = 'This is a stable, routine follow-up visit with no acute issues. ' +
      'Sudden hypotension and septic shock require immediate escalation and emergency care.';
    const kp = kpWith([{
      heading: 'Visit summary',
      bullets: [{ text: 'Routine, stable follow-up visit', emphasis: 'normal', sourceRef: 'stable, routine follow-up visit' }],
    }]);
    const { warnings } = checkKeyPointsFidelity(notesWithUrgency, kp);
    expect(warnings.some(w => /urgent or safety-related/i.test(w))).toBe(true);
  });
});

describe('checkKeyPointsFidelity — unsourced bullets', () => {
  test('flags a bullet whose cited sourceRef barely overlaps the actual notes', () => {
    const kp = kpWith([{
      heading: 'Management',
      bullets: [{ text: 'A completely unrelated made-up claim', emphasis: 'normal', sourceRef: 'something about zebras and unrelated topics never mentioned' }],
    }]);
    const { warnings } = checkKeyPointsFidelity(NOTES, kp);
    expect(warnings.some(w => /doesn't clearly match/i.test(w))).toBe(true);
  });
});

describe('checkKeyPointsFidelity — caps output', () => {
  test('never returns more than 8 warnings even with a very discrepant summary', () => {
    const manyNotes = Array.from({ length: 20 }, (_, i) => `The dose is ${i + 1}mg given over ${i + 2} hours for this specific finding.`).join(' ');
    const kp = kpWith([{ heading: 'Summary', bullets: [{ text: 'Generic summary with no numbers', emphasis: 'normal', sourceRef: 'no overlap at all here' }] }]);
    const { warnings } = checkKeyPointsFidelity(manyNotes, kp);
    expect(warnings.length).toBeLessThanOrEqual(8);
  });
});
