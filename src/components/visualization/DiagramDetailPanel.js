// components/visualization/DiagramDetailPanel.js
//
// Read-only detail for a selected node/cell/highlight, shared by all six
// renderers: the name as a heading and its explanation as subtext — nothing
// else.
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';
import { conceptKey } from '../../services/ai/diagramLabels';

/**
 * @param {{label, explanation?}} node
 */
export default function DiagramDetailPanel({ node, onClose }) {
  const { t } = useTheme();
  if (!node) return null;
  // An explanation that only restates the heading adds nothing.
  const showExplanation = !!String(node.explanation || '').trim() && conceptKey(node.explanation) !== conceptKey(node.label);

  return (
    <div className="mb-viz-pop" style={{
      position: 'absolute', top: SPACE.md, right: SPACE.md, zIndex: 6,
      width: 320, maxWidth: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)',
      overflowY: 'auto', background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: RADIUS.lg, padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE.lg}px`, boxShadow: `0 10px 28px -8px ${t.shadowStrong}`,
      fontFamily: 'Inter,sans-serif', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: FONT.size.xl, fontWeight: FONT.weight.bold, color: t.text, lineHeight: 1.3, paddingTop: 4 }}>{node.label}</div>
        <button onClick={onClose} aria-label="Close" className="mb-viz-btn"
          style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: FONT.size.md, lineHeight: 1,
            width: 28, height: 28, borderRadius: RADIUS.sm, flexShrink: 0, margin: '0 -8px 0 0' }}>
          ✕
        </button>
      </div>
      {showExplanation && (
        <div style={{ fontSize: FONT.size.md, color: t.text2, lineHeight: 1.6, marginTop: SPACE.sm }}>{node.explanation}</div>
      )}
    </div>
  );
}
