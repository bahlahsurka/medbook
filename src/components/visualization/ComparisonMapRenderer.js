// components/visualization/ComparisonMapRenderer.js
//
// Comparison Map: a purpose-built comparison grid (no React Flow). Subjects
// are columns (each topped with an accent rule), features are rows; the
// header row and feature column stay sticky so a wide grid can scroll on a
// phone without losing context. Key differences are marked by weight and a
// left bar (not a fill), so they scan quickly in both themes; cells the
// source doesn't address say so rather than inventing content.
import { useState } from 'react';
import { useTheme, FONT } from '../../lib/theme';
import DiagramDetailPanel from './DiagramDetailPanel';
import ContentDiagramFrame from './ContentDiagramFrame';

function cellKey(subjectId, dimensionId) { return `${subjectId}\u0000${dimensionId}`; }

function DifferenceLegend({ t }) {
  return (
    <span className="mb-viz-legend-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: FONT.size.micro, color: t.text3, whiteSpace: 'nowrap', fontFamily: 'Inter,sans-serif' }}>
      <span style={{ width: 3, height: 12, borderRadius: 2, background: t.warn }} /> Key difference
    </span>
  );
}

/** @param {{diagram:{topic,subjects,dimensions,cells}}} props — a validated Comparison Map diagram. */
export default function ComparisonMapRenderer({ diagram }) {
  const { t, isDark } = useTheme();
  const [selectedKey, setSelectedKey] = useState(null);

  const subjects = diagram?.subjects || [];
  const dimensions = diagram?.dimensions || [];
  const cellByKey = new Map((diagram?.cells || []).map(c => [cellKey(c.subjectId, c.dimensionId), c]));

  const selected = selectedKey ? cellByKey.get(selectedKey) : null;
  const selectedSubject = selected ? subjects.find(s => s.id === selected.subjectId) : null;
  const selectedDimension = selected ? dimensions.find(d => d.id === selected.dimensionId) : null;
  const selectedNode = selected ? {
    label: `${selectedSubject?.label || ''} — ${selectedDimension?.label || ''}`,
    explanation: selected.value,
    sourceType: selected.sourceType,
    sourceRef: selected.sourceRef,
  } : null;

  const stripe = isDark ? 'rgba(255,255,255,0.018)' : 'rgba(15,23,42,0.018)';
  const featureCol = { position: 'sticky', left: 0, zIndex: 1, background: t.surface2, boxShadow: `inset -1px 0 0 ${t.border}` };

  return (
    <ContentDiagramFrame
      title={diagram?.topic || 'Comparison'}
      legend={<DifferenceLegend t={t} />}
      overlay={<DiagramDetailPanel node={selectedNode} onClose={() => setSelectedKey(null)} />}
    >
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 140 + subjects.length * 150, tableLayout: 'fixed', fontFamily: 'Inter,sans-serif' }}>
        <colgroup>
          <col style={{ width: 'clamp(120px, 24%, 190px)' }} />
          {subjects.map(s => <col key={s.id} />)}
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...featureCol, top: 0, zIndex: 3, position: 'sticky', textAlign: 'left', padding: '10px 12px',
              fontSize: FONT.size.micro, fontWeight: FONT.weight.semibold, color: t.text4, textTransform: 'uppercase', letterSpacing: .6,
              borderBottom: `1px solid ${t.borderStrong}` }}>
              Feature
            </th>
            {subjects.map(s => (
              <th key={s.id} style={{ position: 'sticky', top: 0, zIndex: 2, background: t.surface, textAlign: 'left', verticalAlign: 'bottom',
                padding: '10px 12px', fontSize: FONT.size.sm, fontWeight: FONT.weight.bold, color: t.text, lineHeight: 1.3,
                borderTop: `3px solid ${t.accent}`, borderBottom: `1px solid ${t.borderStrong}`, boxShadow: `inset 1px 0 0 ${t.border}` }}>
                {s.label}
                {s.sourceType === 'ai_context' && (
                  <span style={{ display: 'block', marginTop: 2, fontSize: FONT.size.micro, fontWeight: FONT.weight.regular, color: t.text4 }}>supplementary context</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dimensions.map((d, row) => (
            <tr key={d.id} style={{ background: row % 2 ? stripe : 'transparent' }}>
              <th scope="row" style={{ ...featureCol, textAlign: 'left', verticalAlign: 'top', padding: '10px 12px',
                fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, color: t.text2, lineHeight: 1.45, borderBottom: `1px solid ${t.border}` }}>
                {d.label}
              </th>
              {subjects.map(s => {
                const key = cellKey(s.id, d.id);
                const cell = cellByKey.get(key);
                const isSelected = selectedKey === key;
                const differs = !!cell?.distinguishing;
                return (
                  <td
                    key={s.id}
                    role={cell ? 'button' : undefined}
                    tabIndex={cell ? 0 : undefined}
                    onClick={cell ? () => setSelectedKey(prev => (prev === key ? null : key)) : undefined}
                    onKeyDown={cell ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(prev => (prev === key ? null : key)); } } : undefined}
                    style={{
                      padding: '10px 12px', verticalAlign: 'top', lineHeight: 1.5, overflowWrap: 'anywhere',
                      fontSize: FONT.size.xs, cursor: cell ? 'pointer' : 'default',
                      color: !cell ? t.text4 : differs ? t.text : t.text2,
                      fontWeight: differs ? FONT.weight.semibold : FONT.weight.regular,
                      fontStyle: cell ? 'normal' : 'italic',
                      borderBottom: `1px solid ${t.border}`,
                      background: isSelected ? t.navActiveBg : 'transparent',
                      boxShadow: [`inset 1px 0 0 ${t.border}`, differs ? `inset 3px 0 0 ${t.warn}` : null, isSelected ? `inset 0 0 0 2px ${t.accent}` : null].filter(Boolean).join(', '),
                      transition: 'background 120ms ease',
                    }}
                  >
                    {cell ? cell.value : 'Not addressed in source'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ContentDiagramFrame>
  );
}
