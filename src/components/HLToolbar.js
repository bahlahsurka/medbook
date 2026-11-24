import { HL_COLORS } from '../lib/highlights';
import { useTheme, RADIUS, fs } from '../lib/theme';

/**
 * Highlight toolbar.
 *
 * THE KEY FIX: every button uses onMouseDown={e => e.preventDefault()}
 * This tells the browser "don't move focus away from the textarea"
 * so the text selection is still active when we read selectionStart/End.
 */
export default function HLToolbar({ onApply, onRemove, onClearAll, hasSelection, onToggleBold, onToggleUnderline, isBold, isUnderline }) {
  const { t } = useTheme();
  const prevent = e => e.preventDefault();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      flexWrap: 'wrap', marginBottom: 8,
      userSelect: 'none', WebkitUserSelect: 'none'
    }}>
      <span style={{ fontSize: fs(11), color: t.text4, fontWeight: 600 }}>
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
            // 26px read as a mis-tap risk on mobile right after selecting
            // text — exactly the moment a highlight color needs a precise
            // tap. 34px keeps the row compact while clearing a comfortable
            // touch target.
            width: 34, height: 34, borderRadius: RADIUS.sm,
            border: `2px solid ${hasSelection ? t.text2 : t.border}`,
            background: c.bg, cursor: 'pointer', flexShrink: 0,
            opacity: hasSelection ? 1 : 0.45,
            transition: 'opacity .15s, border-color .15s'
          }}
        />
      ))}

      {onToggleBold && (
        <>
          <button
            onMouseDown={prevent}
            onTouchStart={prevent}
            onClick={onToggleBold}
            disabled={!hasSelection}
            aria-pressed={isBold}
            title={hasSelection ? 'Bold (Ctrl+B)' : 'Select text first'}
            style={{
              width: 34, height: 34, borderRadius: RADIUS.sm, fontWeight: 800,
              border: `2px solid ${hasSelection ? t.text2 : t.border}`,
              background: isBold ? t.text2 : t.surface3, flexShrink: 0,
              color: isBold ? t.surface : t.text3,
              cursor: hasSelection ? 'pointer' : 'not-allowed',
              opacity: hasSelection ? 1 : 0.45,
              transition: 'opacity .15s, border-color .15s'
            }}>
            B
          </button>

          <button
            onMouseDown={prevent}
            onTouchStart={prevent}
            onClick={onToggleUnderline}
            disabled={!hasSelection}
            aria-pressed={isUnderline}
            title={hasSelection ? 'Underline (Ctrl+U)' : 'Select text first'}
            style={{
              width: 34, height: 34, borderRadius: RADIUS.sm, textDecoration: 'underline',
              border: `2px solid ${hasSelection ? t.text2 : t.border}`,
              background: isUnderline ? t.text2 : t.surface3, flexShrink: 0,
              color: isUnderline ? t.surface : t.text3,
              cursor: hasSelection ? 'pointer' : 'not-allowed',
              opacity: hasSelection ? 1 : 0.45,
              transition: 'opacity .15s, border-color .15s'
            }}>
            U
          </button>
        </>
      )}

      <button
        onMouseDown={prevent}
        onTouchStart={prevent}
        onClick={onRemove}
        disabled={!hasSelection}
        title={hasSelection ? 'Remove highlight from selected text' : 'Select text first'}
        style={{
          fontSize: fs(11), background: t.surface3, border: `1px solid ${t.border}`,
          borderRadius: RADIUS.sm, padding: '7px 12px',
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
            fontSize: fs(11), background: t.dangerBg, border: `1px solid ${t.dangerBorder}`,
            borderRadius: RADIUS.sm, padding: '7px 12px', cursor: 'pointer',
            color: t.danger, fontWeight: 600, fontFamily: 'Inter,sans-serif'
          }}>
          Clear all
        </button>
      )}

      {!hasSelection && (
        <span style={{ fontSize: fs(11), color: t.text4 }}>
          then tap a colour
        </span>
      )}
    </div>
  );
}
