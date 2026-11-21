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
import { useTheme, RADIUS } from '../../lib/theme';

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

// Per-category visual treatment, refined toward the SAME "left accent
// rule" language AISections.js already uses for its own category cards
// (keyLearningPoints/highYield/clinicalPearls/redFlags — see that file)
// instead of a loud, fully-bordered box per category: every non-central
// node shares the SAME neutral card (t.surface fill, a thin all-around
// t.border) and differs ONLY by a 3px colour-coded LEFT stripe — "subtle
// category distinction" rather than five visually-shouting box styles.
// The central topic is the one deliberate exception: it's the single
// anchor of the whole diagram and is MEANT to read as visually dominant,
// so it keeps a solid accent fill rather than the subtle treatment.
function styleFor(t, category) {
  const card = {
    background: t.surface, color: t.text2, border: `1px solid ${t.border}`,
    fontWeight: 500, fontSize: 12.5, padding: '9px 14px',
  };
  switch (category) {
    case 'central_topic':
      return {
        background: t.accent, color: '#fff', border: `1px solid ${t.accent}`,
        fontWeight: 700, fontSize: 14.5, padding: '13px 20px', minWidth: 150,
        boxShadow: `0 4px 14px -4px ${t.accent}70`,
      };
    case 'branch':
      return { ...card, borderLeft: `3px solid ${t.accent}`, color: t.text, fontWeight: 700, fontSize: 13, minWidth: 120 };
    case 'red_flag':
      return { ...card, borderLeft: `3px solid ${t.danger}`, color: t.danger, fontWeight: 600, minWidth: 100 };
    case 'high_yield':
      return { ...card, borderLeft: `3px solid ${t.warn}`, color: t.warn, fontWeight: 600, minWidth: 100 };
    default: // 'subtopic'
      return { ...card, borderLeft: `3px solid ${t.borderStrong}`, minWidth: 100 };
  }
}

const CATEGORY_ICON = { red_flag: '🚩', high_yield: '⭐' };

function MindMapNode({ data, selected }) {
  const { t } = useTheme();
  const style = styleFor(t, data.category);
  const icon = CATEGORY_ICON[data.category];
  const isCentral = data.category === 'central_topic';

  return (
    <div
      role="button"
      aria-pressed={selected}
      style={{
        ...style,
        boxSizing: 'border-box',
        borderRadius: isCentral ? RADIUS.pill : RADIUS.md,
        fontFamily: 'Inter,sans-serif',
        lineHeight: 1.35,
        textAlign: isCentral ? 'center' : 'left',
        cursor: 'pointer',
        boxShadow: selected ? `0 0 0 3px ${t.accent}55${style.boxShadow ? `, ${style.boxShadow}` : ''}` : style.boxShadow,
        transition: 'box-shadow 120ms ease',
        userSelect: 'none',
        wordBreak: 'break-word',
        maxWidth: 220,
      }}
    >
      <AnchorHandles />
      {icon && <span style={{ marginRight: 5 }}>{icon}</span>}
      {data.label}
    </div>
  );
}

export default memo(MindMapNode);
