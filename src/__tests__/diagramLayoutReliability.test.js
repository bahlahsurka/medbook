// Phase 7 — diagram layout reliability. Pure-math coverage for the layout
// engine (viewport fitting, text measurement, layered/sequential layout,
// edge geometry, overlap removal, label culling). The rendered result is
// verified separately in a real browser; these pin the rules down.
import { computeViewport, readableMinZoom, fitZoomFor, pickBestFit, preferredCanvasHeight, boundsOf, ABSOLUTE_MIN_ZOOM } from '../components/visualization/viewport';
import { wrapText, measureNode } from '../components/visualization/nodeMetrics';
import { sizeForNode } from '../components/visualization/nodeTheme';
import { computeSequentialLayout, computeSequentialLayoutWithRoutes } from '../components/visualization/sequentialLayout';
import { rectBorderPoint, roundedPolylinePath, facingAnchors, polylineMidpoint, smoothPath, sideCurve } from '../components/visualization/edgeGeometry';
import { removeOverlaps, hasOverlap } from '../components/visualization/overlapRemoval';
import { placeLabels, EDGE_LABEL_SPEC } from '../components/visualization/labelPlacement';
import { buildMechanismDiagramFlowGraph } from '../components/visualization/mechanismDiagramGraph';
import { buildClinicalFlowchartFlowGraph } from '../components/visualization/clinicalFlowchartGraph';
import { applySelection } from '../components/visualization/diagramSelection';

const T = {
  accent: '#2563eb', surface: '#fff', surface2: '#eee', surface3: '#ddd', text: '#111', text2: '#333', text3: '#666', text4: '#999',
  border: '#ddd', borderStrong: '#ccc', dangerBg: '#fee', dangerBorder: '#fcc', danger: '#c00', warnBg: '#ffe', warnBorder: '#fd8',
  warn: '#a60', okBg: '#efe', okBorder: '#cfc', ok: '#080', navActiveBg: '#eef', navActiveBorder: '#ccf',
};
const INSETS = { top: 60, right: 22, bottom: 46, left: 22 };
const DESKTOP = { width: 860, height: 600, insets: INSETS };
const PHONE = { width: 380, height: 600, insets: { top: 60, right: 12, bottom: 46, left: 12 } };
const toBox = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('viewport: initial zoom and fitting', () => {
  test('a small diagram is never blown up past 1x, and is centred', () => {
    const vp = computeViewport({ bounds: { x: 0, y: 0, width: 300, height: 120 }, width: 860, height: 400, insets: INSETS });
    expect(vp.zoom).toBe(1);
    expect(vp.fitsAll).toBe(true);
    const left = vp.x, right = 860 - (vp.x + 300);
    expect(Math.abs(left - right)).toBeLessThan(1);
  });

  test('a medium diagram that fits at a readable zoom is shown whole', () => {
    const vp = computeViewport({ bounds: { x: 0, y: 0, width: 900, height: 400 }, width: 860, height: 600, insets: INSETS });
    expect(vp.zoom).toBeGreaterThanOrEqual(readableMinZoom(860));
    expect(vp.zoom).toBeLessThan(1);
    expect(vp.fitsAll).toBe(true);
  });

  test('a large diagram starts at a readable zoom (not shrunk to fit) anchored on its entry point', () => {
    const bounds = { x: 0, y: 0, width: 2400, height: 1800 };
    const focus = { x: 1200, y: 30 };
    const vp = computeViewport({ bounds, width: 860, height: 600, insets: INSETS, focus, alignY: 'start' });
    expect(vp.zoom).toBeCloseTo(readableMinZoom(860), 5);
    expect(vp.fitsAll).toBe(false);
    expect(vp.y).toBeCloseTo(INSETS.top, 5);                       // top of the flowchart sits just under the toolbar
    expect(vp.x + focus.x * vp.zoom).toBeCloseTo(INSETS.left + (860 - INSETS.left - INSETS.right) / 2, 5); // start node centred
  });

  test('anchoring never scrolls past the content edge into empty space', () => {
    const bounds = { x: 0, y: 0, width: 2000, height: 1500 };
    const vp = computeViewport({ bounds, width: 860, height: 600, insets: INSETS, focus: { x: 10, y: 10 } });
    expect(vp.x).toBeLessThanOrEqual(INSETS.left + 1e-6);
    expect(vp.y).toBeLessThanOrEqual(INSETS.top + 1e-6);
  });

  test('"Fit" (mode all) shows everything even when that needs a small zoom', () => {
    const vp = computeViewport({ bounds: { x: 0, y: 0, width: 4000, height: 3000 }, width: 860, height: 600, insets: INSETS, mode: 'all' });
    expect(vp.fitsAll).toBe(true);
    expect(vp.zoom).toBeGreaterThanOrEqual(ABSOLUTE_MIN_ZOOM);
  });

  test('pickBestFit keeps the preferred layout unless another fits clearly better', () => {
    const tall = { key: 'DOWN', bounds: { x: 0, y: 0, width: 400, height: 1400 } };
    const wide = { key: 'RIGHT', bounds: { x: 0, y: 0, width: 1400, height: 400 } };
    expect(pickBestFit([tall, wide], DESKTOP, 1.25).key).toBe('RIGHT');
    const slightlyBetter = { key: 'RIGHT', bounds: { x: 0, y: 0, width: 760, height: 560 } };
    const ok = { key: 'DOWN', bounds: { x: 0, y: 0, width: 700, height: 560 } };
    expect(pickBestFit([ok, slightlyBetter], DESKTOP, 1.25).key).toBe('DOWN');
    expect(fitZoomFor({ x: 0, y: 0, width: 100, height: 100 }, DESKTOP)).toBe(1);
  });

  test('canvas height adapts: short for small diagrams, capped for tall ones', () => {
    const small = preferredCanvasHeight({ bounds: { x: 0, y: 0, width: 300, height: 100 }, width: 860, insets: INSETS, viewportHeight: 900 });
    const tall = preferredCanvasHeight({ bounds: { x: 0, y: 0, width: 400, height: 3000 }, width: 860, insets: INSETS, viewportHeight: 900 });
    expect(small).toBeLessThan(300);
    expect(tall).toBeLessThanOrEqual(Math.round(900 * 0.72));
    expect(tall).toBeGreaterThan(small);
  });

  test('boundsOf uses each node\'s layout size', () => {
    const b = boundsOf([{ position: { x: 10, y: 20 }, data: { width: 100, height: 40 } }, { position: { x: 200, y: 100 }, data: { width: 50, height: 30 } }]);
    expect(b).toEqual({ x: 10, y: 20, width: 240, height: 110 });
  });
});

