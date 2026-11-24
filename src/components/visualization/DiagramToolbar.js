// components/visualization/DiagramToolbar.js
//
// One floating control group shared by every graph diagram (and, via
// `toolbarButtonStyle`, the header controls of Comparison Map / Visual
// Summary), so all six types share the same controls and touch sizes.
// Must render inside a <ReactFlowProvider>.
//
// "Fit" shows the whole diagram; "Reset" returns to the initial readable
// view (see viewport.js). Both hand viewport control back to the automatic
// fitting, so a later resize/fullscreen re-centres again.
import { useReactFlow } from '@xyflow/react';
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';

export function toolbarButtonStyle(t, { active } = {}) {
  return {
    background: active ? t.navActiveBg : 'transparent',
    border: 'none',
    color: active ? t.navActiveText : t.text3,
    fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
    padding: '0 10px', minWidth: 36, height: 34, borderRadius: RADIUS.sm, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, whiteSpace: 'nowrap',
  };
}

export function toolbarGroupStyle(t) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2,
    background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.md,
    boxShadow: 'var(--mb-viz-node-shadow)',
  };
}

const Divider = ({ t }) => <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '6px 2px', background: t.border }} />;

export default function DiagramToolbar({ isFullscreen, onToggleFullscreen, onFit, onReset, onAddNode, animate = true }) {
  const { t } = useTheme();
  const { zoomIn, zoomOut } = useReactFlow();
  const d = animate ? 160 : 0;
  return (
    <div style={{ position: 'absolute', top: SPACE.md, left: SPACE.md, display: 'flex', gap: 6, flexWrap: 'wrap', zIndex: 5 }}>
      <div style={toolbarGroupStyle(t)}>
        <button className="mb-viz-btn" style={toolbarButtonStyle(t)} onClick={() => zoomOut({ duration: d })} title="Zoom out" aria-label="Zoom out">−</button>
        <button className="mb-viz-btn" style={toolbarButtonStyle(t)} onClick={() => zoomIn({ duration: d })} title="Zoom in" aria-label="Zoom in">+</button>
        <Divider t={t} />
        <button className="mb-viz-btn" style={toolbarButtonStyle(t)} onClick={onFit} title="Show the whole diagram">Fit</button>
        <button className="mb-viz-btn" style={toolbarButtonStyle(t)} onClick={onReset} title="Back to the starting view">Reset</button>
        <Divider t={t} />
        <button className="mb-viz-btn" style={toolbarButtonStyle(t, { active: isFullscreen })} onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '⤡' : '⤢'}
        </button>
      </div>
      {onAddNode && (
        <div style={toolbarGroupStyle(t)}>
          <button className="mb-viz-btn" style={toolbarButtonStyle(t, { active: true })} onClick={onAddNode} title="Add a new node">+ Add node</button>
        </div>
      )}
    </div>
  );
}
