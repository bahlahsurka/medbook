// components/visualization/mindMapGraph.js
//
// Converts a validated Mind Map diagram ({centralTopic, nodes, edges}) plus
// computeMindMapLayout's centres into @xyflow/react's {nodes, edges}. Pure
// data transform (unit-tested without a DOM/React Flow runtime).
import { computeMindMapLayout, MIND_MAP_NODE_SPEC } from './mindMapLayout';
import { nodeData, toneStyle } from './nodeTheme';
import { pickHandle } from './pickHandle';
import { boundsOfRects, pickBestFit } from './viewport';
import { facingAnchors, sideCurve, polylineMidpoint } from './edgeGeometry';
import { placeLabels, EDGE_LABEL_SPEC } from './labelPlacement';
import { measureNode } from './nodeMetrics';

const HANDLE_IDS = ['top', 'right', 'bottom', 'left'];

// Branch-level connections are heavier and accent-tinted (they carry the
// map's structure); deeper ones are quieter.
function edgeStyleFor(t, fromCentre) {
  return fromCentre
    ? { stroke: `${t.accent}99`, strokeWidth: 2.2 }
    : { stroke: t.borderStrong, strokeWidth: 1.6 };
}

const OUTLINE_STEM = 14; // outline connectors drop from this far inside the parent's left edge
const OUTLINE_ROOT_STEM = 24;

/**
 * @param {{centralTopic:string, nodes:Array, edges:Array}} diagram
 * @param {object} t — theme tokens (useTheme().t)
 * @param {{selectedId?:string, mode?:'balanced'|'right'|'outline', container?:{width,height,insets}}} [options]
 *   With `container` (and no explicit `mode`), the layout mode that reads
 *   best in that container is chosen: balanced or one-sided on wide
 *   screens, a vertical outline tree on phones.
 */
export function buildFlowGraph(diagram, t, { selectedId, mode, container } = {}) {
  const nodes = diagram?.nodes || [];
  const built = new Map(nodes.map(n => {
    const spec = MIND_MAP_NODE_SPEC[n.category] || MIND_MAP_NODE_SPEC.subtopic;
    return [n.id, nodeData(n, spec)];
  }));
  const sizeOf = (n) => built.get(n.id).size;
  const candidates = mode ? [mode] : !container ? ['balanced'] : container.width < 560 ? ['outline', 'right', 'balanced'] : ['balanced', 'right'];
  const layouts = candidates.map(m => {
    const c = computeMindMapLayout(diagram, sizeOf, { mode: m });
    const rects = nodes.map(n => { const p = c.get(n.id); const s = sizeOf(n); return { x: p.x - s.width / 2, y: p.y - s.height / 2, ...s }; });
    return { key: m, centres: c, bounds: boundsOfRects(rects) };
  });
  const chosen = container && layouts.length > 1 ? pickBestFit(layouts, container) : layouts[0];
  const centres = chosen.centres;
  const layoutMode = chosen.key;
  const central = nodes.find(n => n.category === 'central_topic');

  // A node the user dragged while editing carries its own top-left
  // `position` (graphDiagramEdits.js's moveNode), which always wins.
  const topLeftOf = (n) => {
    if (n?.position) return n.position;
    const c = centres.get(n?.id) || { x: 0, y: 0 };
    const { width, height } = built.get(n.id).size;
    return { x: c.x - width / 2, y: c.y - height / 2 };
  };

  const flowNodes = nodes.map(n => {
    const spec = MIND_MAP_NODE_SPEC[n.category] || MIND_MAP_NODE_SPEC.subtopic;
    const { data } = built.get(n.id);
    return {
      id: n.id,
      type: 'mindMapNode',
      position: topLeftOf(n),
      selected: n.id === selectedId,
      data: { ...data, style: toneStyle(t, spec.tone) },
      // The central topic anchors the whole map — pinned so dragging other
      // nodes never moves the one everything is laid out around.
      draggable: n.category !== 'central_topic',
    };
  });

  const byId = new Map(nodes.map(n => [n.id, n]));
  const layoutRect = (n) => { const c = centres.get(n.id); const s = sizeOf(n); return { x: c.x - s.width / 2, y: c.y - s.height / 2, ...s }; };

  // Outline mode: an elbow from just inside the parent's left edge down to
  // the child's middle, then into its left side.
  const outlineRoute = (s, tg) => {
    const ds = centres.get(s.id)?.depth, dt = centres.get(tg.id)?.depth;
    if (ds === undefined || dt === undefined || Math.abs(ds - dt) !== 1) return null;
    const [P, C] = ds < dt ? [layoutRect(s), layoutRect(tg)] : [layoutRect(tg), layoutRect(s)];
    const stemX = P.x + (Math.min(ds, dt) === 0 ? OUTLINE_ROOT_STEM : OUTLINE_STEM);
    const midY = C.y + C.height / 2;
    const pts = [{ x: stemX, y: P.y + P.height }, { x: stemX, y: midY }, { x: C.x, y: midY }];
    return ds < dt ? pts : pts.reverse();
  };

  const edges = diagram?.edges || [];
  const routes = edges.map(e => {
    const s = byId.get(e.source), tg = byId.get(e.target);
    return layoutMode === 'outline' && s && tg && !s.position && !tg.position ? outlineRoute(s, tg) : null;
  });
  // Explicit labels only where their pill lands clear of nodes and each other.
  const liveRect = (n) => { const p = topLeftOf(n); const sz = sizeOf(n); return { x: p.x, y: p.y, width: sz.width, height: sz.height }; };
  const fitting = placeLabels(edges.map((e, i) => {
    const s = byId.get(e.source), tg = byId.get(e.target);
    if (!e.label || !s || !tg) return null;
    let mid;
    if (routes[i]) mid = polylineMidpoint(routes[i]);
    else {
      const toR = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
      const a = facingAnchors(toR(liveRect(s)), toR(liveRect(tg)), s.position || tg.position ? 'auto' : 'x');
      mid = sideCurve(a.start, a.startSide, a.end, a.endSide).mid;
    }
    const sz = measureNode(e.label, EDGE_LABEL_SPEC);
    return { key: i, cx: mid.x, cy: mid.y, width: sz.width, height: sz.height };
  }).filter(Boolean), nodes.map(liveRect));

  const flowEdges = edges.map((e, i) => {
    const s = byId.get(e.source), tg = byId.get(e.target);
    const sp = s ? topLeftOf(s) : { x: 0, y: 0 }, tp = tg ? topLeftOf(tg) : { x: 0, y: 0 };
    const dx = tp.x - sp.x, dy = tp.y - sp.y;
    const fromCentre = !!central && (e.source === central.id || e.target === central.id);
    const dragged = !!(s?.position || tg?.position);
    const route = routes[i];
    return {
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle: pickHandle(dx, dy),
      targetHandle: pickHandle(-dx, -dy),
      type: route ? 'routed' : 'branch',
      label: e.label || undefined,
      labelStyle: { fill: t.text3, fontSize: 10.5, fontWeight: 600 },
      style: edgeStyleFor(t, fromCentre),
      data: route
        ? { points: route, sourceAt: layoutRect(s), targetAt: layoutRect(tg), showLabel: fitting.has(i) }
        : { axis: dragged ? 'auto' : 'x', showLabel: fitting.has(i) },
    };
  });

  return { flowNodes, flowEdges, meta: { mode: layoutMode } };
}

export { HANDLE_IDS, pickHandle };
