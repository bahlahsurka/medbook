// components/visualization/mechanismDiagramGraph.js
//
// Converts a validated Mechanism Diagram into @xyflow/react's {nodes,
// edges}. SYNCHRONOUS — sequentialLayout.js's layering is cheap pure math.
// Reads as a causal sequence: stage colours (cause -> mechanism ->
// consequence), arrowheads on every link, and the relationship verb on
// each arrow when the chain is small enough for labels to stay readable.
// React Flow's MarkerType.ArrowClosed is the plain string 'arrowclosed', so this module stays importable without the React Flow runtime (e.g. in unit tests).
const ARROW = 'arrowclosed';
import { computeSequentialLayoutWithRoutes } from './sequentialLayout';
import { nodeData, toneStyle } from './nodeTheme';
import { measureNode } from './nodeMetrics';
import { pickHandle } from './pickHandle';
import { boundsOfRects, pickBestFit } from './viewport';
import { facingAnchors, sideCurve, polylineMidpoint } from './edgeGeometry';
import { placeLabels, EDGE_LABEL_SPEC, humanizeRelationship } from './labelPlacement';

export { humanizeRelationship };

const NODE_SPEC = {
  cause: { variant: 'primary', tone: 'strong' },
  mechanism: { variant: 'secondary', tone: 'amber' },
  manifestation: { variant: 'standard', tone: 'accent' },
  consequence: { variant: 'standard', tone: 'neutral' },
  red_flag: { variant: 'standard', tone: 'danger', icon: '🚩' },
  investigation: { variant: 'standard', tone: 'decision' },
  management: { variant: 'standard', tone: 'ok' },
};

// Sibling order within a stage, so related nodes sit together and links
// don't cross: continuing chains first, then results/complications, then
// tests and treatments, then clinical features grouped at the end.
const GROUP_RANK = { cause: 0, mechanism: 0, consequence: 1, red_flag: 1, investigation: 2, management: 3, manifestation: 4 };

/** Relationship verb plus any qualifier ("can lead to · rapidly"). */
export function edgeText(e) {
  return [humanizeRelationship(e.relationship), String(e.label || '').trim()].filter(Boolean).join(' · ');
}

// Above this many links, relationship verbs are left to the detail panel.
const MAX_LABELLED_EDGES = 14;

/**
 * @param {{topic,nodes,edges}} diagram
 * @param {object} t — theme tokens
 * @param {{direction?:'RIGHT'|'DOWN', container?:{width,height,insets}}} [options]
 *   Without an explicit `direction`, a `container` picks whichever reads
 *   better in it — left-to-right preferred, top-to-bottom when that fits
 *   clearly better (typically phones, or long chains).
 */
