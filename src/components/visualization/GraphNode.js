// components/visualization/GraphNode.js
//
// Generic React Flow node shell shared by the Phase 3 graph-based
// visualization types (Knowledge Network, Clinical Flowchart, Mechanism
// Diagram) — NOT used by Mind Map, which keeps its own MindMapNode.js
// unchanged from Phase 2 (avoiding any regression risk to already-shipped
// code, per this phase's "avoid unrelated refactoring" brief). The actual
// per-category colour/shape decisions live in each type's own graph-
// builder module (knowledgeNetworkGraph.js etc.), which computes a plain,
// already-resolved `style` object per node using useTheme()'s tokens —
// this component itself has zero per-type knowledge, just renders
// whatever style/shape/icon/label it's given.
//
// Same four invisible anchor handles as MindMapNode.js, for the same
// reason: a non-tree-like diagram (a Knowledge Network, a branching
// flowchart) has neighbours in every direction, not just below.
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

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

// 'hexagon' (chamfered left/right corners) is used for Clinical Flowchart
// decision nodes — reads as visually distinct from a plain rect/pill
// without the layout complexity of a true rotated diamond (which needs a
// counter-rotated inner wrapper to keep text upright). Yes/No branching
// itself is conveyed by the EDGE labels (see clinicalFlowchartGraph.js),
// which is the clearer signal anyway — this shape is a secondary cue.
const SHAPE_CLIP_PATH = {
  hexagon: 'polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)',
};

function GraphNode({ data, selected }) {
  const { label, style = {}, shape = 'rect', icon } = data;
  const isPill = shape === 'pill';
  const clipPath = SHAPE_CLIP_PATH[shape];

  return (
    <div
      role="button"
      aria-pressed={selected}
      style={{
        ...style,
        boxSizing: 'border-box',
        borderRadius: isPill ? 999 : 10,
        clipPath,
        // A chamfered shape's clipped corners eat into any content sitting
        // right at the edge — extra horizontal padding keeps the label
        // clear of the cut rather than looking clipped itself.
        padding: clipPath ? `${parseInt(style.padding, 10) || 9}px 22px` : style.padding,
        fontFamily: 'Inter,sans-serif',
        lineHeight: 1.35,
        textAlign: isPill ? 'center' : 'left',
        cursor: 'pointer',
        boxShadow: selected
          ? `0 0 0 3px ${style.selectedRingColor || 'rgba(37,99,235,.35)'}${style.boxShadow ? `, ${style.boxShadow}` : ''}`
          : style.boxShadow,
        transition: 'box-shadow 120ms ease',
        userSelect: 'none',
        wordBreak: 'break-word',
        maxWidth: 230,
      }}
    >
      <AnchorHandles />
      {icon && <span style={{ marginRight: 5 }}>{icon}</span>}
      {label}
    </div>
  );
}

export default memo(GraphNode);
