// components/visualization/diagramEdges.js
//
// Custom React Flow edges shared by the four graph renderers. All of them
// attach to node BORDERS from live node geometry (so they follow a node
// while it's dragged in edit mode), and render labels as small pills via
// EdgeLabelRenderer.
//
//  - 'branch': tree/chain curve leaving each node from the side that faces
//    the other (Mind Map, Mechanism Diagram).
//  - 'link':   straight border-to-border line (Knowledge Network).
//  - 'routed': ELK's own orthogonal route with ELK-placed label (Clinical
//    Flowchart); falls back to a 'branch' curve as soon as either endpoint
//    is no longer where ELK put it (dragged or manually positioned).
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react';
import { rectBorderPoint, roundedPolylinePath, smoothPath, sideCurve, facingAnchors, polylineMidpoint } from './edgeGeometry';

function rectOf(node) {
  if (!node) return null;
  const p = node.internals?.positionAbsolute || node.position;
  const w = node.measured?.width ?? node.data?.width ?? 0;
  const h = node.measured?.height ?? node.data?.height ?? 0;
  if (!p || !w || !h) return null;
  return { x: p.x, y: p.y, w, h };
}

export function EdgeLabelPill({ x, y, label, labelStyle, dimmed, width }) {
  if (!label) return null;
  return (
    <EdgeLabelRenderer>
      <div className="mb-viz-edge-label" style={{
        position: 'absolute', transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        pointerEvents: 'none', width, maxWidth: 170, boxSizing: 'border-box', textAlign: 'center',
        fontFamily: 'Inter,sans-serif', fontSize: labelStyle?.fontSize || 11, fontWeight: labelStyle?.fontWeight || 600,
        color: labelStyle?.fill || 'var(--mb-viz-label-fg)', lineHeight: 1.3,
        background: 'var(--mb-viz-label-bg)', border: '1px solid var(--mb-viz-label-border)',
        borderRadius: 6, padding: '2px 6px', opacity: dimmed ? 0.25 : 1, transition: 'opacity 160ms ease',
        overflowWrap: 'anywhere',
      }}>
        {label}
      </div>
    </EdgeLabelRenderer>
  );
}

function edgeStyle(style, data) {
  return data?.dimmed ? { ...style, opacity: 0.18 } : style;
}

export const BranchEdge = memo(function BranchEdge({ id, source, target, style, markerEnd, label, labelStyle, data }) {
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  if (!a || !b) return null;
  const anchors = facingAnchors(a, b, data?.axis || 'auto');
  const gapEnd = markerEnd ? 2 : 0;
  const end = { ...anchors.end };
  if (gapEnd) {
    if (anchors.endSide === 'left') end.x -= gapEnd; else if (anchors.endSide === 'right') end.x += gapEnd;
    else if (anchors.endSide === 'top') end.y -= gapEnd; else end.y += gapEnd;
  }
  const { path, mid } = sideCurve(anchors.start, anchors.startSide, end, anchors.endSide);
  return (
    <>
      <BaseEdge id={id} path={path} style={edgeStyle(style, data)} markerEnd={markerEnd} interactionWidth={14} />
      <EdgeLabelPill x={mid.x} y={mid.y} label={data?.showLabel === false ? null : label} labelStyle={labelStyle} dimmed={data?.dimmed} />
    </>
  );
});

export const LinkEdge = memo(function LinkEdge({ id, source, target, style, markerEnd, label, labelStyle, data }) {
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  if (!a || !b) return null;
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const start = rectBorderPoint(a, bc, 1);
  const end = rectBorderPoint(b, ac, markerEnd ? 3 : 1);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return (
    <>
      <BaseEdge id={id} path={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} style={edgeStyle(style, data)} markerEnd={markerEnd} interactionWidth={14} />
      <EdgeLabelPill x={mid.x} y={mid.y} label={data?.showLabel === false ? null : label} labelStyle={labelStyle} dimmed={data?.dimmed} />
    </>
  );
});

const near = (p, q) => p && q && Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;

export const RoutedEdge = memo(function RoutedEdge({ id, source, target, style, markerEnd, label, labelStyle, data }) {
  const sNode = useInternalNode(source);
  const tNode = useInternalNode(target);
  const a = rectOf(sNode), b = rectOf(tNode);
  if (!a || !b) return null;
  const onLayout = data?.points?.length >= 2 && near(a, data.sourceAt) && near(b, data.targetAt);
  if (onLayout) {
    const lb = data.labelBox;
    const labelPos = lb ? { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 } : polylineMidpoint(data.points);
    return (
      <>
        <BaseEdge id={id} path={data.smooth ? smoothPath(data.points) : roundedPolylinePath(data.points, 9)} style={edgeStyle(style, data)} markerEnd={markerEnd} interactionWidth={14} />
        <EdgeLabelPill x={labelPos.x} y={labelPos.y} label={data?.showLabel === false ? null : label} labelStyle={labelStyle} dimmed={data?.dimmed} width={lb?.width} />
      </>
    );
  }
  const anchors = facingAnchors(a, b, 'auto');
  const { path, mid } = sideCurve(anchors.start, anchors.startSide, anchors.end, anchors.endSide);
  return (
    <>
      <BaseEdge id={id} path={path} style={edgeStyle(style, data)} markerEnd={markerEnd} interactionWidth={14} />
      <EdgeLabelPill x={mid.x} y={mid.y} label={label} labelStyle={labelStyle} dimmed={data?.dimmed} />
    </>
  );
});

export const EDGE_TYPES = { branch: BranchEdge, link: LinkEdge, routed: RoutedEdge };
