// components/visualization/ContentDiagramFrame.js
//
// Frame for the two non-graph types (Comparison Map, Visual Summary): a
// slim header bar (title, optional legend, fullscreen) above scrollable
// content. Inline it takes the content's natural height up to a cap, so a
// short summary has no dead space; fullscreen uses the same element (no
// remount) and Esc exits it. Same controls/touch sizes as the graph
// toolbar.
import { useState, useEffect, useCallback } from 'react';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../../lib/theme';
import { toolbarButtonStyle, toolbarGroupStyle } from './DiagramToolbar';
import { diagramCss } from './diagramStyles';

export default function ContentDiagramFrame({ title, legend, children, overlay }) {
  const { t, isDark } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);
  const toggle = useCallback(() => setFullscreen(f => !f), []);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setFullscreen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isFullscreen]);

  return (
    <div className="mb-viz" data-mb-viz-fullscreen={isFullscreen ? 'true' : undefined}
      style={isFullscreen
        ? { position: 'fixed', inset: 0, zIndex: Z.lightbox, background: t.appBg, display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }
        : { position: 'relative', width: '100%', maxHeight: 'min(72vh, 680px)', display: 'flex', flexDirection: 'column',
            borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.border}`, background: t.surface }}>
      <style>{diagramCss(t, isDark)}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 8px 8px 14px', borderBottom: `1px solid ${t.border}`,
        background: t.surface, flexShrink: 0, fontFamily: 'Inter,sans-serif' }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: FONT.size.base, fontWeight: FONT.weight.bold, color: t.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {legend}
        <div style={toolbarGroupStyle(t)}>
          <button className="mb-viz-btn" style={toolbarButtonStyle(t, { active: isFullscreen })} onClick={toggle}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="mb-viz-fade" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
        {overlay}
      </div>
    </div>
  );
}
