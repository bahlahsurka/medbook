// components/visualization/GraphNode.js
//
// The one React Flow node component for every graph-based visualization
// (Mind Map, Knowledge Network, Clinical Flowchart, Mechanism Diagram).
// Graph builders resolve WHAT a node is (variant = prominence, style =
// tone colours, shape, icon) and its exact layout size; this component only
// renders it. Width is fixed to the layout width and height never drops
// below the layout height, so the laid-out diagram and the DOM agree.
//
// Four invisible anchor handles (top/right/bottom/left) remain for editing
// connections; edges themselves attach to node borders via the custom edge
// components in diagramEdges.js.
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_VARIANTS, SHAPE_INSET } from './nodeTheme';

const HANDLE_POSITIONS = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];
// Invisible in view mode; in edit mode they appear on hover as drag-to-
// connect dots (styled by the canvas's shared CSS, see diagramStyles.js).
function AnchorHandles({ connectable }) {
  return HANDLE_POSITIONS.map(h => (
    <Handle key={h.id} id={h.id} type="source" position={h.position}
      className={`mb-viz-handle${connectable ? ' mb-viz-handle--live' : ''}`} isConnectable={!!connectable} />
  ));
}

// Decision nodes: an SVG outline drawn behind the text, so the chamfered
// ends keep a crisp continuous border (a CSS clip-path cut the border off).
function HexagonBackdrop({ width, height, fill, stroke, selectedRing }) {
  const i = SHAPE_INSET.hexagon;
  const pts = `${i},0.75 ${width - i},0.75 ${width - 0.75},${height / 2} ${width - i},${height - 0.75} ${i},${height - 0.75} 0.75,${height / 2}`;
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }} aria-hidden>
      {selectedRing && <polygon points={pts} fill="none" stroke={selectedRing} strokeWidth={6} strokeLinejoin="round" />}
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function GraphNode({ data, selected, isConnectable }) {
  const { label, style = {}, shape = 'rect', icon, variant = 'standard', width, height } = data;
  const spec = NODE_VARIANTS[variant] || NODE_VARIANTS.standard;
  const isRoot = variant === 'root';
  const isHex = shape === 'hexagon';
  const isPill = shape === 'pill';
  // Solid colour for the SVG fill (gradients aren't valid SVG fills).
  const solidFill = typeof style.background === 'string' && style.background.startsWith('linear-gradient')
    ? style.background.split('), ').pop() : style.background;

  return (
    <div
      role="button"
      aria-pressed={selected}
      className={`mb-viz-node${isHex ? ' mb-viz-node--hex' : ''}${data.dimmed ? ' mb-viz-node--dim' : ''}`}
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        width,
        minHeight: height,
        display: 'flex', alignItems: 'center',
        justifyContent: isRoot || isPill || isHex ? 'center' : 'flex-start',
        textAlign: isRoot || isPill || isHex ? 'center' : 'left',
        padding: `${spec.padY}px ${spec.padX + (SHAPE_INSET[shape] || 0)}px`,
        background: isHex ? 'transparent' : style.background,
        color: style.color,
        border: isHex ? 'none' : `1px solid ${style.border}`,
        borderLeft: !isHex && style.rule ? `3px solid ${style.rule}` : undefined,
        borderRadius: isPill || isRoot ? 999 : 10,
        boxShadow: isHex ? 'none' : [selected ? `0 0 0 3px ${style.ring}` : null, style.shadow || 'var(--mb-viz-node-shadow)'].filter(Boolean).join(', '),
        fontFamily: 'Inter,sans-serif',
        fontSize: spec.fontSize,
        fontWeight: spec.weight,
        lineHeight: spec.lineHeight,
        cursor: 'pointer',
        userSelect: 'none',
        overflowWrap: 'anywhere',
      }}
    >
      {isHex && <HexagonBackdrop width={width} height={height} fill={solidFill} stroke={style.border} selectedRing={selected ? style.ring : null} />}
      <AnchorHandles connectable={isConnectable} />
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'flex-start', gap: 5, maxWidth: '100%' }}>
        {icon && <span aria-hidden style={{ flexShrink: 0, lineHeight: spec.lineHeight }}>{icon}</span>}
        <span>{label}</span>
      </span>
    </div>
  );
}

export default memo(GraphNode);
