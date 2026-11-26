// Shared, read-only rendering of Key Points sections/bullets — used by the
// entry detail view (KeyPointsPanel) and the review screens (ReviewKeyPoints)
// so the two always present the same content the same way.
import { useTheme, FONT, fs } from '../lib/theme';
import { splitLeadTerm } from '../lib/keyPoints';

function emphasisStyle(t, emphasis) {
  switch (emphasis) {
    case 'red_flag': return { color: t.danger, fontWeight: FONT.weight.semibold, icon: '🚩' };
    case 'high_yield': return { color: t.text, fontWeight: FONT.weight.semibold, icon: '⭐' };
    default: return { color: t.text2, fontWeight: FONT.weight.regular, icon: null };
  }
}

export default function KeyPointsContent({ sections, compact = false }) {
  const { t } = useTheme();
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

    </>
  );
}