export function buildMechanismDiagramFlowGraph(diagram, t, { direction: forced, container } = {}) {
  const nodes = diagram?.nodes || [];
  const edges = diagram?.edges || [];
  const built = new Map(nodes.map(n => [n.id, nodeData(n, NODE_SPEC[n.category] || NODE_SPEC.mechanism)]));
  const byCategory = new Map(nodes.map(n => [n.id, n.category]));

  const showVerbs = edges.length <= MAX_LABELLED_EDGES;
  const labelSize = (e) => {
    const text = showVerbs ? edgeText(e) : String(e.label || '').trim();
    return text ? { text, ...measureNode(text, EDGE_LABEL_SPEC) } : null;
  };
  const labels = edges.map(labelSize);
  const widestLabel = Math.max(0, ...labels.map(l => (l ? l.width : 0)));

  const layoutFor = (direction) => {
    const layerGap = direction === 'DOWN' ? (widestLabel ? 64 : 0) : (widestLabel ? widestLabel + 40 : 0);
    const { positions, routes } = computeSequentialLayoutWithRoutes(nodes.map(n => ({ id: n.id })), edges,
      { sizeOf: id => built.get(id)?.size, direction, layerGap, groupRank: id => GROUP_RANK[byCategory.get(id)] ?? 0 });
    const rects = nodes.map(n => ({ ...positions.get(n.id), ...built.get(n.id).size }));
    return { key: direction, positions, routes, bounds: boundsOfRects(rects) };
  };
  const candidates = forced ? [forced] : container ? ['RIGHT', 'DOWN'] : ['RIGHT'];
  const layouts = candidates.map(layoutFor);
  const chosen = container && layouts.length > 1 ? pickBestFit(layouts, container) : layouts[0];
  const direction = chosen.key;
  const { positions, routes } = chosen;
  // A node the user dragged while editing carries its own top-left
  // `position` (graphDiagramEdits.js's moveNode), which always wins.
  const byId = new Map(nodes.map(n => [n.id, n]));
  const positionOf = (id) => byId.get(id)?.position || positions.get(id) || { x: 0, y: 0 };

  const flowNodes = nodes.map(n => {
    const spec = NODE_SPEC[n.category] || NODE_SPEC.mechanism;
    return {
      id: n.id,
      type: 'graphNode',
      position: positionOf(n.id),
      data: { ...built.get(n.id).data, style: toneStyle(t, spec.tone) },
      draggable: true,
    };
  });

  // Keep only relationship labels that land clear of nodes and each other.
  const axis = direction === 'DOWN' ? 'y' : 'x';
  const rectOf = (id) => ({ ...positionOf(id), ...(built.get(id)?.size || { width: 0, height: 0 }) });
  const nodeRects = nodes.map(n => rectOf(n.id));
  const toRect = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  // Links that skip layers run through their layout waypoints (own lane).
  const waypointPath = (e, i) => {
    const wps = routes.get(i);
    if (!wps?.length || byId.get(e.source)?.position || byId.get(e.target)?.position) return null;
    const S = rectOf(e.source), T = rectOf(e.target);
    const start = axis === 'x' ? { x: S.x + S.width, y: S.y + S.height / 2 } : { x: S.x + S.width / 2, y: S.y + S.height };
    const end = axis === 'x' ? { x: T.x - 2, y: T.y + T.height / 2 } : { x: T.x + T.width / 2, y: T.y - 2 };
    return [start, ...wps, end];
  };
  const paths = edges.map(waypointPath);

  // Fan-outs (2+ direct links from one node to the next stage) are drawn
  // as a bracket — one trunk to a shared bus, then a straight drop into
  // each child — instead of a spray of curves crossing each other. Each
  // child's relationship sits on its own drop.
  const bracket = new Map(); // edge index -> label anchor {x,y}
  const fanOut = new Map();
  edges.forEach((e, i) => {
    if (paths[i] || !built.has(e.source) || !built.has(e.target)) return;
    if (byId.get(e.source)?.position || byId.get(e.target)?.position) return;
    (fanOut.get(e.source) || fanOut.set(e.source, []).get(e.source)).push(i);
  });
  for (const [src, idxs] of fanOut) {
    if (idxs.length < 2) continue;
    const S = rectOf(src);
    const T = idxs.map(i => rectOf(edges[i].target));
    if (axis === 'y') {
      const from = S.y + S.height, to = Math.min(...T.map(r => r.y));
      if (to - from < 28) continue;
      const bus = from + (to - from) * 0.35, sx = S.x + S.width / 2;
      idxs.forEach((i, k) => {
        const tx = T[k].x + T[k].width / 2;
        paths[i] = [{ x: sx, y: from }, { x: sx, y: bus }, { x: tx, y: bus }, { x: tx, y: T[k].y - 2 }];
        bracket.set(i, { x: tx, y: (bus + T[k].y) / 2 });
      });
    } else {
      const from = S.x + S.width, to = Math.min(...T.map(r => r.x));
      if (to - from < 28) continue;
      const bus = from + (to - from) * 0.35, sy = S.y + S.height / 2;
      idxs.forEach((i, k) => {
        const ty = T[k].y + T[k].height / 2;
        paths[i] = [{ x: from, y: sy }, { x: bus, y: sy }, { x: bus, y: ty }, { x: T[k].x - 2, y: ty }];
        bracket.set(i, { x: (bus + T[k].x) / 2, y: ty });
      });
    }
  }
  // A fan of links from one node with the same text ("presents with" ×4)
  // shows its label once, on the middle link, instead of a stack of copies.
  const repeated = new Set();
  const fans = new Map();
  edges.forEach((e, i) => {
    if (!labels[i]) return;
    const k = `${e.source}\u0000${labels[i].text}`;
    (fans.get(k) || fans.set(k, []).get(k)).push(i);
  });
  for (const all of fans.values()) {
    const group = all.filter(i => !bracket.has(i)); // bracket drops each keep their own label
    if (group.length < 2) continue;
    const across = (i) => { const r = rectOf(edges[i].target); return axis === 'x' ? r.y + r.height / 2 : r.x + r.width / 2; };
    const sorted = [...group].sort((a, b) => across(a) - across(b));
    sorted.forEach((i, k) => { if (k !== Math.floor((sorted.length - 1) / 2)) repeated.add(i); });
  }
  const fitting = placeLabels(edges.map((e, i) => {
    if (!labels[i] || repeated.has(i) || !built.has(e.source) || !built.has(e.target)) return null;
    let mid;
    if (bracket.has(i)) mid = bracket.get(i);
    else if (paths[i]) mid = polylineMidpoint(paths[i]);
    else {
      const a = facingAnchors(toRect(rectOf(e.source)), toRect(rectOf(e.target)), axis);
      mid = sideCurve(a.start, a.startSide, a.end, a.endSide).mid;
    }
    return { key: i, cx: mid.x, cy: mid.y, width: labels[i].width, height: labels[i].height };
  }).filter(Boolean), nodeRects);

  const stroke = t.text4;
  const flowEdges = edges.map((e, i) => {
    const s = positionOf(e.source), tp = positionOf(e.target);
    const dx = tp.x - s.x, dy = tp.y - s.y;
    const dragged = !!(byId.get(e.source)?.position || byId.get(e.target)?.position);
    return {
      id: `md-e${i}-${e.source}-${e.target}`,
      source: e.source, target: e.target,
      sourceHandle: pickHandle(dx, dy), targetHandle: pickHandle(-dx, -dy),
      type: paths[i] ? 'routed' : 'branch',
      label: labels[i]?.text || undefined,
      labelStyle: { fill: t.text3, fontSize: 10.5, fontWeight: 600 },
      style: { stroke, strokeWidth: 1.7 },
      markerEnd: { type: ARROW, color: stroke, width: 16, height: 16 },
      data: paths[i]
        ? { points: paths[i], smooth: !bracket.has(i), sourceAt: positionOf(e.source), targetAt: positionOf(e.target), showLabel: fitting.has(i),
            labelBox: bracket.has(i) && labels[i] ? { x: bracket.get(i).x - labels[i].width / 2, y: bracket.get(i).y - labels[i].height / 2, width: labels[i].width, height: labels[i].height } : undefined }
        : { axis: dragged ? 'auto' : axis, showLabel: fitting.has(i) },
    };
  });

  return { flowNodes, flowEdges, meta: { direction } };
}
