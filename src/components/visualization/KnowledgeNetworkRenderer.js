// components/visualization/KnowledgeNetworkRenderer.js
//
// Interactive Knowledge Network canvas. Structurally similar to
// MindMapRenderer.js (Phase 2) but with one real difference: ELK's
// layout() is async, so this computes the base layout ONCE per
// (diagram, theme) change via useEffect, then applies selection
// highlighting with a cheap synchronous map rather than re-running ELK on
// every node click (see knowledgeNetworkGraph.js's own comment).
//
// Phase 4 (editable mode): when `editable` is true, the `diagram` prop is
// the caller's in-progress DRAFT, not the saved diagram, and this canvas
// additionally supports dragging (position persisted via moveNode),
// connecting two nodes (onConnect -> addEdge), and swaps the read-only
// DiagramDetailPanel for EditableDiagramDetailPanel. The async base-layout
// computation above is completely unaffected either way — editing only
// changes which diagram object feeds it and what's rendered around it;
// VIEW mode (editable=false, the default) is byte-for-byte what Phase 3
// shipped.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, ConnectionMode, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme, RADIUS, Z } from '../../lib/theme';
import GraphNode from './GraphNode';
import DiagramToolbar from './DiagramToolbar';
import DiagramDetailPanel from './DiagramDetailPanel';
import EditableDiagramDetailPanel from './EditableDiagramDetailPanel';
import { buildKnowledgeNetworkFlowGraph } from './knowledgeNetworkGraph';
import { addNode, updateNode, deleteNode, addEdge as addDiagramEdge, updateEdge, deleteEdge, moveNode } from './graphDiagramEdits';
import { CATEGORY_OPTIONS_BY_TYPE, DEFAULT_CATEGORY_BY_TYPE } from './graphCategories';

const NODE_TYPES = { graphNode: GraphNode };

function LoadingFill({ t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <span style={{ display: 'inline-block', width: 16, height: 16, border: `2px solid ${t.border}`,
        borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
    </div>
  );
}

function KnowledgeNetworkCanvas({ diagram, editable, onDraftChange, isFullscreen, onToggleFullscreen }) {
  const { t, isDark } = useTheme();
  const [selectedId, setSelectedId] = useState(null);
  const [baseFlow, setBaseFlow] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBaseFlow(null);
    buildKnowledgeNetworkFlowGraph(diagram, t).then(result => { if (!cancelled) setBaseFlow(result); });
    return () => { cancelled = true; };
  }, [diagram, t]);

  // VIEW-mode path (unchanged from Phase 3): a cheap selection overlay,
  // never touching React Flow's own drag-position tracking.
  const flow = useMemo(() => {
    if (!baseFlow) return null;
    return {
      flowNodes: baseFlow.flowNodes.map(n => ({ ...n, selected: n.id === selectedId })),
      flowEdges: baseFlow.flowEdges,
    };
  }, [baseFlow, selectedId]);

  // EDIT-mode path: React Flow's own node/edge state, so a drag feels
  // smooth (handled entirely client-side by onNodesChange) without
  // pushing a new draft — and re-running ELK — on every pixel of
  // movement; only onNodeDragStop below commits a FINAL position back to
  // the caller's draft. Safe to always call these hooks (Rules of Hooks);
  // their output simply goes unused in view mode.
  const [rfNodes, setRfNodes, onNodesChangeRf] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChangeRf] = useEdgesState([]);
  useEffect(() => {
    if (editable && baseFlow) {
      setRfNodes(baseFlow.flowNodes.map(n => ({ ...n, selected: n.id === selectedId })));
      setRfEdges(baseFlow.flowEdges);
    }
  }, [editable, baseFlow, selectedId, setRfNodes, setRfEdges]);

  const selectedNode = selectedId ? (diagram?.nodes || []).find(n => n.id === selectedId) : null;
  const onNodeClick = useCallback((_evt, node) => setSelectedId(prev => (prev === node.id ? null : node.id)), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const onNodeDragStop = useCallback((_evt, node) => {
    if (!editable) return;
    onDraftChange(moveNode(diagram, node.id, node.position));
  }, [editable, diagram, onDraftChange]);

  const onConnect = useCallback((params) => {
    if (!editable) return;
    onDraftChange(addDiagramEdge(diagram, params.source, params.target));
  }, [editable, diagram, onDraftChange]);

  const handleAddNode = useCallback(() => {
    const { diagram: next, id } = addNode(diagram, { category: DEFAULT_CATEGORY_BY_TYPE.knowledge_network });
    onDraftChange(next);
    setSelectedId(id);
  }, [diagram, onDraftChange]);

  const nodesById = useMemo(() => new Map((diagram?.nodes || []).map(n => [n.id, n])), [diagram]);

  if (!baseFlow) return <LoadingFill t={t} />;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={editable ? rfNodes : flow.flowNodes}
        edges={editable ? rfEdges : flow.flowEdges}
        onNodesChange={editable ? onNodesChangeRf : undefined}
        onEdgesChange={editable ? onEdgesChangeRf : undefined}
        nodeTypes={NODE_TYPES}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        nodesConnectable={!!editable}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => instance.fitView({ padding: 0.25 })}
        forceColorMode={isDark ? 'dark' : 'light'}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color={t.border} />
      </ReactFlow>
      <DiagramToolbar isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} onAddNode={editable ? handleAddNode : undefined} />
      {editable ? (
        <EditableDiagramDetailPanel
          node={selectedNode} edges={diagram?.edges || []} nodesById={nodesById}
          categoryOptions={CATEGORY_OPTIONS_BY_TYPE.knowledge_network}
          onUpdateNode={patch => onDraftChange(updateNode(diagram, selectedId, patch))}
          onDeleteNode={() => { onDraftChange(deleteNode(diagram, selectedId)); setSelectedId(null); }}
          onUpdateEdge={(i, patch) => onDraftChange(updateEdge(diagram, i, patch))}
          onDeleteEdge={i => onDraftChange(deleteEdge(diagram, i))}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        <DiagramDetailPanel node={selectedNode} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

/**
 * @param {{diagram:{topic,nodes,edges}, editable?:boolean, onDraftChange?:(next:object)=>void}} props
 *   `diagram` is the saved diagram in view mode, or the caller's
 *   in-progress draft when `editable` is true — see VisualLearningPanel.js.
 */
export default function KnowledgeNetworkRenderer({ diagram, editable = false, onDraftChange }) {
  const { t } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);

  const canvas = (
    <ReactFlowProvider>
      <KnowledgeNetworkCanvas diagram={diagram} editable={editable} onDraftChange={onDraftChange} isFullscreen={isFullscreen} onToggleFullscreen={() => setFullscreen(f => !f)} />
    </ReactFlowProvider>
  );

  if (!isFullscreen) {
    return (
      <div style={{ width: '100%', height: 'clamp(320px, 65vh, 480px)', borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {canvas}
      </div>
    );
  }
  return <div style={{ position: 'fixed', inset: 0, zIndex: Z.lightbox, background: t.appBg }}>{canvas}</div>;
}
