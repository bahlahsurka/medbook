import { useTheme } from '../lib/theme';

// Deliberately a SUBSET of AISections.js's six sections — relatedTopics and
// flashcards aren't "key points to glance at while studying", they're a
// discovery aid and a separate deck-building feature respectively. Same
// keys/icons/accents as AISections.js so this reads as the same feature,
// just a compact read-only view of it.
const SECTIONS = [
  { key:'keyLearningPoints', label:'Key Learning Points', icon:'🎯', accent:'#2563eb' },
  { key:'highYield',         label:'High Yield',          icon:'⭐', accent:'#d97706' },
  { key:'clinicalPearls',    label:'Clinical Pearls',     icon:'💡', accent:'#0891b2' },
  { key:'redFlags',          label:'Red Flags',           icon:'🚩', accent:'#dc2626' },
];

/** True if `sections` (already normalized) has anything to show in this panel. */
export function hasKeyPoints(sections) {
  return SECTIONS.some(s => Array.isArray(sections?.[s.key]) && sections[s.key].length > 0);
}

/**
 * ReviewKeyPoints — read-only rendering of an entry's EXISTING AI Analysis
 * output (entry.ai_sections, normalized via services/ai's normalizeSections)
 * for the Review Queue's revealed-answer screen. Never calls the AI service
 * itself — Review Queue must not trigger new AI requests — and renders
 * nothing at all (not an empty placeholder) when the entry has no analysis,
 * or the analysis has nothing in these four sections.
 */
export default function ReviewKeyPoints({ sections }) {
  const { t } = useTheme();
  const visible = SECTIONS
    .map(s => ({ ...s, items: Array.isArray(sections?.[s.key]) ? sections[s.key] : [] }))
    .filter(s => s.items.length > 0);

  if (visible.length === 0) return null;

  return (
    <div style={{ fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:11, color:t.text4, letterSpacing:.8, fontWeight:700,
        textTransform:'uppercase', marginBottom:10 }}>
        Key Points
      </div>
      {visible.map(s => (
        <div key={s.key} style={{ background:t.surface2, border:`1px solid ${t.border}`,
          borderLeft:`3px solid ${s.accent}`, borderRadius:10, padding:'10px 12px 11px', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
            <span style={{ fontSize:13 }}>{s.icon}</span>
            <span style={{ fontSize:12, fontWeight:700, color:t.text }}>{s.label}</span>
          </div>
          <ul style={{ margin:0, paddingLeft:16 }}>
            {s.items.map((item, i) => (
              <li key={i} style={{ fontSize:12.5, color:t.text2, lineHeight:1.6, marginBottom:3 }}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
