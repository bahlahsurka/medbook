// components/visualization/MechanismDiagramRenderer.js
//
// Mechanism Diagram: a causal chain read left-to-right with arrows
// (mechanismDiagramGraph.js). When top-to-bottom reads clearly better in
// the container (phones, long chains) the same chain is laid out
// vertically instead — chosen once, from the first measured width.
// Shared canvas: GraphDiagram.js.
import GraphDiagram from './GraphDiagram';
import { buildMechanismDiagramFlowGraph } from './mechanismDiagramGraph';

const CONFIG = {
  vizType: 'mechanism_diagram',
  build: (diagram, t, opts) => buildMechanismDiagramFlowGraph(diagram, t, { container: opts.container }),
  focusNodeId: (diagram) => (diagram?.nodes || []).find(n => n.category === 'cause')?.id,
  alignFor: (meta) => (meta.direction === 'DOWN' ? { alignX: 'center', alignY: 'start' } : { alignX: 'start', alignY: 'center' }),
  legend: [
    { tone: 'strong', label: 'Cause' }, { tone: 'amber', label: 'Mechanism' },
    { tone: 'accent', label: 'Consequence' }, { tone: 'danger', label: 'Red flag' },
  ],
};

/** @param {{diagram:{topic,nodes,edges}, editable?:boolean, onDraftChange?:(next:object)=>void}} props */
export default function MechanismDiagramRenderer({ diagram, editable = false, onDraftChange }) {
  return <GraphDiagram diagram={diagram} editable={editable} onDraftChange={onDraftChange} config={CONFIG} />;
}
