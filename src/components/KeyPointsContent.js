// Shared, read-only rendering of Key Points sections/bullets — used by the
// entry detail view (KeyPointsPanel) and the review screens (ReviewKeyPoints)
// so the two always present the same content the same way.
import { useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, fs } from '../lib/theme';
import { splitLeadTerm } from '../lib/keyPoints';

function emphasisStyle(t, emphasis) {
  switch (emphasis) {
    case 'red_flag': return { color: t.danger, fontWeight: FONT.weight.semibold, icon: '🚩' };
    case 'high_yield': return { color: t.text, fontWeight: FONT.weight.semibold, icon: '⭐' };
    default: return { color: t.text2, fontWeight: FONT.weight.regular, icon: null };
  }
}

export default function KeyPointsContent({ sections, fidelityWarnings = [], fidelityDisclaimer, compact = false }) {
  const { t } = useTheme();
  const [showWarnings, setShowWarnings] = useState(false);
  const sectionGap = compact ? 12 : 14;

  return (
    <>
      {sections.map((s, i) => (
        <div key={i} style={{ marginBottom: i < sections.length - 1 ? sectionGap : 0 }}>
          {s.heading && (
            <div style={{ fontSize: fs(13), fontWeight: FONT.weight.bold, color: t.text, marginBottom: 6 }}>{s.heading}</div>
          )}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.bullets.map((b, j) => {
              const style = emphasisStyle(t, b.emphasis);
              const { lead, rest } = splitLeadTerm(b.text);
              return (
                <li key={j} style={{ fontSize: fs(12.5), color: style.color, fontWeight: style.fontWeight, lineHeight: 1.65, marginBottom: 4 }}>
                  {style.icon && <span style={{ marginRight: 5 }}>{style.icon}</span>}
                  {lead && <strong style={{ fontWeight: FONT.weight.bold, color: b.emphasis === 'red_flag' ? t.danger : t.text }}>{lead}: </strong>}
                  {rest}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {fidelityWarnings.length > 0 && (
        <div style={{ marginTop: SPACE.sm }}>
          <button onClick={() => setShowWarnings(s => !s)}
            style={{ background: 'none', border: 'none', color: t.warn, fontSize: FONT.size.xs,
              cursor: 'pointer', padding: 0, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif' }}>
            ⚠ {fidelityWarnings.length} potential issue{fidelityWarnings.length !== 1 ? 's' : ''} found {showWarnings ? '▾' : '▸'}
          </button>
          {showWarnings && (
            <div style={{ background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: RADIUS.md,
              padding: '10px 12px', marginTop: 6, fontSize: fs(11.5), color: t.text2 }}>
              <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
                {fidelityWarnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
              </ul>
              {fidelityDisclaimer && (
                <div style={{ color: t.text4, fontSize: FONT.size.micro, lineHeight: 1.5 }}>{fidelityDisclaimer}</div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
