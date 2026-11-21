// components/visualization/MindMapNode.js
//
// ONE custom React Flow node component for every category — category
// drives the styling internally rather than registering five separate
// node TYPES, since the only thing that actually differs between them is
// a handful of style tokens, not behavior. Reads colour/spacing/type
// tokens from useTheme() (lib/theme.js) exactly the way every other
// component in this app already does, so light/dark both "just work" and
// nothing here invents a second, parallel design system.
//
// Four invisible Handle anchors (top/right/bottom/left) rather than the
// usual single top/bottom pair — a radial Mind Map has children in every
// direction from their parent, not just below, so a fixed top/bottom
// handle pair would force every edge through an unnatural detour.
// mindMapEdges.js picks whichever of the four actually points toward the
// other end of each specific edge. They're real Handle elements (needed
// for React Flow to compute edge paths at all) but visually invisible and
// non-interactive — Phase 2 is view-only, nothing here lets a viewer drag
// a new connection.
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useTheme } from '../../lib/theme';

const HANDLE_POSITIONS = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

const handleStyle = { opacity: 0, width: 1, height: 1, pointerEvents: 'none', border: 'none' };

function AnchorHandles() {
  return HANDLE_POSITIONS.map(h => (
    <Handle key={h.id} id={h.id} type="source" position={h.position} style={handleStyle} isConnectable={false} />
  ));
}

// Per-category visual treatment — intentionally plain and flat (solid
// fills/borders, no gradients or glass effects), matching MedBook's
// existing bold-sans/flat-card look elsewhere in the app (AISections.js's
// left-accent-rule cards, HLPopover's solid swatches) rather than
// introducing a decorative style unique to this one feature.
function styleFor(t, category) {
  switch (category) {
    case 'central_topic':
      return {
        background: t.accent, color: '#fff', border: `2px solid ${t.accent}`,
        fontWeight: 700, fontSize: 15, padding: '14px 22px', minWidth: 160,
        boxShadow: `0 6px 18px -6px ${t.accent}80`,
      };
    case 'branch':
      return {
        background: t.surface, color: t.text, border: `2px solid ${t.accent}`,
        fontWeight: 700, fontSize: 13, padding: '10px 16px', minWidth: 130,
      };
    case 'red_flag':
      return {
        background: t.dangerBg, color: t.danger, border: `2px solid ${t.dangerBorder}`,
        fontWeight: 600, fontSize: 12.5, padding: '8px 14px', minWidth: 110,
      };
    case 'high_yield':
      return {
        background: t.warnBg, color: t.warn, border: `2px solid ${t.warnBorder}`,
        fontWeight: 600, fontSize: 12.5, padding: '8px 14px', minWidth: 110,
      };
    default: // 'subtopic'
      return {
        background: t.surface2, color: t.text2, border: `1px solid ${t.border}`,
        fontWeight: 500, fontSize: 12, padding: '7px 13px', minWidth: 100,
      };
  }
}

const CATEGORY_ICON = { red_flag: '🚩', high_yield: '⭐' };

function MindMapNode({ data, selected }) {
  const { t } = useTheme();
  const style = styleFor(t, data.category);
  const icon = CATEGORY_ICON[data.category];

  return (
    <div
      role="button"
      aria-pressed={selected}
      style={{
        ...style,
        borderRadius: data.category === 'central_topic' ? 999 : 10,
        fontFamily: 'Inter,sans-serif',
        lineHeight: 1.35,
        textAlign: 'center',
        cursor: 'pointer',
        boxShadow: selected ? `0 0 0 3px ${t.accent}55${style.boxShadow ? `, ${style.boxShadow}` : ''}` : style.boxShadow,
        transition: 'box-shadow 120ms ease',
        userSelect: 'none',
        wordBreak: 'break-word',
      }}
    >
      <AnchorHandles />
      {icon && <span style={{ marginRight: 5 }}>{icon}</span>}
      {data.label}
    </div>
  );
}

export default memo(MindMapNode);
