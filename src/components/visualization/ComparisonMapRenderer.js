// components/visualization/ComparisonMapRenderer.js
//
// Purpose-built React grid for Comparison Map — no React Flow, no layout
// engine, per the brief's explicit allowance for Comparison Map/Visual
// Summary to use "purpose-built React layouts instead of graph rendering".
// Subjects are columns, dimensions are rows; the header row and first
// column stay sticky so a long grid can scroll both ways on a small
// screen without losing context of what's being compared. Same default-
// export-with-internal-fullscreen-state shape as every other renderer
// (MindMapRenderer.js etc.) so VisualLearningPanel.js's lazy-loading
// wiring treats all six types identically.
import { useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../../lib/theme';
import DiagramDetailPanel from './DiagramDetailPanel';

function cellKey(subjectId, dimensionId) { return `${subjectId}\u0000${dimensionId}`; }

function fullscreenButtonStyle(t) {
  return {
    background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.sm,
    color: t.text3, fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold,
    fontFamily: 'Inter,sans-serif', padding: '8px 12px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', minHeight: 34,
  };
}

function ComparisonMapGrid({ diagram, isFullscreen, onToggleFullscreen }) {
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

  const headerCellStyle = {
    position: 'sticky', top: 0, zIndex: 2, background: t.surface2, color: t.text,
    fontWeight: FONT.weight.bold, fontSize: FONT.size.sm, padding: '10px 14px',
    borderBottom: `2px solid ${t.borderStrong}`, borderLeft: `1px solid ${t.border}`,
    textAlign: 'left', minWidth: 160, fontFamily: 'Inter,sans-serif',
  };
  const rowHeaderCellStyle = {
    position: 'sticky', left: 0, zIndex: 1, background: t.surface2, color: t.text2,
    fontWeight: FONT.weight.semibold, fontSize: FONT.size.xs, padding: '10px 14px',
    borderRight: `2px solid ${t.borderStrong}`, borderBottom: `1px solid ${t.border}`,
    textAlign: 'left', minWidth: 140, maxWidth: 200, fontFamily: 'Inter,sans-serif',
    verticalAlign: 'top',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', top: SPACE.sm, right: SPACE.sm, zIndex: 5 }}>
        <button style={fullscreenButtonStyle(t)} onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '⤡ Exit' : '⤢ Fullscreen'}
        </button>
      </div>
      <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...headerCellStyle, left: 0, position: 'sticky', zIndex: 3, borderLeft: 'none' }}>
                {diagram?.topic || 'Comparison'}
              </th>
              {subjects.map(s => (
                <th key={s.id} style={headerCellStyle}>
                  {s.label}
                  {s.sourceType === 'ai_context' && (
                    <span style={{ marginLeft: 6, fontSize: FONT.size.micro, fontWeight: FONT.weight.regular, color: t.text4 }}>(context)</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dimensions.map(d => (
              <tr key={d.id}>
                <th style={rowHeaderCellStyle}>{d.label}</th>
                {subjects.map(s => {
                  const key = cellKey(s.id, d.id);
                  const cell = cellByKey.get(key);
                  const isSelected = selectedKey === key;
                  return (
                    <td
                      key={s.id}
                      role={cell ? 'button' : undefined}
                      tabIndex={cell ? 0 : undefined}
                      onClick={cell ? () => setSelectedKey(prev => (prev === key ? null : key)) : undefined}
                      style={{
                        padding: '10px 14px', borderBottom: `1px solid ${t.border}`, borderLeft: `1px solid ${t.border}`,
                        fontSize: FONT.size.xs, lineHeight: 1.5, fontFamily: 'Inter,sans-serif', verticalAlign: 'top',
                        cursor: cell ? 'pointer' : 'default', wordBreak: 'break-word',
                        color: cell ? (cell.distinguishing ? t.text : t.text2) : t.text4,
                        fontWeight: cell?.distinguishing ? FONT.weight.semibold : FONT.weight.regular,
                        background: isSelected ? (isDark ? 'rgba(59,130,246,0.14)' : t.navActiveBg)
                          : cell?.distinguishing ? (isDark ? 'rgba(217,119,6,0.08)' : t.warnBg) : 'transparent',
                        boxShadow: isSelected ? `inset 0 0 0 2px ${t.accent}` : 'none',
                        fontStyle: cell ? 'normal' : 'italic',
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
      </div>
      <DiagramDetailPanel node={selectedNode} onClose={() => setSelectedKey(null)} />
    </div>
  );
}

/** @param {{diagram:{topic,subjects,dimensions,cells}}} props — a validated Comparison Map diagram. */
export default function ComparisonMapRenderer({ diagram }) {
  const { t } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);
  const grid = <ComparisonMapGrid diagram={diagram} isFullscreen={isFullscreen} onToggleFullscreen={() => setFullscreen(f => !f)} />;

  if (!isFullscreen) {
    return (
      <div style={{ width: '100%', height: 'clamp(320px, 65vh, 480px)', borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {grid}
      </div>
    );
  }
  return <div style={{ position: 'fixed', inset: 0, zIndex: Z.lightbox, background: t.appBg }}>{grid}</div>;
}