describe('text measurement', () => {
  test('wrapping: narrower width means more lines, never wider than allowed', () => {
    const text = 'Evidence-based beta blocker (carvedilol, bisoprolol, metoprolol succinate)';
    const wide = wrapText(text, { fontSize: 12, weight: 500, maxWidth: 400 });
    const narrow = wrapText(text, { fontSize: 12, weight: 500, maxWidth: 150 });
    expect(narrow.lines).toBeGreaterThan(wide.lines);
    expect(narrow.width).toBeLessThanOrEqual(150);
  });

  test('an over-long single word (a drug name) is broken rather than overflowing', () => {
    const r = wrapText('Pneumonoultramicroscopicsilicovolcanoconiosis', { fontSize: 12, weight: 600, maxWidth: 120 });
    expect(r.lines).toBeGreaterThan(1);
    expect(r.width).toBeLessThanOrEqual(120);
  });

  test('node size honours min/max width and grows in height for long labels', () => {
    const spec = { fontSize: 12, weight: 500, lineHeight: 1.4, padX: 10, padY: 8, minWidth: 90, maxWidth: 200 };
    expect(measureNode('Ok', spec).width).toBe(90);
    const long = measureNode('A long medical finding that will need several lines to wrap inside the node', spec);
    expect(long.width).toBeLessThanOrEqual(200);
    expect(long.height).toBeGreaterThan(measureNode('Short', spec).height);
  });

  test('hierarchy: a root node is larger than a secondary node with the same text; icons add room', () => {
    const root = sizeForNode({ label: 'Septic shock', variant: 'root' });
    const sec = sizeForNode({ label: 'Septic shock', variant: 'secondary' });
    expect(root.width).toBeGreaterThan(sec.width);
    expect(root.height).toBeGreaterThan(sec.height);
    expect(sizeForNode({ label: 'Septic shock', variant: 'standard', icon: '🚩' }).width)
      .toBeGreaterThan(sizeForNode({ label: 'Septic shock', variant: 'standard' }).width);
  });
});

