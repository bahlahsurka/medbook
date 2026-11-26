// components/visualization/GraphDiagram.js
//
// Shared interactive canvas for the four graph visualization types (Mind
// Map, Knowledge Network, Clinical Flowchart, Mechanism Diagram). Each
// renderer passes a static `config` (how to build its layout, where its
// entry point is, its legend and editing rules); everything else — the
// adaptive frame height, viewport fitting, selection, editing, toolbar,
// legend, minimap, fullscreen — is identical across types, and identical
// wherever a diagram appears (entry page, Review Queue, System Review).
//
// Viewport rules (viewport.js): fit once when the layout is ready; refit on
// container resize (fullscreen, rotation, drawer width) ONLY until the user
// pans/zooms themselves — after that their view is left alone. Fit/Reset
// hand control back to automatic fitting. In edit mode a changed draft
// never moves the viewport.
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap,
  ConnectionMode, useReactFlow, useNodesState, useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../../lib/theme';
import GraphNode from './GraphNode';
import DiagramToolbar from './DiagramToolbar';
import DiagramDetailPanel from './DiagramDetailPanel';
import EditableDiagramDetailPanel from './EditableDiagramDetailPanel';
import { EDGE_TYPES } from './diagramEdges';
import { applySelection } from './diagramSelection';
import { diagramCss, prefersReducedMotion } from './diagramStyles';
import { boundsOf, computeViewport, preferredCanvasHeight, maxCanvasHeight, ABSOLUTE_MIN_ZOOM } from './viewport';
import { toneStyle } from './nodeTheme';
import { addNode, updateNode, deleteNode, addEdge as addDiagramEdge, updateEdge, deleteEdge, moveNode } from './graphDiagramEdits';
import { CATEGORY_OPTIONS_BY_TYPE, DEFAULT_CATEGORY_BY_TYPE } from './graphCategories';

const NODE_TYPES = { graphNode: GraphNode, mindMapNode: GraphNode };

function insetsFor(width, hasLegend) {
  const side = width && width < 560 ? 12 : 22;
  return { top: 60, right: side, bottom: hasLegend ? 46 : side, left: side };
}

