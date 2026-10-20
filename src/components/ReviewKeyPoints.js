import { useTheme, RADIUS, elevation } from '../lib/theme';

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
 *
 * ONE elevated panel, not a stack of separately-bordered boxes — each
 * section is just a colour-coded left rule + heading inside it, so this
 * reads as a single coherent surface (matching the answer card beside it)
 * instead of a pile of small cards.
 */
export default function ReviewKeyPoints({ sections }) {
  const { t } = useTheme();
  const visible = SECTIONS
    .map(s => ({ ...s, items: Array.isArray(sections?.[s.key]) ? sections[s.key] : [] }))
    .filter(s => s.items.length > 0);

  if (visible.length === 0) return null;

  return (
    <div style={{ fontFamily:'Inter,sans-serif', background:t.surface, border:`1px solid ${t.border}`,
      borderRadius:RADIUS.xl2, boxShadow:elevation(t,'sm'), padding:'18px 20px' }}>
      <div style={{ fontSize:11, color:t.text4, letterSpacing:.8, fontWeight:700,
        textTransform:'uppercase', marginBottom:16 }}>
        Key Points
      </div>
      {visible.map((s, i) => (
        <div key={s.key} style={{ borderLeft:`3px solid ${s.accent}`, paddingLeft:14,
          marginBottom: i < visible.length - 1 ? 18 : 0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:7 }}>
            <span style={{ fontSize:13 }}>{s.icon}</span>
            <span style={{ fontSize:12.5, fontWeight:700, color:t.text }}>{s.label}</span>
          </div>
          <ul style={{ margin:0, paddingLeft:16 }}>
            {s.items.map((item, j) => (
              <li key={j} style={{ fontSize:12.5, color:t.text2, lineHeight:1.65, marginBottom:4 }}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
