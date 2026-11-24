// components/visualization/MindMapRenderer.js
//
// Mind Map: a balanced two-sided tree around the central topic
// (mindMapLayout.js) with curved branch connections. The canvas, viewport
// fitting, editing, toolbar and fullscreen are shared with the other graph
// types via GraphDiagram.js. Code-split by VisualLearningPanel.js (React
// Flow never reaches the main bundle).
import GraphDiagram from './GraphDiagram';
import { buildFlowGraph } from './mindMapGraph';

const CONFIG = {
  vizType: 'mind_map',
  build: (diagram, t, opts) => buildFlowGraph(diagram, t, { container: opts.container }),
  focusNodeId: (diagram) => (diagram?.nodes || []).find(n => n.category === 'central_topic')?.id,
  // Outline (phone) layouts read from the top-left root; the others radiate from the centre.
  alignFor: (meta) => (meta.mode === 'outline' ? { alignX: 'start', alignY: 'start' } : { alignX: 'center', alignY: 'center' }),
  lockedCategory: 'central_topic',
  legend: [
    { tone: 'root', label: 'Central topic' }, { tone: 'accent', label: 'Branch' }, { tone: 'neutral', label: 'Subtopic' },
    { tone: 'danger', label: 'Red flag' }, { tone: 'warn', label: 'High yield' },
  ],
};

/**
 * @param {{diagram:{centralTopic,nodes,edges}, editable?:boolean, onDraftChange?:(next:object)=>void}} props
 *   `diagram` is the saved diagram, or the caller's draft when `editable`.
 */
export default function MindMapRenderer({ diagram, editable = false, onDraftChange }) {
  return <GraphDiagram diagram={diagram} editable={editable} onDraftChange={onDraftChange} config={CONFIG} />;
}
