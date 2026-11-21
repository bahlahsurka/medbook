// components/visualization/DiagramToolbar.js
//
// Shared zoom/fit/reset/fullscreen toolbar for the Phase 3 graph renderers
// (Knowledge Network, Clinical Flowchart, Mechanism Diagram) — Mind Map
// keeps its own inline copy from Phase 2 unchanged (see this phase's
// "avoid unrelated refactoring" brief); every NEW renderer uses this one
// instead of re-writing the same five buttons a fourth time. Must be
// rendered INSIDE a <ReactFlowProvider> (uses useReactFlow()).
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';

function toolbarButtonStyle(t) {
  return {
    background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.sm,
    color: t.text3, fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold,
    fontFamily: 'Inter,sans-serif', padding: '8px 12px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', minHeight: 34,
  };
}

export default function DiagramToolbar({ isFullscreen, onToggleFullscreen }) {
  const { t } = useTheme();
  const { zoomIn, zoomOut, fitView, setViewport } = useReactFlow();
  const resetView = useCallback(() => setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 250 }), [setViewport]);

  return (
    <div style={{ position: 'absolute', top: SPACE.md, left: SPACE.md, display: 'flex', gap: 6, flexWrap: 'wrap', zIndex: 5 }}>
      <button style={toolbarButtonStyle(t)} onClick={() => zoomIn({ duration: 150 })} title="Zoom in">+</button>
      <button style={toolbarButtonStyle(t)} onClick={() => zoomOut({ duration: 150 })} title="Zoom out">−</button>
      <button style={toolbarButtonStyle(t)} onClick={() => fitView({ padding: 0.25, duration: 250 })} title="Fit to screen">⤢ Fit</button>
      <button style={toolbarButtonStyle(t)} onClick={resetView} title="Reset view">⟲ Reset</button>
      <button style={toolbarButtonStyle(t)} onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        {isFullscreen ? '⤡ Exit' : '⤢ Fullscreen'}
      </button>
    </div>
  );
}
