import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme';
import DiagramDetailPanel from '../components/visualization/DiagramDetailPanel';
import KeyPointsContent from '../components/KeyPointsContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (el) => act(() => { root.render(<ThemeProvider>{el}</ThemeProvider>); });

test('detail box: the name as heading and its explanation as subtext — nothing else', () => {
  render(<DiagramDetailPanel onClose={() => {}} node={{
    label: 'Airway compromise', category: 'red_flag', explanation: 'Swelling can narrow the airway.',
    sourceType: 'ai_context', sourceRef: 'swelling can narrow the airway',
    connections: { out: [{ rel: 'can lead to', other: 'Stridor' }], inc: [] },
  }} />);
  const text = container.textContent.replace('✕', '');
  expect(text).toBe('Airway compromiseSwelling can narrow the airway.');
});

test('an explanation that only repeats the title is not shown twice', () => {
  render(<DiagramDetailPanel onClose={() => {}} node={{ label: 'Fever', explanation: 'Fever.', category: 'manifestation', sourceType: 'entry' }} />);
  expect(container.textContent.match(/Fever/g)).toHaveLength(1);
});

test('Key Points show the bullets without any "potential issues" warning', () => {
  render(<KeyPointsContent sections={[{ heading: 'Red flags', bullets: [{ text: 'Stridor: impending airway loss', emphasis: 'red_flag' }] }]}
    fidelityWarnings={['A number may be missing']} fidelityDisclaimer="Heuristic only." />);
  expect(container.textContent).toContain('impending airway loss');
  expect(container.textContent).not.toMatch(/potential issue|Heuristic only|number may be missing/i);
});
