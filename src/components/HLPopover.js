import { useLayoutEffect, useRef, useState } from 'react';
import { HL_COLORS, resolveHL } from '../lib/highlights';
import { useTheme } from '../lib/theme';

const GAP = 10;        // px between selection and popover
const MARGIN = 8;      // min distance from viewport edge

/**
 * HLPopover — floating highlight bar that appears above the current text selection,
 * UWorld-style.
 *
 * `rect` is the selection's bounding client rect (viewport coords), or null to hide.
 * Position is `fixed`, so the caller just needs to pass a fresh rect on scroll.
 *
 * Every button uses onMouseDown/onTouchStart preventDefault so the browser never
 * moves focus or collapses the selection before onClick reads it.
 */
export default function HLPopover({ rect, onApply, onRemove, onCopy, hasHighlightInSelection }) {
  const { t, isDark } = useTheme();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0, below: false, ready: false });

  useLayoutEffect(() => {
    if (!rect || !ref.current) { setPos(p => ({ ...p, ready: false })); return; }
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    // Horizontal: centre on the selection, then clamp inside the viewport.
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));

    // Vertical: prefer above the selection; flip below if there isn't room.
    let top = rect.top - h - GAP;
    let below = false;
    if (top < MARGIN) { top = rect.bottom + GAP; below = true; }
    // If it would now fall off the bottom, pin it just inside.
    if (top + h > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    }
    setPos({ left, top, below, ready: true });
  }, [rect]);

  if (!rect) return null;

  const prevent = e => e.preventDefault();

  const btn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: 'pointer', fontFamily: 'Inter,sans-serif',
    background: 'transparent', color: t.text2, fontSize: 11, fontWeight: 600,
    padding: '0 8px', height: 30, borderRadius: 6, whiteSpace: 'nowrap',
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Highlight selection"
      onMouseDown={prevent}
      onTouchStart={prevent}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 1200,
        // Avoid a first-paint flash at (0,0) before we've measured.
        visibility: pos.ready ? 'visible' : 'hidden',
        display: 'flex', alignItems: 'center', gap: 2,
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 9,
        padding: 4,
        boxShadow: `0 6px 20px ${t.shadowStrong}`,
        userSelect: 'none', WebkitUserSelect: 'none',
      }}
    >
      {HL_COLORS.map((c, i) => {
        const shown = resolveHL(c, isDark);
        return (
          <button
            key={i}
            title={c.label}
            aria-label={`Highlight ${c.label}`}
            onMouseDown={prevent}
            onTouchStart={prevent}
            onClick={() => onApply(c)}
            style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: shown.bg,
              border: `1.5px solid ${isDark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.12)'}`,
              cursor: 'pointer', padding: 0,
            }}
          />
        );
      })}

      <div style={{ width: 1, height: 20, background: t.border, margin: '0 3px', flexShrink: 0 }} />

      <button
        onMouseDown={prevent}
        onTouchStart={prevent}
        onClick={onRemove}
        disabled={!hasHighlightInSelection}
        title={hasHighlightInSelection ? 'Remove highlight' : 'No highlight in selection'}
        style={{
          ...btn,
          color: hasHighlightInSelection ? t.danger : t.text4,
          cursor: hasHighlightInSelection ? 'pointer' : 'not-allowed',
          opacity: hasHighlightInSelection ? 1 : 0.5,
        }}>
        Remove
      </button>

      <button
        onMouseDown={prevent}
        onTouchStart={prevent}
        onClick={onCopy}
        title="Copy selected text"
        style={btn}>
        Copy
      </button>
    </div>
  );
}
