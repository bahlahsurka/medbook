// components/KeyPointsPanel.js
//
// Phase 5: the new "Key Points" presentation — a concise, exam-oriented
// textual summary that replaces the old High Yield/Clinical Pearls/Red
// Flags/Related Topics boxes in the entry detail view. Read-only (no
// per-bullet editing in this phase — out of scope, see Phase 5's brief) and
// collapsible, so a user can shrink it to give Visual Learning more room,
// exactly as the brief asks. A CONTROLLED component, the same relationship
// AISections.js already has with DetailView.js: this never calls the AI
// service or writes entries.ai_sections itself — DetailView owns both
// halves of that jsonb column (the old six-section fields AND the new
// `keyPoints` key) and must be the one place that merges a write to either
// without clobbering the other (see DetailView.js's own comment on this).
import { useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, elevation, MOTION } from '../lib/theme';
import { IconBrainSpark } from '../lib/icons';

function Collapse({ open, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr',
      transition: `grid-template-rows ${MOTION.normal} ${MOTION.ease}` }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

function emphasisStyle(t, emphasis) {
  switch (emphasis) {
    case 'red_flag': return { color: t.danger, fontWeight: FONT.weight.semibold, icon: '🚩' };
    case 'high_yield': return { color: t.text, fontWeight: FONT.weight.semibold, icon: '⭐' };
    default: return { color: t.text2, fontWeight: FONT.weight.regular, icon: null };
  }
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/**
 * @param {{
 *   keyPoints: {topic:string, sections:Array<{heading:string, bullets:Array<{text,emphasis,sourceRef}>}>}|null,
 *   fidelityWarnings?: string[], fidelityDisclaimer?: string,
 *   generatedAt?: string, model?: string, isStale?: boolean,
 *   busy?: boolean, error?: string,
 *   onGenerate: () => void,
 * }} props
 */
export default function KeyPointsPanel({ keyPoints, fidelityWarnings = [], fidelityDisclaimer, generatedAt, model, isStale, busy, error, onGenerate }) {
  const { t } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const hasContent = !!keyPoints && Array.isArray(keyPoints.sections) && keyPoints.sections.length > 0;

  return (
    <div className="mb-detail-card" style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, boxShadow: elevation(t, 'sm') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : SPACE.lg, flexWrap: 'wrap' }}>
        <div
          onClick={() => hasContent && setCollapsed(c => !c)}
          style={{ fontSize: FONT.size.micro, color: t.text4, letterSpacing: .8, fontWeight: FONT.weight.semibold,
            textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 7,
            cursor: hasContent ? 'pointer' : 'default', userSelect: 'none' }}>
          <IconBrainSpark size={13} style={{ color: t.text4, flexShrink: 0 }} /> Key Points
          {hasContent && (
            <span style={{ fontSize: 11, transform: collapsed ? 'none' : 'rotate(90deg)', transition: `transform ${MOTION.fast} ${MOTION.ease}` }}>▶</span>
          )}
        </div>
        {isStale && !collapsed && (
          <span style={{ fontSize: FONT.size.micro, color: t.warn, background: t.warnBg, border: `1px solid ${t.warnBorder}`,
            borderRadius: RADIUS.sm, padding: '2px 8px', fontWeight: FONT.weight.semibold }}>
            Review changed since this was generated
          </span>
        )}
        <button className="mb-detailbtn" onClick={onGenerate} disabled={busy} style={{
          fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
          background: busy ? t.surface3 : t.navActiveBg, border: `1px solid ${busy ? t.border : t.navActiveBorder}`,
          color: busy ? t.text4 : t.navActiveText, borderRadius: RADIUS.sm - 1, padding: '5px 12px',
          cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {busy ? (
            <>
              <span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${t.border}`,
                borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
              Summarizing…
            </>
          ) : hasContent ? '↻ Regenerate' : 'Generate'}
        </button>
      </div>

      <Collapse open={!collapsed}>
        <div>
          {error && (
            <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: RADIUS.md,
              padding: '10px 14px', fontSize: 12.5, color: t.danger, marginBottom: SPACE.md }}>
              {error}
              <div style={{ marginTop: 6, fontSize: FONT.size.xs }}>Your Review and any existing Key Points are untouched. You can retry.</div>
            </div>
          )}

          {hasContent ? (
            <>
              {keyPoints.sections.map((s, i) => (
                <div key={i} style={{ marginBottom: i < keyPoints.sections.length - 1 ? 14 : 0 }}>
                  <div style={{ fontSize: 13, fontWeight: FONT.weight.bold, color: t.text, marginBottom: 6 }}>{s.heading}</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {s.bullets.map((b, j) => {
                      const style = emphasisStyle(t, b.emphasis);
                      return (
                        <li key={j} style={{ fontSize: 12.5, color: style.color, fontWeight: style.fontWeight, lineHeight: 1.65, marginBottom: 4 }}>
                          {style.icon && <span style={{ marginRight: 5 }}>{style.icon}</span>}
                          {b.text}
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
                      padding: '10px 12px', marginTop: 6, fontSize: 11.5, color: t.text2 }}>
                      <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
                        {fidelityWarnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
                      </ul>
                      <div style={{ color: t.text4, fontSize: FONT.size.micro, lineHeight: 1.5 }}>{fidelityDisclaimer}</div>
                    </div>
                  )}
                </div>
              )}

              {generatedAt && (
                <div style={{ fontSize: 10.5, color: t.text4, textAlign: 'right', marginTop: 10 }}>
                  Generated {fmtDate(generatedAt)}{model ? ` · ${model}` : ''}
                </div>
              )}
            </>
          ) : !busy && !error && (
            <div style={{ fontSize: 12.5, color: t.text4, lineHeight: 1.6 }}>
              Click <strong>Generate</strong> for a concise, exam-oriented summary of this entry — key findings, mechanisms,
              investigations, treatments, and any red flags, organized under short headings. Your Review itself is never changed.
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
