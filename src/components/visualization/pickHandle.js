// components/visualization/pickHandle.js
//
// Shared by the Phase 3 graph builders (Knowledge Network, Clinical
// Flowchart, Mechanism Diagram) — mindMapGraph.js has its own identical
// copy from Phase 2, left untouched rather than refactored to import this
// (zero regression risk to already-shipped Mind Map code). Picks which of
// GraphNode's/MindMapNode's four anchor handles points most toward (dx, dy).
export function pickHandle(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}
