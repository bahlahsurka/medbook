// Magnifier button in the app's top bar (every signed-in page). Opens a
// small panel with − / current % / + and Reset. The zoom itself lives in
// lib/uiZoom.js (applied app-wide, saved to the account).
import { useEffect, useRef, useState } from 'react';
import { useTheme, RADIUS, FONT, Z, elevation } from '../lib/theme';
import { IconZoom } from '../lib/icons';
import { ZOOM_STEPS, DEFAULT_ZOOM, useUiZoom, zoomIn, zoomOut, resetZoom } from '../lib/uiZoom';

const pct = (z) => `${Math.round(z * 100)}%`;
// Mouse/touch clicks must not move focus onto these buttons: review and
// study screens use Space/Enter as shortcuts, and a focused button would
// also be "pressed" by them.
const keepFocus = (e) => e.preventDefault();

export default function ZoomControl() {
  const { t } = useTheme();
  const zoom = useUiZoom();
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);
  const toggle = () => {
    if (!open && ref.current) {
      // Open toward whichever side has room for the 220px panel.
      const r = ref.current.getBoundingClientRect();
      setAlignRight(r.left + 228 > window.innerWidth);
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const atMin = zoom <= ZOOM_STEPS[0];
  const atMax = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const changed = zoom !== DEFAULT_ZOOM;

  // Fixed pixel sizes for the control itself, so it stays the same size
  // (and easy to find) whatever the zoom is.
  const stepBtn = (disabled) => ({
    width: 40, height: 40, borderRadius: RADIUS.md, border: `1px solid ${t.borderStrong}`,
    background: t.surface2, color: disabled ? t.text4 : t.text, fontSize: 22, fontWeight: 600, lineHeight: 1,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, fontFamily: 'Inter,sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  });

  return (
    <span ref={ref} className="mb-zoom-wrap" style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <style>{'.mb-zoom-btn:hover { filter: brightness(1.08); } .mb-zoom-btn:active { transform: scale(0.96); }'}</style>
      <button className="mb-zoom-btn" onMouseDown={keepFocus} onClick={toggle}
        aria-label={`Text size (${pct(zoom)})`} title={`Text size (${pct(zoom)})`}
        aria-haspopup="dialog" aria-expanded={open}
        style={{ background: t.accent, border: `1px solid ${t.accent}`, color: '#fff', cursor: 'pointer',
          borderRadius: RADIUS.pill, height: 30, padding: '0 11px 0 9px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, fontFamily: 'Inter,sans-serif',
          boxShadow: `0 2px 8px -2px ${t.accent}99`, whiteSpace: 'nowrap',
          transition: 'filter 120ms ease, transform 120ms ease' }}>
        <IconZoom size={16} />
        <span className="mb-zoom-pct">{pct(zoom)}</span>
      </button>

      {open && (
        <div role="dialog" aria-label="Text size" style={{
          position: 'absolute', ...(alignRight ? { right: 0 } : { left: 0 }), top: 'calc(100% + 8px)', zIndex: Z.dropdown + 100, width: 220,
          background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.lg,
          boxShadow: elevation(t, 'lg'), padding: 14, fontFamily: 'Inter,sans-serif',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text3, letterSpacing: .6, textTransform: 'uppercase', marginBottom: 12 }}>
            Text size
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <button onMouseDown={keepFocus} onClick={zoomOut} disabled={atMin} aria-label="Smaller text" style={stepBtn(atMin)}>−</button>
            <span aria-live="polite" style={{ fontSize: 18, fontWeight: 700, color: t.text, minWidth: 64, textAlign: 'center' }}>
              {pct(zoom)}
            </span>
            <button onMouseDown={keepFocus} onClick={zoomIn} disabled={atMax} aria-label="Larger text" style={stepBtn(atMax)}>+</button>
          </div>
          <button onMouseDown={keepFocus} onClick={resetZoom} disabled={!changed}
            style={{ marginTop: 12, width: '100%', height: 36, borderRadius: RADIUS.md, border: `1px solid ${t.border}`,
              background: 'none', color: changed ? t.text2 : t.text4, fontSize: 13, fontWeight: 600,
              cursor: changed ? 'pointer' : 'default', fontFamily: 'Inter,sans-serif' }}>
            Reset to 100%
          </button>
        </div>
      )}
    </span>
  );
}
