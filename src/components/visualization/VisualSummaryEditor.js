// components/visualization/VisualSummaryEditor.js
//
// Edit-mode counterpart to VisualSummaryRenderer.js — a purpose-built
// editing UI for Visual Summary's own flat highlight-list shape, NOT a
// graph editor (per the brief's "use editing controls appropriate to each
// format" instruction). Shown instead of the read-only renderer (never
// alongside) while editing is active. Text inputs are uncontrolled
// (defaultValue + onBlur-commit) for the same reason
// EditableDiagramDetailPanel.js's are — see that file's header.
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';
import { updateTopic, updateHighlight, addHighlight, deleteHighlight, moveHighlight } from './visualSummaryEdits';

// Client-safe duplicate of VisualSummaryPromptBuilder.js's own enums — NOT
// imported from that server-only module, same reasoning graphCategories.js
// documents: it would drag that file's large system-instruction prompt
// string into the client bundle just to read two short arrays.
const IMPORTANCE_OPTIONS = ['critical', 'high', 'standard'];
const CATEGORY_OPTIONS = ['red_flag', 'key_fact', 'number', 'pearl'];

function textInputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box', background: t.surface2, border: `1px solid ${t.borderStrong}`,
    borderRadius: RADIUS.sm, color: t.text, padding: '7px 9px', fontSize: FONT.size.xs,
    fontFamily: 'Inter,sans-serif', outline: 'none',
  };
}
function smallButtonStyle(t, variant = 'default') {
  const danger = variant === 'danger';
  return {
    background: danger ? t.dangerBg : t.surface2, border: `1px solid ${danger ? t.dangerBorder : t.border}`,
    color: danger ? t.danger : t.text3, borderRadius: RADIUS.sm, padding: '5px 9px',
    fontSize: FONT.size.micro, fontWeight: FONT.weight.semibold, cursor: 'pointer',
    fontFamily: 'Inter,sans-serif', minHeight: 28,
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
export default function VisualSummaryEditor({ diagram, onDraftChange }) {
  const { t } = useTheme();
  const highlights = diagram?.highlights || [];

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: SPACE.md, boxSizing: 'border-box' }}>
      <label style={{ fontSize: FONT.size.micro, color: t.text4, fontWeight: FONT.weight.semibold, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Topic</label>
      <input key={`topic-${diagram?.topic}`} style={{ ...textInputStyle(t), marginBottom: SPACE.md, fontWeight: FONT.weight.bold, fontSize: FONT.size.sm }}
        defaultValue={diagram?.topic || ''} onBlur={e => { if (e.target.value.trim() && e.target.value !== diagram.topic) onDraftChange(updateTopic(diagram, e.target.value.trim())); }} maxLength={120} />

      {highlights.map((h, i) => (
        <div key={h.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, padding: SPACE.sm, marginBottom: SPACE.sm }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button disabled={i === 0} onClick={() => onDraftChange(moveHighlight(diagram, h.id, 'up'))} style={{ ...smallButtonStyle(t), opacity: i === 0 ? 0.4 : 1 }} title="Move up">↑</button>
              <button disabled={i === highlights.length - 1} onClick={() => onDraftChange(moveHighlight(diagram, h.id, 'down'))} style={{ ...smallButtonStyle(t), opacity: i === highlights.length - 1 ? 0.4 : 1 }} title="Move down">↓</button>
            </div>
            <button onClick={() => onDraftChange(deleteHighlight(diagram, h.id))} style={smallButtonStyle(t, 'danger')}>🗑 Remove</button>
          </div>

          <input key={`headline-${h.id}`} style={{ ...textInputStyle(t), marginBottom: 6, fontWeight: FONT.weight.bold }}
            defaultValue={h.headline} placeholder="Headline"
            onBlur={e => { if (e.target.value.trim() && e.target.value !== h.headline) onDraftChange(updateHighlight(diagram, h.id, { headline: e.target.value.trim() })); }} maxLength={120} />

          <textarea key={`detail-${h.id}`} rows={2} style={{ ...textInputStyle(t), marginBottom: 6, resize: 'vertical', lineHeight: 1.5 }}
            defaultValue={h.detail} placeholder="Supporting detail"
            onBlur={e => { if (e.target.value !== h.detail) onDraftChange(updateHighlight(diagram, h.id, { detail: e.target.value })); }} maxLength={400} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <select style={{ ...textInputStyle(t), width: 'auto', cursor: 'pointer' }} value={h.importance}
              onChange={e => onDraftChange(updateHighlight(diagram, h.id, { importance: e.target.value }))}>
              {IMPORTANCE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select style={{ ...textInputStyle(t), width: 'auto', cursor: 'pointer' }} value={h.category}
              onChange={e => onDraftChange(updateHighlight(diagram, h.id, { category: e.target.value }))}>
              {CATEGORY_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      ))}

      <button onClick={() => onDraftChange(addHighlight(diagram).diagram)} style={addButtonStyle(t)}>+ Add highlight</button>
    </div>
  );
}
