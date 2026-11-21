// components/visualization/MechanismDiagramRenderer.js
//
// Interactive Mechanism Diagram canvas. Simpler than KnowledgeNetwork/
// ClinicalFlowchartRenderer.js — mechanismDiagramGraph.js's layout is
// synchronous (no ELK), so this uses a plain useMemo the way
// MindMapRenderer.js does, no useEffect/loading-state needed. Still
// reuses the shared GraphNode/DiagramToolbar/DiagramDetailPanel rather
// than Mind Map's own private copies, for consistency with the other two
// NEW Phase 3 graph-based renderers.
import { useState, useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, ConnectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme, RADIUS, Z } from '../../lib/theme';
import GraphNode from './GraphNode';
import DiagramToolbar from './DiagramToolbar';
import DiagramDetailPanel from './DiagramDetailPanel';
import { buildMechanismDiagramFlowGraph } from './mechanismDiagramGraph';

const NODE_TYPES = { graphNode: GraphNode };

function MechanismDiagramCanvas({ diagram, isFullscreen, onToggleFullscreen }) {
  const { t, isDark } = useTheme();
  const [selectedId, setSelectedId] = useState(null);

  const baseFlow = useMemo(() => buildMechanismDiagramFlowGraph(diagram, t), [diagram, t]);
  const flow = useMemo(() => ({
    flowNodes: baseFlow.flowNodes.map(n => ({ ...n, selected: n.id === selectedId })),
    flowEdges: baseFlow.flowEdges,
  }), [baseFlow, selectedId]);

  const selectedNode = selectedId ? (diagram?.nodes || []).find(n => n.id === selectedId) : null;
  const onNodeClick = useCallback((_evt, node) => setSelectedId(prev => (prev === node.id ? null : node.id)), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={flow.flowNodes}
        edges={flow.flowEdges}
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
      <DiagramToolbar isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} />
      <DiagramDetailPanel node={selectedNode} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/** @param {{diagram:{topic,nodes,edges}}} props — validated Mechanism Diagram diagram. */
export default function MechanismDiagramRenderer({ diagram }) {
  const { t } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);

  const canvas = (
    <ReactFlowProvider>
      <MechanismDiagramCanvas diagram={diagram} isFullscreen={isFullscreen} onToggleFullscreen={() => setFullscreen(f => !f)} />
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
