import { HL_COLORS } from '../lib/highlights';
import { useTheme } from '../lib/theme';

/**
 * Highlight toolbar.
 *
 * THE KEY FIX: every button uses onMouseDown={e => e.preventDefault()}
 * This tells the browser "don't move focus away from the textarea"
 * so the text selection is still active when we read selectionStart/End.
 */
export default function HLToolbar({ onApply, onRemove, onClearAll, hasSelection }) {
  const { t } = useTheme();
  const prevent = e => e.preventDefault();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      flexWrap: 'wrap', marginBottom: 8,
      userSelect: 'none', WebkitUserSelect: 'none'
    }}>
      <span style={{ fontSize: 11, color: t.text4, fontWeight: 600 }}>
        {hasSelection ? 'Apply:' : 'Select text:'}
      </span>

      {HL_COLORS.map((c, i) => (
        <button
          key={i}
          title={c.label}
          onMouseDown={prevent}
          onTouchStart={prevent}
          onClick={() => onApply(c)}
          style={{
            width: 26, height: 26, borderRadius: 6,
            border: `2px solid ${hasSelection ? t.text2 : t.border}`,
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
        disabled={!hasSelection}
        title={hasSelection ? 'Remove highlight from selected text' : 'Select text first'}
        style={{
          fontSize: 11, background: t.surface3, border: `1px solid ${t.border}`,
          borderRadius: 5, padding: '3px 10px',
          cursor: hasSelection ? 'pointer' : 'not-allowed',
          color: t.text3, fontWeight: 600, fontFamily: 'Inter,sans-serif',
          opacity: hasSelection ? 1 : 0.45
        }}>
        Remove
      </button>

      {onClearAll && (
        <button
          onMouseDown={prevent}
          onTouchStart={prevent}
          onClick={onClearAll}
          title="Remove every highlight in this entry"
          style={{
            fontSize: 11, background: t.dangerBg, border: `1px solid ${t.dangerBorder}`,
            borderRadius: 5, padding: '3px 10px', cursor: 'pointer',
            color: t.danger, fontWeight: 600, fontFamily: 'Inter,sans-serif'
          }}>
          Clear all
        </button>
      )}

      {!hasSelection && (
        <span style={{ fontSize: 11, color: t.text4 }}>
          then tap a colour
        </span>
      )}
    </div>
  );
}
