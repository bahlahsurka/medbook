// components/visualization/KnowledgeNetworkRenderer.js
//
// Knowledge Network: ELK 'stress' + overlap removal (knowledgeNetworkGraph.js),
// hub concepts emphasised, direct arrows between related concepts.
// Selecting a concept dims everything but its neighbourhood and shows its
// relationship labels. Shared canvas: GraphDiagram.js.
import GraphDiagram from './GraphDiagram';
import { buildKnowledgeNetworkFlowGraph } from './knowledgeNetworkGraph';

function mostConnected(diagram) {
  const degree = new Map();
  (diagram?.edges || []).forEach(e => {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  });
  let best = null, max = -1;
  (diagram?.nodes || []).forEach(n => { const d = degree.get(n.id) || 0; if (d > max) { max = d; best = n.id; } });
  return best;
}

const CONFIG = {
  vizType: 'knowledge_network',
  build: (diagram, t) => buildKnowledgeNetworkFlowGraph(diagram, t),
  focusNodeId: mostConnected,
  alignX: 'center', alignY: 'center',
  legend: [
    { tone: 'accent', label: 'Key concept' }, { tone: 'neutral', label: 'Concept' },
    { tone: 'danger', label: 'Red flag' }, { tone: 'warn', label: 'High yield' },
  ],
};

/** @param {{diagram:{topic,nodes,edges}, editable?:boolean, onDraftChange?:(next:object)=>void}} props */
export default function KnowledgeNetworkRenderer({ diagram, editable = false, onDraftChange }) {
  return <GraphDiagram diagram={diagram} editable={editable} onDraftChange={onDraftChange} config={CONFIG} />;
}
