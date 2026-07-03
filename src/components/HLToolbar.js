import { HL_COLORS } from '../lib/highlights';

/**
 * Highlight toolbar.
 *
 * THE KEY FIX: every button uses onMouseDown={e => e.preventDefault()}
 * This tells the browser "don't move focus away from the textarea"
 * so the text selection is still active when we read selectionStart/End.
 *
 * Works on Android Chrome. On iOS Safari, selection survives if the
 * toolbar is rendered inside the same scroll container as the textarea.
 */
export default function HLToolbar({ onApply, onRemove, hasSelection }) {
  const prevent = e => e.preventDefault();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      flexWrap: 'wrap', marginBottom: 8,
      userSelect: 'none', WebkitUserSelect: 'none'
    }}>
      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
        {hasSelection ? 'Apply:' : 'Select text:'}
      </span>

      {HL_COLORS.map((c, i) => (
        <button
          key={i}
          title={c.label}
          onMouseDown={prevent}   /* ← keeps textarea focused on desktop */
          onTouchStart={prevent}  /* ← keeps textarea focused on mobile  */
          onClick={() => onApply(c)}
          style={{
            width: 26, height: 26, borderRadius: 6,
            border: `2px solid ${hasSelection ? '#374151' : '#e5e7eb'}`,
            background: c.bg, cursor: 'pointer', flexShrink: 0,
            opacity: hasSelection ? 1 : 0.45,
            transition: 'opacity .15s, border-color .15s'
          }}
        />
      ))}

      <button
        onMouseDown={prevent}
        onTouchStart={prevent}
        onClick={onRemove}
        style={{
          fontSize: 11, background: '#f3f4f6', border: '1px solid #e5e7eb',
          borderRadius: 5, padding: '3px 10px', cursor: 'pointer',
          color: '#6b7280', fontWeight: 600, fontFamily: 'Inter,sans-serif',
          opacity: hasSelection ? 1 : 0.45
        }}>
        Remove
      </button>

      {!hasSelection && (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          then tap a colour
        </span>
      )}
    </div>
  );
}
