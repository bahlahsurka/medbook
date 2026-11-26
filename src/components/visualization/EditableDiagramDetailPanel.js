// components/visualization/EditableDiagramDetailPanel.js
//
// Edit-mode counterpart to DiagramDetailPanel.js — shown instead of it
// (never alongside) when a graph-based renderer (Mind Map, Knowledge
// Network, Clinical Flowchart, Mechanism Diagram) is in editable mode and
// a node is selected. Lets a user rename a label, edit the explanation,
// change the category (where the type allows it — see graphCategories.js),
// delete the node, and edit/delete the connections touching it. Creating a
// NEW connection happens on the canvas itself (dragging between two
// handles), not here — this panel only manages what already exists on the
// selected node.
//
// Text inputs are UNCONTROLLED (`defaultValue`, committed `onBlur`) rather
// than controlled `value`+`onChange` — committing on every keystroke would
// push a new draft up to the renderer on every character, which for
// Knowledge Network/Clinical Flowchart would re-trigger their async ELK
// relayout mid-sentence. `key`ing each input by node/edge id (below) is
// what makes `defaultValue` refresh correctly when the SELECTION changes,
// while typing within the same field never gets fought by React.
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';

function inputStyle(t) {
  return {
    width: '100%', boxSizing: 'border-box', background: t.surface2, border: `1px solid ${t.borderStrong}`,
    borderRadius: RADIUS.sm, color: t.text, padding: '7px 9px', fontSize: FONT.size.xs,
    fontFamily: 'Inter,sans-serif', outline: 'none',
  };
}
function labelStyle(t) {
  return { fontSize: FONT.size.micro, color: t.text4, fontWeight: FONT.weight.semibold, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4, display: 'block' };
}
function dangerButtonStyle(t) {
  return {
    background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, color: t.danger, borderRadius: RADIUS.sm,
    padding: '6px 10px', fontSize: FONT.size.micro, fontWeight: FONT.weight.semibold, cursor: 'pointer',
    fontFamily: 'Inter,sans-serif', minHeight: 30,
  };
}

/**
 * @param {{
 *   node: object|null, edges: Array, nodesById: Map,
 *   categoryOptions: Array<{value,label}>, canDelete?: boolean,
 *   onUpdateNode: (patch:object)=>void, onDeleteNode: ()=>void,
 *   onUpdateEdge: (index:number, patch:object)=>void, onDeleteEdge: (index:number)=>void,
 *   onClose: ()=>void,
 * }} props
 *   `canDelete` (default true): false for a node a type's own validator
 *   requires exactly one of (Mind Map's central_topic, Clinical
 *   Flowchart's start) — deleting it would always fail re-validation at
 *   save time anyway, so the button is simply hidden rather than letting
 *   a user hit that error. The caller also passes `categoryOptions: []`
 *   for such a node (graphCategories.js already excludes these from each
 *   type's own list), so no re-categorize control shows either.
 */
export default function EditableDiagramDetailPanel({ node, edges, nodesById, categoryOptions, canDelete = true, onUpdateNode, onDeleteNode, onUpdateEdge, onDeleteEdge, onClose }) {
  const { t } = useTheme();
  if (!node) return null;

  const touchingEdges = (edges || [])
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.source === node.id || e.target === node.id);

  return (
    <div style={{
      position: 'absolute', top: SPACE.md, right: SPACE.md, zIndex: 6,
      width: 300, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)',
      overflowY: 'auto', background: t.surface, border: `1px solid ${t.accent}55`,
      borderRadius: RADIUS.lg, padding: SPACE.md, boxShadow: `0 8px 24px ${t.shadowStrong}`,
      fontFamily: 'Inter,sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: FONT.size.xs, fontWeight: FONT.weight.bold, color: t.accent, textTransform: 'uppercase', letterSpacing: .5 }}>Editing node</div>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: FONT.size.md, lineHeight: 1 }}>✕</button>
      </div>

      <label style={labelStyle(t)} htmlFor="mb-edit-node-label">Label</label>
      <input key={`label-${node.id}`} id="mb-edit-node-label" style={{ ...inputStyle(t), marginBottom: 10 }} defaultValue={node.label}
        onBlur={e => { if (e.target.value.trim() && e.target.value !== node.label) onUpdateNode({ label: e.target.value.trim() }); }} maxLength={120} />

      <label style={labelStyle(t)} htmlFor="mb-edit-node-explanation">Explanation</label>
      <textarea key={`explanation-${node.id}`} id="mb-edit-node-explanation" rows={3} style={{ ...inputStyle(t), marginBottom: 10, resize: 'vertical', lineHeight: 1.5 }}
        defaultValue={node.explanation} onBlur={e => { if (e.target.value !== node.explanation) onUpdateNode({ explanation: e.target.value }); }} maxLength={600} />

      {categoryOptions.length > 0 && (
        <>
          <label style={labelStyle(t)} htmlFor="mb-edit-node-category">Category</label>
          <select id="mb-edit-node-category" style={{ ...inputStyle(t), marginBottom: 10, cursor: 'pointer' }}
            value={node.category} onChange={e => onUpdateNode({ category: e.target.value })}>
            {!categoryOptions.some(c => c.value === node.category) && <option value={node.category}>{node.category}</option>}
            {categoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </>
      )}

      {touchingEdges.length > 0 && (
        <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10, marginBottom: 10 }}>
          <div style={labelStyle(t)}>Connections ({touchingEdges.length})</div>
          {touchingEdges.map(({ e, i }) => {
            const otherId = e.source === node.id ? e.target : e.source;
            const otherLabel = nodesById.get(otherId)?.label || otherId;
            const direction = e.source === node.id ? '→' : '←';
            return (
              <div key={i} style={{ background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.sm, padding: 8, marginBottom: 6 }}>
                <div style={{ fontSize: FONT.size.micro, color: t.text3, marginBottom: 5 }}>{direction} {otherLabel}</div>
                <input key={`rel-${node.id}-${i}`} style={{ ...inputStyle(t), marginBottom: 5 }} placeholder="Relationship (e.g. causes, treats)"
                  defaultValue={e.relationship} onBlur={ev => { if (ev.target.value.trim() && ev.target.value !== e.relationship) onUpdateEdge(i, { relationship: ev.target.value.trim() }); }} maxLength={60} />
                <input key={`lbl-${node.id}-${i}`} style={{ ...inputStyle(t), marginBottom: 6 }} placeholder="Branch/condition label (optional)"
                  defaultValue={e.label || ''} onBlur={ev => { if (ev.target.value !== (e.label || '')) onUpdateEdge(i, { label: ev.target.value }); }} maxLength={80} />
                <button onClick={() => onDeleteEdge(i)} style={dangerButtonStyle(t)}>Remove connection</button>
              </div>
            );
          })}
        </div>
      )}

      {canDelete && (
        <button onClick={onDeleteNode} style={{ ...dangerButtonStyle(t), width: '100%' }}>🗑 Delete node</button>
      )}
    </div>
  );
}
