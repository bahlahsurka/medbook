// components/visualization/diagramStyles.js
//
// Shared CSS for every Visual Learning diagram, scoped under .mb-viz.
// Motion is deliberately small: a short fade/settle when nodes first
// appear and when the canvas has finished fitting, plus hover/selection
// feedback. Nothing animates on drag, zoom, or pan, and everything is
// switched off under prefers-reduced-motion.
export function diagramCss(t, isDark) {
  return `
  .mb-viz {
    --mb-viz-node-shadow: ${isDark ? '0 1px 2px rgba(0,0,0,.5), 0 4px 12px -6px rgba(0,0,0,.6)' : '0 1px 2px rgba(15,23,42,.06), 0 4px 12px -6px rgba(15,23,42,.16)'};
    --mb-viz-badge-bg: ${t.surface3};
    --mb-viz-badge-fg: ${t.text2};
    --mb-viz-label-bg: ${t.surface};
    --mb-viz-label-border: ${t.border};
    --mb-viz-label-fg: ${t.text3};
  }
  .mb-viz .react-flow__pane { cursor: grab; }
  .mb-viz .react-flow__pane.dragging { cursor: grabbing; }
  .mb-viz-node { transition: opacity 160ms ease, filter 140ms ease, outline-color 140ms ease; outline: 2px solid transparent; outline-offset: 2px;
    animation: mb-viz-node-in 220ms cubic-bezier(.2,.7,.2,1) backwards; }
  .mb-viz-node:hover { outline-color: ${t.accent}40; }
  .mb-viz-node--hex:hover { outline-color: transparent; filter: brightness(${isDark ? 1.15 : 0.98}); }
  .mb-viz-node--dim { opacity: .28; }
  @keyframes mb-viz-node-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
  .mb-viz-flow { transition: opacity 200ms ease; }
  .mb-viz-edge-label { animation: mb-viz-fade 200ms ease backwards; }
  .mb-viz-fade { animation: mb-viz-fade 180ms ease backwards; }
  .mb-viz-pop { animation: mb-viz-pop 160ms cubic-bezier(.2,.7,.2,1) backwards; }
  @keyframes mb-viz-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mb-viz-pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .mb-viz .react-flow__handle.mb-viz-handle { width: 10px; height: 10px; min-width: 0; min-height: 0; border: 2px solid ${t.surface};
    background: ${t.accent}; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
  .mb-viz .react-flow__handle.mb-viz-handle--live { pointer-events: auto; }
  .mb-viz-editing .mb-viz-node:hover .mb-viz-handle--live,
  .mb-viz-editing .react-flow__node.selected .mb-viz-handle--live,
  .mb-viz-editing.mb-viz-connecting .mb-viz-handle--live { opacity: 1; }
  .mb-viz-btn { transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
  .mb-viz-btn:hover:not(:disabled) { background: ${t.surface3}; color: ${t.text}; }
  .mb-viz-btn:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 1px; }
  .mb-viz .react-flow__minimap { border: 1px solid ${t.border}; border-radius: 8px; overflow: hidden; box-shadow: var(--mb-viz-node-shadow); }
  @media (max-width: 480px) { .mb-viz-legend-label { display: none; } }
  @media (prefers-reduced-motion: reduce) {
    .mb-viz *, .mb-viz { animation: none !important; transition: none !important; }
  }
  `;
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