function useElementSize(ref) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize(prev => (prev && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1 ? prev : { width: r.width, height: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function LoadingFill({ t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: t.text4, fontSize: FONT.size.xs, fontFamily: 'Inter,sans-serif' }}>
      <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${t.border}`,
        borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
      Arranging diagram…
    </div>
  );
}

function GraphCanvas({ diagram, editable, onDraftChange, config, size, onBounds, isFullscreen, onToggleFullscreen }) {
  const { t, isDark } = useTheme();
  const rf = useReactFlow();
  const [selectedId, setSelectedId] = useState(null);
  const [connecting, setConnecting] = useState(false);

  // Layout options that depend on the container (e.g. Mechanism Diagram's
  // direction) are chosen ONCE, from the first measured width, so a later
  // resize never reshuffles the diagram under the user.
  const optsRef = useRef(null);
  if (!optsRef.current && size) {
    const width = size.width || 760;
    optsRef.current = {
      container: { width, height: maxCanvasHeight(window.innerHeight), insets: insetsFor(width, false) },
      ...(config.layoutOptionsFor ? config.layoutOptionsFor(width) : {}),
    };
  }
  const opts = optsRef.current;

  // The previous layout stays on screen while a new one computes (edits
  // used to unmount the canvas and reset the view on every change).
  const [base, setBase] = useState(null);
  useEffect(() => {
    if (!opts) return undefined;
    let cancelled = false;
    Promise.resolve(config.build(diagram, t, opts)).then(result => { if (!cancelled) setBase(result); });
    return () => { cancelled = true; };
  }, [diagram, t, opts, config]);

  const bounds = useMemo(() => (base ? boundsOf(base.flowNodes) : null), [base]);
  useEffect(() => { if (bounds) onBounds(bounds); }, [bounds, onBounds]);

  const view = useMemo(() => (base && !editable ? applySelection(base.flowNodes, base.flowEdges, selectedId) : null), [base, editable, selectedId]);

  const [rfNodes, setRfNodes, onNodesChangeRf] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChangeRf] = useEdgesState([]);
  useEffect(() => {
    if (editable && base) {
      setRfNodes(base.flowNodes.map(n => ({ ...n, selected: n.id === selectedId })));
      setRfEdges(base.flowEdges);
    }
  }, [editable, base, selectedId, setRfNodes, setRfEdges]);

  // ---- Viewport ----
  const reduced = prefersReducedMotion();
  const userMoved = useRef(false);
  const lastMode = useRef('initial');
  const fitted = useRef(false);
  const [shown, setShown] = useState(false);
  const [partial, setPartial] = useState(false);
  const [explored, setExplored] = useState(false);
  const insets = useMemo(() => insetsFor(size?.width, false), [size?.width]);

  const applyView = useCallback((mode, animate) => {
    if (!base || !size || !size.width || !size.height) return;
    const focusId = config.focusNodeId?.(diagram, base.flowNodes);
    const fn = focusId && base.flowNodes.find(n => n.id === focusId);
    const focus = fn ? { x: fn.position.x + (fn.data.width || 0) / 2, y: fn.position.y + (fn.data.height || 0) / 2 } : undefined;
    const align = config.alignFor ? config.alignFor(base.meta || {}) : { alignX: config.alignX, alignY: config.alignY };
    const vp = computeViewport({ bounds: boundsOf(base.flowNodes), width: size.width, height: size.height, insets, mode, focus, ...align });
    rf.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom }, { duration: animate && !reduced ? 260 : 0 });
    lastMode.current = mode;
    setPartial(!vp.fitsAll);
  }, [base, size, insets, config, diagram, rf, reduced]);

  const ready = !!base;
  useEffect(() => {
    if (!ready || !size) return undefined;
    if (!fitted.current) {
      fitted.current = true;
      applyView('initial', false);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    if (!userMoved.current) applyView(lastMode.current, false);
    return undefined;
    // Deliberately only on readiness/size: a changed edit draft must never move the view.
  }, [ready, size]);

  const onMoveStart = useCallback((event) => {
    if (event) { userMoved.current = true; setExplored(true); } // null = programmatic
  }, []);
  const fitAll = useCallback(() => { userMoved.current = false; applyView('all', true); }, [applyView]);
  const reset = useCallback(() => { userMoved.current = false; applyView('initial', true); }, [applyView]);

  // ---- Selection / editing ----
  const onNodeClick = useCallback((_e, node) => setSelectedId(prev => (prev === node.id ? null : node.id)), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);
  const onNodeDragStop = useCallback((_e, node) => {
    if (editable) onDraftChange(moveNode(diagram, node.id, node.position));
  }, [editable, diagram, onDraftChange]);
  const onConnect = useCallback((params) => {
    if (editable) onDraftChange(addDiagramEdge(diagram, params.source, params.target));
  }, [editable, diagram, onDraftChange]);
  const handleAddNode = useCallback(() => {
    const { diagram: next, id } = addNode(diagram, { category: DEFAULT_CATEGORY_BY_TYPE[config.vizType] });
    onDraftChange(next);
    setSelectedId(id);
  }, [diagram, onDraftChange, config.vizType]);

  const nodesById = useMemo(() => new Map((diagram?.nodes || []).map(n => [n.id, n])), [diagram]);
  const selectedNode = selectedId ? nodesById.get(selectedId) : null;
  const locked = selectedNode && selectedNode.category === config.lockedCategory;

  if (!base) return <LoadingFill t={t} />;

  const roomForMiniMap = (size?.width || 0) >= 600 && (size?.height || 0) >= 380;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ReactFlow
        className={`mb-viz-flow${editable ? ' mb-viz-editing' : ''}${connecting ? ' mb-viz-connecting' : ''}`}
        style={{ opacity: shown ? 1 : 0 }}
        nodes={editable ? rfNodes : view.flowNodes}
        edges={editable ? rfEdges : view.flowEdges}
        onNodesChange={editable ? onNodesChangeRf : undefined}
        onEdgesChange={editable ? onEdgesChangeRf : undefined}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={() => setConnecting(true)}
        onConnectEnd={() => setConnecting(false)}
        onPaneClick={onPaneClick}
        onMoveStart={onMoveStart}
        nodesDraggable={!!editable}
        nodesConnectable={!!editable}
        elementsSelectable
        // Inline, the mouse wheel keeps scrolling the page; zoom is pinch,
        // Ctrl/⌘+wheel, or the toolbar. Fullscreen has no page to scroll.
        zoomOnScroll={isFullscreen}
        preventScrolling={isFullscreen}
        zoomOnPinch
        minZoom={ABSOLUTE_MIN_ZOOM}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        forceColorMode={isDark ? 'dark' : 'light'}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={t.border} />
        {partial && roomForMiniMap && (
          <MiniMap pannable zoomable position="bottom-right" style={{ width: 132, height: 88, background: t.surface }}
            nodeColor={n => n.data?.style?.rule || n.data?.style?.border || t.borderStrong}
            nodeStrokeWidth={0} maskColor={isDark ? 'rgba(0,0,0,.55)' : 'rgba(238,240,243,.72)'} />
        )}
      </ReactFlow>
      <DiagramToolbar isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} onFit={fitAll} onReset={reset}
        onAddNode={editable ? handleAddNode : undefined} animate={!reduced} />
      {partial && !explored && shown && (
        <div className="mb-viz-fade" style={{
          position: 'absolute', zIndex: 4, pointerEvents: 'none',
          ...((size?.width || 0) < 560 ? { top: 56, left: SPACE.md } : { top: SPACE.md + 8, right: SPACE.md }),
          fontSize: FONT.size.micro, color: t.text3, background: t.surface, border: `1px solid ${t.border}`,
          borderRadius: RADIUS.pill, padding: '3px 10px', whiteSpace: 'nowrap', fontFamily: 'Inter,sans-serif',
        }}>
          Drag to explore · Fit shows everything
        </div>
      )}
      {editable ? (
        <EditableDiagramDetailPanel
          node={selectedNode} edges={diagram?.edges || []} nodesById={nodesById}
          // A type's one required anchor (central topic / start) can't be
          // deleted or re-categorized — the validator requires exactly one.
          categoryOptions={locked ? [] : CATEGORY_OPTIONS_BY_TYPE[config.vizType]}
          canDelete={!locked}
          onUpdateNode={patch => onDraftChange(updateNode(diagram, selectedId, patch))}
          onDeleteNode={() => { onDraftChange(deleteNode(diagram, selectedId)); setSelectedId(null); }}
          onUpdateEdge={(i, patch) => onDraftChange(updateEdge(diagram, i, patch))}
          onDeleteEdge={i => onDraftChange(deleteEdge(diagram, i))}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        <DiagramDetailPanel
          node={selectedNode}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/**
 * @param {{diagram:object, editable?:boolean, onDraftChange?:(next:object)=>void, config:object}} props
 *   `config` must be a stable (module-level) object — see the renderers.
 */
export default function GraphDiagram({ diagram, editable = false, onDraftChange, config }) {
  const { t, isDark } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);
  const frameRef = useRef(null);
  const size = useElementSize(frameRef);
  const [bounds, setBounds] = useState(null);
  const onBounds = useCallback((b) => setBounds(prev => (prev && prev.width === b.width && prev.height === b.height ? prev : b)), []);
  const toggleFullscreen = useCallback(() => setFullscreen(f => !f), []);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setFullscreen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isFullscreen]);

  const height = bounds && size?.width
    ? preferredCanvasHeight({ bounds, width: size.width, insets: insetsFor(size.width, false), viewportHeight: window.innerHeight })
    : 340;

  // The SAME element switches between inline and fullscreen styling, so the
  // canvas (and the user's view) is never remounted by toggling fullscreen.
  return (
    <div ref={frameRef} className="mb-viz" data-mb-viz-fullscreen={isFullscreen ? 'true' : undefined}
      style={isFullscreen
        ? { position: 'fixed', inset: 0, zIndex: Z.lightbox, background: isDark ? t.bg : t.surface2, paddingTop: 'env(safe-area-inset-top)' }
        : { position: 'relative', width: '100%', height, borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.border}`, background: isDark ? t.bg : t.surface2 }}>
      <style>{diagramCss(t, isDark)}</style>
      <ReactFlowProvider>
        <GraphCanvas diagram={diagram} editable={editable} onDraftChange={onDraftChange} config={config}
          size={size} onBounds={onBounds} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />
      </ReactFlowProvider>
    </div>
  );
}
