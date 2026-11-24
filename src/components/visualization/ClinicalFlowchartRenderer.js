// components/visualization/ClinicalFlowchartRenderer.js
//
// Clinical Flowchart: ELK 'layered' top-to-bottom with ELK's own
// orthogonal routes and branch-label placement (clinicalFlowchartGraph.js).
// A large flowchart opens at a readable zoom with its start node at the
// top, rather than shrunk to fit. Shared canvas: GraphDiagram.js.
import GraphDiagram from './GraphDiagram';
import { buildClinicalFlowchartFlowGraph } from './clinicalFlowchartGraph';

const CONFIG = {
  vizType: 'clinical_flowchart',
  build: (diagram, t, opts) => buildClinicalFlowchartFlowGraph(diagram, t, { container: opts.container }),
  focusNodeId: (diagram) => (diagram?.nodes || []).find(n => n.category === 'start')?.id,
  alignFor: (meta) => (meta.direction === 'RIGHT' ? { alignX: 'start', alignY: 'center' } : { alignX: 'center', alignY: 'start' }),
  lockedCategory: 'start',
  legend: [
    { tone: 'root', label: 'Start' }, { tone: 'decision', label: 'Decision' }, { tone: 'neutral', label: 'Action' },
    { tone: 'ok', label: 'Outcome' }, { tone: 'danger', label: 'Red flag' },
  ],
};

/** @param {{diagram:{topic,nodes,edges}, editable?:boolean, onDraftChange?:(next:object)=>void}} props */
export default function ClinicalFlowchartRenderer({ diagram, editable = false, onDraftChange }) {
  return <GraphDiagram diagram={diagram} editable={editable} onDraftChange={onDraftChange} config={CONFIG} />;
}
