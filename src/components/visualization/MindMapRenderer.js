// components/visualization/MindMapRenderer.js
//
// The actual React Flow canvas — this module (and everything it imports)
// is the thing VisualLearningPanel.js code-splits via React.lazy, so
// @xyflow/react's runtime and its stylesheet only ever reach the browser
// once a user actually opens the Visual Learning preview, never as part
// of the app's main bundle (see Phase 2's own bundle-size requirement).
//
// Self-contained on purpose: node selection/detail-panel state and the
// fullscreen toggle all live here, not lifted to VisualLearningPanel —
// a caller just hands this a validated {centralTopic, nodes, edges}
// diagram and gets a fully interactive viewer back, nothing more to wire.
import { useMemo, useState, useCallback } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  ConnectionMode, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../../lib/theme';
import MindMapNode from './MindMapNode';
import { buildFlowGraph } from './mindMapGraph';

const NODE_TYPES = { mindMapNode: MindMapNode };

const CATEGORY_LEGEND = [
  { category: 'central_topic', label: 'Central topic' },
  { category: 'branch', label: 'Branch' },
  { category: 'subtopic', label: 'Subtopic' },
  { category: 'red_flag', label: 'Red flag' },
  { category: 'high_yield', label: 'High yield' },
];

function legendSwatchStyle(t, category) {
  switch (category) {
    case 'central_topic': return { background: t.accent, border: `2px solid ${t.accent}` };
    case 'branch': return { background: t.surface, border: `2px solid ${t.accent}` };
    case 'red_flag': return { background: t.dangerBg, border: `2px solid ${t.dangerBorder}` };
    case 'high_yield': return { background: t.warnBg, border: `2px solid ${t.warnBorder}` };
    default: return { background: t.surface2, border: `1px solid ${t.border}` };
  }
}

function toolbarButtonStyle(t) {
  return {
    background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.sm,
    color: t.text3, fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold,
    fontFamily: 'Inter,sans-serif', padding: '8px 12px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
    minHeight: 34, // a comfortable touch target, not just a desktop click target
  };
}

// Legend text labels take real horizontal room a narrow phone viewport
// doesn't have to spare over the canvas itself — below ~480px wide, keep
// only the colour swatches (still communicates "these are different
// categories") and drop the label text, rather than wrapping into several
// cramped rows that eat into the diagram.
const RESPONSIVE_CSS = `
  @media (max-width: 480px) {
    .mb-mindmap-legend-label { display: none; }
    .mb-mindmap-legend { gap: 6px !important; padding: 6px 8px !important; }
  }
`;