function chain(n, extraSkips = 0, words = 3) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, label: Array.from({ length: words }, (_, w) => `word${w}`).join(' '),
    category: i === 0 ? 'cause' : i === n - 1 ? 'consequence' : 'mechanism', sourceType: 'entry', sourceRef: 'x', explanation: 'x' }));
  const edges = [];
  for (let i = 1; i < n; i++) edges.push({ source: `m${Math.max(0, Math.floor((i - 1) / 2))}`, target: `m${i}`, relationship: 'causes', label: '' });
  for (let k = 0; k < extraSkips; k++) edges.push({ source: 'm0', target: `m${n - 1 - k}`, relationship: 'contributes_to', label: '' });
  return { topic: 't', nodes, edges };
}

describe('sequential (mechanism) layout', () => {
  test.each([['small', 4], ['medium', 12], ['large', 30]])('%s chain: no overlapping nodes, both directions', (_n, size) => {
    const d = chain(size, 2, 6);
    for (const direction of ['RIGHT', 'DOWN']) {
      const sizes = new Map(d.nodes.map(n => [n.id, sizeForNode({ label: n.label, variant: 'standard' })]));
      const pos = computeSequentialLayout(d.nodes, d.edges, { sizeOf: id => sizes.get(id), direction });
      const rects = d.nodes.map(n => ({ ...pos.get(n.id), w: sizes.get(n.id).width, h: sizes.get(n.id).height }));
      expect(hasOverlap(rects, 4)).toBe(false);
    }
  });

  test('a link that skips layers gets waypoints in its own lane, clear of every node', () => {
    const d = chain(9, 1, 4);
    const sizes = new Map(d.nodes.map(n => [n.id, sizeForNode({ label: n.label, variant: 'standard' })]));
    const { positions, routes } = computeSequentialLayoutWithRoutes(d.nodes, d.edges, { sizeOf: id => sizes.get(id), direction: 'DOWN' });
    const skipIndex = d.edges.length - 1;
    const wps = routes.get(skipIndex);
    expect(wps.length).toBeGreaterThan(0);
    for (const p of wps) {
      for (const n of d.nodes) {
        const r = { ...positions.get(n.id), ...sizes.get(n.id) };
        const inside = p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
        expect(inside).toBe(false);
      }
    }
  });

  test('builder: chooses top-to-bottom for a phone, and keeps shown labels off nodes', () => {
    const d = chain(10, 1, 4);
    const phone = buildMechanismDiagramFlowGraph(d, T, { container: PHONE });
    expect(phone.meta.direction).toBe('DOWN');
    const desktop = buildMechanismDiagramFlowGraph(chain(4, 0, 2), T, { container: DESKTOP });
    expect(desktop.meta.direction).toBe('RIGHT');
    expect(desktop.flowEdges.every(e => e.markerEnd?.type === 'arrowclosed')).toBe(true);

    // Every label that will be shown sits clear of every node (curve midpoint, as BranchEdge draws it).
    const { flowNodes, flowEdges } = buildMechanismDiagramFlowGraph(chain(10, 1, 4), T, { direction: 'RIGHT' });
    const rect = (id) => { const n = flowNodes.find(f => f.id === id); return { x: n.position.x, y: n.position.y, w: n.data.width, h: n.data.height }; };
    const shown = flowEdges.filter(e => e.label && e.data.showLabel);
    expect(shown.length).toBeGreaterThan(0);
    for (const e of shown) {
      let mid;
      if (e.type === 'routed') mid = polylineMidpoint(e.data.points);
      else {
        const a = facingAnchors(rect(e.source), rect(e.target), e.data.axis);
        mid = sideCurve(a.start, a.startSide, a.end, a.endSide).mid;
      }
      const sz = measureNode(e.label, EDGE_LABEL_SPEC);
      const lb = { x: mid.x - sz.width / 2, y: mid.y - sz.height / 2, w: sz.width, h: sz.height };
      expect(flowNodes.some(n => intersects(lb, rect(n.id)))).toBe(false);
    }
  });
});

