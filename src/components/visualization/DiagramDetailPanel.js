// components/visualization/DiagramDetailPanel.js
//
// Shared expandable node-detail panel for the Phase 3 graph renderers —
// see DiagramToolbar.js's own header comment for why this is shared by
// the three NEW renderers while Mind Map keeps its own inline Phase 2
// copy untouched.
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';

/**
 * @param {{id,label,explanation,sourceType,sourceRef,extra?:React.ReactNode}} node
 *   `extra` lets a caller append type-specific detail (e.g. a Clinical
 *   Flowchart decision's branch conditions) below the standard fields,
 *   without this component needing to know about every type's own shape.
 */
export default function DiagramDetailPanel({ node, onClose }) {
  const { t } = useTheme();
  if (!node) return null;

  return (
    <div style={{
      position: 'absolute', top: SPACE.md, right: SPACE.md, zIndex: 6,
      width: 280, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)',
      overflowY: 'auto', background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: RADIUS.lg, padding: SPACE.md, boxShadow: `0 8px 24px ${t.shadowStrong}`,
      fontFamily: 'Inter,sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: FONT.size.sm, fontWeight: FONT.weight.bold, color: t.text }}>{node.label}</div>
        <button onClick={onClose} aria-label="Close"
          style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: FONT.size.md, lineHeight: 1 }}>
          ✕
        </button>
      </div>
      <div style={{ fontSize: FONT.size.xs, color: t.text2, lineHeight: 1.6, marginBottom: 10 }}>
        {node.explanation}
      </div>
      {node.extra}
      <div style={{ fontSize: FONT.size.micro, color: t.text4, borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
        {node.sourceType === 'ai_context' ? 'From supplementary context, not the entry itself' : 'From the entry'}
        {node.sourceRef && (
          <div style={{ marginTop: 4, fontStyle: 'italic', color: t.text3 }}>"{node.sourceRef}"</div>
        )}
      </div>
    </div>
  );
}