/** Toolbar + detail panel live inside the provider so useReactFlow() works. */
function MindMapCanvas({ diagram, isFullscreen, onToggleFullscreen }) {
  const { t, isDark } = useTheme();
  const { zoomIn, zoomOut, fitView, setViewport } = useReactFlow();
  const [selectedId, setSelectedId] = useState(null);

  const { flowNodes, flowEdges } = useMemo(
    () => buildFlowGraph(diagram, t, { selectedId }),
    [diagram, t, selectedId]
  );

  const selectedNode = selectedId ? (diagram.nodes || []).find(n => n.id === selectedId) : null;

  const onNodeClick = useCallback((_evt, node) => {
    setSelectedId(prev => (prev === node.id ? null : node.id));
  }, []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const resetView = useCallback(() => {
    setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 250 });
  }, [setViewport]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <style>{RESPONSIVE_CSS}</style>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => instance.fitView({ padding: 0.25 })}
        forceColorMode={isDark ? 'dark' : 'light'}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color={t.border} />
      </ReactFlow>

      {/* Toolbar — MedBook's own flat button styling, not React Flow's
          default <Controls/> panel, so this reads as part of the app
          rather than a third-party widget dropped on top of it. */}
      <div style={{
        position: 'absolute', top: SPACE.md, left: SPACE.md, display: 'flex',
        gap: 6, flexWrap: 'wrap', zIndex: 5,
      }}>
        <button style={toolbarButtonStyle(t)} onClick={() => zoomIn({ duration: 150 })} title="Zoom in">+</button>
        <button style={toolbarButtonStyle(t)} onClick={() => zoomOut({ duration: 150 })} title="Zoom out">−</button>
        <button style={toolbarButtonStyle(t)} onClick={() => fitView({ padding: 0.25, duration: 250 })} title="Fit to screen">⤢ Fit</button>
        <button style={toolbarButtonStyle(t)} onClick={resetView} title="Reset view">⟲ Reset</button>
        <button style={toolbarButtonStyle(t)} onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '⤡ Exit' : '⤢ Fullscreen'}
        </button>
      </div>

      {/* Legend — small, static, bottom-left; tells a viewer what the five
          node treatments MEAN without needing a click. */}
      <div className="mb-mindmap-legend" style={{
        position: 'absolute', bottom: SPACE.md, left: SPACE.md, zIndex: 5,
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.md,
        padding: '8px 10px', display: 'flex', gap: 10, flexWrap: 'wrap',
        maxWidth: 'calc(100% - 32px)', fontFamily: 'Inter,sans-serif',
      }}>
        {CATEGORY_LEGEND.map(l => (
          <span key={l.category} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: FONT.size.micro, color: t.text4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, ...legendSwatchStyle(t, l.category) }} />
            <span className="mb-mindmap-legend-label">{l.label}</span>
          </span>
        ))}
      </div>

      {/* Expandable node detail — appears only once a node is selected;
          click the same node (or the canvas background) to close it. */}
      {selectedNode && (
        <div className="mb-mindmap-detail" style={{
          position: 'absolute', top: SPACE.md, right: SPACE.md, zIndex: 6,
          width: 280, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)',
          overflowY: 'auto', background: t.surface, border: `1px solid ${t.border}`,
          borderRadius: RADIUS.lg, padding: SPACE.md, boxShadow: `0 8px 24px ${t.shadowStrong}`,
          fontFamily: 'Inter,sans-serif',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: FONT.size.sm, fontWeight: FONT.weight.bold, color: t.text }}>{selectedNode.label}</div>
            <button onClick={() => setSelectedId(null)} aria-label="Close"
              style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: FONT.size.md, lineHeight: 1 }}>
              ✕
            </button>
          </div>
          <div style={{ fontSize: FONT.size.xs, color: t.text2, lineHeight: 1.6, marginBottom: 10 }}>
            {selectedNode.explanation}
          </div>
          <div style={{ fontSize: FONT.size.micro, color: t.text4, borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
            {selectedNode.sourceType === 'ai_context' ? 'From supplementary context, not the entry itself' : 'From the entry'}
            {selectedNode.sourceRef && (
              <div style={{ marginTop: 4, fontStyle: 'italic', color: t.text3 }}>"{selectedNode.sourceRef}"</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{centralTopic:string, nodes:Array, edges:Array}} diagram — a
 *   validated diagram, exactly as api/visualize.mjs's response shape
 *   carries it (response.visualization.graphData).
 */
export default function MindMapRenderer({ diagram }) {
  const { t } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);

  const canvas = (
    <ReactFlowProvider>
      <MindMapCanvas diagram={diagram} isFullscreen={isFullscreen} onToggleFullscreen={() => setFullscreen(f => !f)} />
    </ReactFlowProvider>
  );

  if (!isFullscreen) {
    return (
      // clamp() rather than a flat 480px — a short mobile viewport (landscape
      // phone, a small tablet split-screen) shouldn't be forced into the same
      // fixed height a full desktop window gets; Fullscreen remains the
      // recommended way to view a complex diagram on a small screen either way.
      <div style={{ width: '100%', height: 'clamp(320px, 65vh, 480px)', borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {canvas}
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: Z.lightbox, background: t.appBg }}>
      {canvas}
    </div>
  );
}
