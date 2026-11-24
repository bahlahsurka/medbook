import { useState } from 'react';
import { useTheme, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import KeyPointsContent from './KeyPointsContent';

// Legacy fallback: a SUBSET of the old six-section AI Analysis output —
// relatedTopics and flashcards aren't "key points to glance at while
// studying". Only used when an entry has no saved Phase 5 Key Points.
const SECTIONS = [
  { key:'keyLearningPoints', label:'Key Learning Points', icon:'🎯', accent:'#2563eb' },
  { key:'highYield',         label:'High Yield',          icon:'⭐', accent:'#d97706' },
  { key:'clinicalPearls',    label:'Clinical Pearls',     icon:'💡', accent:'#0891b2' },
  { key:'redFlags',          label:'Red Flags',           icon:'🚩', accent:'#dc2626' },
];

const COLLAPSE_PREF_KEY = 'medbook.review.keyPointsCollapsed';

function readCollapsedPref() {
  try { return window.localStorage.getItem(COLLAPSE_PREF_KEY) === '1'; } catch { return false; }
}
function writeCollapsedPref(collapsed) {
  try { window.localStorage.setItem(COLLAPSE_PREF_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
}

/**
 * True if there's anything for this panel to show. `sections` is the
 * normalized legacy analysis; `keyPoints` (optional) is getSavedKeyPoints()'s
 * output for the new format.
 */
export function hasKeyPoints(sections, keyPoints) {
  if (keyPoints?.sections?.length > 0) return true;
  return SECTIONS.some(s => Array.isArray(sections?.[s.key]) && sections[s.key].length > 0);
}

/** Smooth height collapse (CSS grid rows), no JS measurement. */
function Collapse({ open, children }) {
  return (
    <div style={{ display:'grid', gridTemplateRows: open ? '1fr' : '0fr', transition:`grid-template-rows ${MOTION.normal} ${MOTION.ease}` }}>
      <div aria-hidden={!open} style={{ overflow:'hidden', minHeight:0, visibility: open ? 'visible' : 'hidden', transition:`visibility 0s linear ${open ? '0s' : MOTION.normal}` }}>{children}</div>
    </div>
  );
}

/**
 * ReviewKeyPoints — read-only Key Points for the review screens' revealed
 * answer. Prefers the saved Phase 5 Key Points; otherwise falls back to the
 * legacy four sections. Never calls the AI service, and renders nothing
 * when neither format has content. One collapsible panel, collapse
 * preference remembered per browser so it sticks across cards. When
 * collapsed, the header still says how much is hidden — including any red
 * flags, so safety-critical points are never silently out of sight.
 */
export default function ReviewKeyPoints({ sections, keyPoints, isStale = false }) {
  const { t } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsedPref);

  const useNew = keyPoints?.sections?.length > 0;
  const legacy = useNew ? [] : SECTIONS
    .map(s => ({ ...s, items: Array.isArray(sections?.[s.key]) ? sections[s.key] : [] }))
    .filter(s => s.items.length > 0);

  if (!useNew && legacy.length === 0) return null;

  const pointCount = useNew
    ? keyPoints.sections.reduce((n, s) => n + s.bullets.length, 0)
    : legacy.reduce((n, s) => n + s.items.length, 0);
  const redFlagCount = useNew
    ? keyPoints.sections.reduce((n, s) => n + s.bullets.filter(b => b.emphasis === 'red_flag').length, 0)
    : (legacy.find(s => s.key === 'redFlags')?.items.length || 0);

  const toggle = () => setCollapsed(c => { writeCollapsedPref(!c); return !c; });

  return (
    <div style={{ fontFamily:'Inter,sans-serif', background:t.surface, border:`1px solid ${t.border}`,
      borderRadius:RADIUS.xl2, boxShadow:elevation(t,'sm'), padding:'4px 20px',
      paddingBottom: collapsed ? 4 : 18, transition:`padding-bottom ${MOTION.normal} ${MOTION.ease}` }}>
      <button onClick={toggle} aria-expanded={!collapsed}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:8, background:'none', border:'none',
          padding:'10px 0', minHeight:40, cursor:'pointer', fontFamily:'Inter,sans-serif', textAlign:'left' }}>
        <span style={{ fontSize:11, color:t.text4, letterSpacing:.8, fontWeight:700, textTransform:'uppercase', flex:1 }}>
          Key Points
          {collapsed && <span style={{ marginLeft:6, textTransform:'none', letterSpacing:0, fontWeight:FONT.weight.medium }}>· {pointCount}</span>}
        </span>
        {collapsed && redFlagCount > 0 && (
          <span title={`${redFlagCount} red flag${redFlagCount !== 1 ? 's' : ''}`} style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.bold,
            color:t.danger, background:t.dangerBg, border:`1px solid ${t.dangerBorder}`, borderRadius:RADIUS.pill, padding:'1px 7px' }}>
            🚩 {redFlagCount}
          </span>
        )}
        {isStale && !collapsed && (
          <span style={{ fontSize:FONT.size.micro, color:t.warn, fontWeight:FONT.weight.semibold }}>Review edited since</span>
        )}
        <span aria-hidden style={{ fontSize:10, color:t.text4, transform: collapsed ? 'none' : 'rotate(90deg)',
          transition:`transform ${MOTION.fast} ${MOTION.ease}` }}>▶</span>
      </button>

      <Collapse open={!collapsed}>
        <div style={{ paddingTop:4 }}>
          {useNew ? (
            <KeyPointsContent sections={keyPoints.sections} fidelityWarnings={keyPoints.fidelityWarnings}
              fidelityDisclaimer={keyPoints.fidelityDisclaimer} compact />
          ) : legacy.map((s, i) => (
            <div key={s.key} style={{ borderLeft:`3px solid ${s.accent}`, paddingLeft:14,
              marginBottom: i < legacy.length - 1 ? 18 : 0 }}>
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
      </Collapse>
    </div>
  );
}