describe('flowchart builder (ELK)', () => {
  const flow = {
    topic: 'PE', nodes: [
      { id: 's', label: 'Suspected PE', category: 'start' }, { id: 'd', label: 'Hemodynamically stable?', category: 'decision' },
      { id: 'l', label: 'Thrombolysis', category: 'red_flag' }, { id: 'c', label: 'CT pulmonary angiogram', category: 'action' },
      { id: 'a', label: 'Anticoagulate', category: 'outcome' },
    ].map(n => ({ ...n, sourceType: 'entry', sourceRef: 'x', explanation: 'x' })),
    edges: [{ source: 's', target: 'd', relationship: 'then', label: '' }, { source: 'd', target: 'l', relationship: 'b', label: 'Unstable (SBP < 90)' },
      { source: 'd', target: 'c', relationship: 'b', label: 'Stable' }, { source: 'c', target: 'a', relationship: 'then', label: '' }],
  };

  test('branch labels are ELK-placed off every node and off each other; edges keep ELK routes and arrows', async () => {
    const { flowNodes, flowEdges } = await buildClinicalFlowchartFlowGraph(flow, T, { container: DESKTOP });
    const nodeBoxes = flowNodes.map(n => ({ x: n.position.x, y: n.position.y, w: n.data.width, h: n.data.height }));
    const labelled = flowEdges.filter(e => e.label);
    expect(labelled).toHaveLength(2);
    const labelBoxes = labelled.map(e => toBox(e.data.labelBox));
    for (const lb of labelBoxes) expect(nodeBoxes.some(nb => intersects(lb, nb))).toBe(false);
    expect(hasOverlap(labelBoxes)).toBe(false);
    expect(flowEdges.every(e => e.type === 'routed' && e.data.points.length >= 2 && e.markerEnd.type === 'arrowclosed')).toBe(true);
    expect(hasOverlap(nodeBoxes, 4)).toBe(false);
  });
});

describe('geometry, overlap removal, label culling, selection', () => {
  test('rectBorderPoint lands on the rectangle border toward the target', () => {
    const p = rectBorderPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 500, y: 20 });
    expect(p).toEqual({ x: 100, y: 20 });
    const q = rectBorderPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 50, y: 400 });
    expect(q).toEqual({ x: 50, y: 40 });
  });

  test('facingAnchors connects facing sides; paths are well-formed', () => {
    const a = facingAnchors({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 0, w: 100, h: 40 }, 'x');
    expect(a.startSide).toBe('right');
    expect(a.endSide).toBe('left');
    expect(roundedPolylinePath([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 50, y: 50 }], 8)).toMatch(/^M 0 0 L .* Q .* L 50 50$/);
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 0, y: 60 }])).toMatch(/^M 0 0 C /);
    expect(polylineMidpoint([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toEqual({ x: 0, y: 50 });
  });

  test('removeOverlaps separates a pile of identical boxes deterministically', () => {
    const rects = Array.from({ length: 12 }, () => ({ x: 0, y: 0, w: 120, h: 40 }));
    removeOverlaps(rects, { margin: 10 });
    expect(hasOverlap(rects, 9)).toBe(false);
  });

  test('placeLabels drops labels that would land on a node or another label', () => {
    const kept = placeLabels([
      { key: 'clear', cx: 300, cy: 300, width: 60, height: 18 },
      { key: 'onNode', cx: 50, cy: 20, width: 60, height: 18 },
      { key: 'onLabel', cx: 305, cy: 302, width: 60, height: 18 },
    ], [{ x: 0, y: 0, width: 100, height: 40 }]);
    expect([...kept]).toEqual(['clear']);
  });

  test('selection dims everything outside the selected node\'s neighbourhood and reveals its link labels', () => {
    const nodes = ['a', 'b', 'c'].map(id => ({ id, position: { x: 0, y: 0 }, data: {} }));
    const edges = [{ id: 'ab', source: 'a', target: 'b', data: { showLabel: false } }, { id: 'bc', source: 'b', target: 'c', data: { showLabel: false } }];
    const { flowNodes, flowEdges } = applySelection(nodes, edges, 'a');
    expect(flowNodes.find(n => n.id === 'c').data.dimmed).toBe(true);
    expect(flowNodes.find(n => n.id === 'b').data.dimmed).toBe(false);
    expect(flowEdges.find(e => e.id === 'ab').data).toMatchObject({ dimmed: false, showLabel: true });
    expect(flowEdges.find(e => e.id === 'bc').data.dimmed).toBe(true);
  });
});
