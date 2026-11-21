// components/visualization/ClinicalFlowchartRenderer.js
//
// Interactive Clinical Flowchart canvas. Same async-ELK-then-select
// pattern as KnowledgeNetworkRenderer.js — see that file's own comment on
// why selection is applied after the fact rather than re-triggering ELK.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, ConnectionMode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme, RADIUS, Z } from '../../lib/theme';
import GraphNode from './GraphNode';
import DiagramToolbar from './DiagramToolbar';
import DiagramDetailPanel from './DiagramDetailPanel';
import { buildClinicalFlowchartFlowGraph } from './clinicalFlowchartGraph';

const NODE_TYPES = { graphNode: GraphNode };

function LoadingFill({ t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <span style={{ display: 'inline-block', width: 16, height: 16, border: `2px solid ${t.border}`,
        borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
    </div>
  );
}

function ClinicalFlowchartCanvas({ diagram, isFullscreen, onToggleFullscreen }) {
  const { t, isDark } = useTheme();
  const [selectedId, setSelectedId] = useState(null);
  const [baseFlow, setBaseFlow] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBaseFlow(null);
    buildClinicalFlowchartFlowGraph(diagram, t).then(result => { if (!cancelled) setBaseFlow(result); });
    return () => { cancelled = true; };
  }, [diagram, t]);

  const flow = useMemo(() => {
    if (!baseFlow) return null;
    return {
      flowNodes: baseFlow.flowNodes.map(n => ({ ...n, selected: n.id === selectedId })),
      flowEdges: baseFlow.flowEdges,
    };
  }, [baseFlow, selectedId]);

  const selectedNode = selectedId ? (diagram?.nodes || []).find(n => n.id === selectedId) : null;
  const onNodeClick = useCallback((_evt, node) => setSelectedId(prev => (prev === node.id ? null : node.id)), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  if (!flow) return <LoadingFill t={t} />;

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
        minZoom={0.1}
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

/** @param {{diagram:{topic,nodes,edges}}} props — validated Clinical Flowchart diagram. */
export default function ClinicalFlowchartRenderer({ diagram }) {
  const { t } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);

  const canvas = (
    <ReactFlowProvider>
      <ClinicalFlowchartCanvas diagram={diagram} isFullscreen={isFullscreen} onToggleFullscreen={() => setFullscreen(f => !f)} />
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
