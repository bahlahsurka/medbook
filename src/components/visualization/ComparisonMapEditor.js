// components/visualization/ComparisonMapEditor.js
//
// Edit-mode counterpart to ComparisonMapRenderer.js — a purpose-built
// editing UI for Comparison Map's own subject x dimension grid shape, NOT
// a graph editor (per the brief's own "use editing controls appropriate
// to each format" instruction). Shown instead of the read-only renderer
// (never alongside) while editing is active. Text inputs are
// uncontrolled (defaultValue + onBlur-commit) for the same reason
// EditableDiagramDetailPanel.js's are — see that file's header.
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';
import {
  updateTopic, updateSubjectLabel, addSubject, deleteSubject,
  updateDimensionLabel, addDimension, deleteDimension, moveDimension,
  upsertCell, deleteCell,
} from './comparisonMapEdits';

function cellKey(subjectId, dimensionId) { return `${subjectId}\u0000${dimensionId}`; }

function textInputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box', background: t.surface2, border: `1px solid ${t.borderStrong}`,
    borderRadius: RADIUS.sm, color: t.text, padding: '6px 8px', fontSize: FONT.size.xs,
    fontFamily: 'Inter,sans-serif', outline: 'none',
  };
}
function smallButtonStyle(t, variant = 'default') {
  const danger = variant === 'danger';
  return {
    background: danger ? t.dangerBg : t.surface2, border: `1px solid ${danger ? t.dangerBorder : t.border}`,
    color: danger ? t.danger : t.text3, borderRadius: RADIUS.sm, padding: '4px 7px',
    fontSize: FONT.size.micro, fontWeight: FONT.weight.semibold, cursor: 'pointer',
    fontFamily: 'Inter,sans-serif', minHeight: 26, lineHeight: 1,
  };
}
function addButtonStyle(t) {
  return {
    background: t.navActiveBg, border: `1px solid ${t.navActiveBorder}`, color: t.navActiveText,
    borderRadius: RADIUS.sm, padding: '8px 14px', fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold,
    cursor: 'pointer', fontFamily: 'Inter,sans-serif', minHeight: 34,
  };
}

/** @param {{diagram:object, onDraftChange:(next:object)=>void}} props */
export default function ComparisonMapEditor({ diagram, onDraftChange }) {
  const { t } = useTheme();
  const subjects = diagram?.subjects || [];
  const dimensions = diagram?.dimensions || [];
  const cellByKey = new Map((diagram?.cells || []).map(c => [cellKey(c.subjectId, c.dimensionId), c]));

  const headerCellStyle = {
    background: t.surface2, padding: '8px 10px', borderBottom: `2px solid ${t.borderStrong}`, borderLeft: `1px solid ${t.border}`,
    minWidth: 160, verticalAlign: 'top', fontFamily: 'Inter,sans-serif',
  };
  const rowHeaderCellStyle = {
    background: t.surface2, padding: '8px 10px', borderRight: `2px solid ${t.borderStrong}`, borderBottom: `1px solid ${t.border}`,
    minWidth: 140, maxWidth: 190, verticalAlign: 'top', fontFamily: 'Inter,sans-serif',
  };

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: SPACE.md, boxSizing: 'border-box' }}>
      <label style={{ fontSize: FONT.size.micro, color: t.text4, fontWeight: FONT.weight.semibold, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Topic</label>
      <input key={`topic-${diagram?.topic}`} style={{ ...textInputStyle(t), marginBottom: SPACE.md, fontWeight: FONT.weight.bold, fontSize: FONT.size.sm }}
        defaultValue={diagram?.topic || ''} onBlur={e => { if (e.target.value.trim() && e.target.value !== diagram.topic) onDraftChange(updateTopic(diagram, e.target.value.trim())); }} maxLength={120} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...headerCellStyle, borderLeft: 'none' }} />
              {subjects.map(s => (
                <th key={s.id} style={headerCellStyle}>
                  <input key={`subj-${s.id}`} style={{ ...textInputStyle(t), marginBottom: 6 }} defaultValue={s.label}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== s.label) onDraftChange(updateSubjectLabel(diagram, s.id, e.target.value.trim())); }} maxLength={80} />
                  <button onClick={() => onDraftChange(deleteSubject(diagram, s.id))} style={smallButtonStyle(t, 'danger')}>🗑 Remove subject</button>
                </th>
              ))}
              <th style={headerCellStyle}>
                <button onClick={() => onDraftChange(addSubject(diagram).diagram)} style={addButtonStyle(t)}>+ Add subject</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((d, dIdx) => (
              <tr key={d.id}>
                <th style={rowHeaderCellStyle}>
                  <input key={`dim-${d.id}`} style={{ ...textInputStyle(t), marginBottom: 6 }} defaultValue={d.label}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== d.label) onDraftChange(updateDimensionLabel(diagram, d.id, e.target.value.trim())); }} maxLength={80} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button disabled={dIdx === 0} onClick={() => onDraftChange(moveDimension(diagram, d.id, 'up'))} style={{ ...smallButtonStyle(t), opacity: dIdx === 0 ? 0.4 : 1 }} title="Move up">↑</button>
                    <button disabled={dIdx === dimensions.length - 1} onClick={() => onDraftChange(moveDimension(diagram, d.id, 'down'))} style={{ ...smallButtonStyle(t), opacity: dIdx === dimensions.length - 1 ? 0.4 : 1 }} title="Move down">↓</button>
                    <button onClick={() => onDraftChange(deleteDimension(diagram, d.id))} style={smallButtonStyle(t, 'danger')}>🗑</button>
                  </div>
                </th>
                {subjects.map(s => {
                  const cell = cellByKey.get(cellKey(s.id, d.id));
                  return (
                    <td key={s.id} style={{ padding: '8px 10px', borderBottom: `1px solid ${t.border}`, borderLeft: `1px solid ${t.border}`, verticalAlign: 'top' }}>
                      {cell ? (
                        <>
                          <textarea key={`cell-${s.id}-${d.id}`} rows={2} style={{ ...textInputStyle(t), marginBottom: 5, resize: 'vertical', lineHeight: 1.4 }}
                            defaultValue={cell.value}
                            onBlur={e => {
                              const value = e.target.value.trim();
                              if (value === cell.value) return;
                              if (!value) onDraftChange(deleteCell(diagram, s.id, d.id));
                              else onDraftChange(upsertCell(diagram, s.id, d.id, { value }));
                            }}
                            maxLength={300} />
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: FONT.size.micro, color: t.text3, marginBottom: 5 }}>
                            <input type="checkbox" checked={!!cell.distinguishing}
                              onChange={e => onDraftChange(upsertCell(diagram, s.id, d.id, { distinguishing: e.target.checked }))} />
                            Distinguishing
                          </label>
                          <button onClick={() => onDraftChange(deleteCell(diagram, s.id, d.id))} style={smallButtonStyle(t, 'danger')}>Clear</button>
                        </>
                      ) : (
                        <button onClick={() => onDraftChange(upsertCell(diagram, s.id, d.id, {}))} style={smallButtonStyle(t)}>+ Add detail</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => onDraftChange(addDimension(diagram).diagram)} style={{ ...addButtonStyle(t), marginTop: SPACE.sm }}>+ Add dimension</button>
    </div>
  );
}
