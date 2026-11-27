// components/visualization/rendererRegistry.js
//
// The six diagram formats and their (lazily loaded) read-only renderers,
// shared by the entry page's Visual Learning panel and the review card's
// on-card diagram. Lazy components are created once at module scope so each
// is a stable component reference across re-renders.
import { lazy } from 'react';

export const VISUALIZATION_TYPES = [
  { key: 'mind_map', label: 'Mind Map', family: 'graph' },
  { key: 'knowledge_network', label: 'Knowledge Network', family: 'graph' },
  { key: 'clinical_flowchart', label: 'Clinical Flowchart', family: 'graph' },
  { key: 'mechanism_diagram', label: 'Mechanism Diagram', family: 'graph' },
  { key: 'comparison_map', label: 'Comparison Map', family: 'comparison' },
  { key: 'visual_summary', label: 'Visual Summary', family: 'summary' },
];
export const TYPE_BY_KEY = Object.fromEntries(VISUALIZATION_TYPES.map(t => [t.key, t]));

export const RENDERER_BY_TYPE = {
  mind_map: lazy(() => import('./MindMapRenderer')),
  knowledge_network: lazy(() => import('./KnowledgeNetworkRenderer')),
  clinical_flowchart: lazy(() => import('./ClinicalFlowchartRenderer')),
  mechanism_diagram: lazy(() => import('./MechanismDiagramRenderer')),
  comparison_map: lazy(() => import('./ComparisonMapRenderer')),
  visual_summary: lazy(() => import('./VisualSummaryRenderer')),
};
