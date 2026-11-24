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
import { useTheme, SPACE, RADIUS, FONT, elevation, MOTION, fs } from '../lib/theme';
import { IconBrainSpark } from '../lib/icons';
import KeyPointsContent from './KeyPointsContent';

function Collapse({ open, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr',
      transition: `grid-template-rows ${MOTION.normal} ${MOTION.ease}` }}>
      <div aria-hidden={!open} style={{ overflow: 'hidden', minHeight: 0, visibility: open ? 'visible' : 'hidden',
        transition: `visibility 0s linear ${open ? '0s' : MOTION.normal}` }}>{children}</div>
    </div>
  );
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
  const hasContent = !!keyPoints && Array.isArray(keyPoints.sections) && keyPoints.sections.length > 0;
  const bullets = hasContent ? keyPoints.sections.flatMap(s => s.bullets || []) : [];
  const redFlags = bullets.filter(b => b.emphasis === 'red_flag').length;

  return (
    <div className="mb-detail-card" style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, boxShadow: elevation(t, 'sm') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : SPACE.lg, flexWrap: 'wrap',
        transition: `margin-bottom ${MOTION.normal} ${MOTION.ease}` }}>
        <button type="button"
          onClick={() => hasContent && setCollapsed(c => !c)}
          aria-expanded={hasContent ? !collapsed : undefined}
          disabled={!hasContent}
          style={{ fontSize: FONT.size.micro, color: t.text4, letterSpacing: .8, fontWeight: FONT.weight.semibold,
            textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 7, minHeight: 32,
            background: 'none', border: 'none', padding: 0, fontFamily: 'Inter,sans-serif', textAlign: 'left',
            cursor: hasContent ? 'pointer' : 'default', userSelect: 'none' }}>
          <IconBrainSpark size={13} style={{ color: t.text4, flexShrink: 0 }} /> Key Points
          {hasContent && collapsed && (
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: FONT.weight.medium }}>· {bullets.length}</span>
          )}
          {hasContent && collapsed && redFlags > 0 && (
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: FONT.weight.bold, color: t.danger, background: t.dangerBg,
              border: `1px solid ${t.dangerBorder}`, borderRadius: RADIUS.pill, padding: '1px 7px' }}>
              🚩 {redFlags}
            </span>
          )}
          {hasContent && (
            <span aria-hidden style={{ fontSize: fs(11), transform: collapsed ? 'none' : 'rotate(90deg)', transition: `transform ${MOTION.fast} ${MOTION.ease}` }}>▶</span>
          )}
        </button>
        {isStale && !collapsed && (
          <span style={{ fontSize: FONT.size.micro, color: t.warn, background: t.warnBg, border: `1px solid ${t.warnBorder}`,
            borderRadius: RADIUS.sm, padding: '2px 8px', fontWeight: FONT.weight.semibold }}>
            Review changed since this was generated
          </span>
        )}
        <button className="mb-detailbtn" onClick={onGenerate} disabled={busy} style={{
          fontSize: FONT.size.base, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
          background: busy ? t.surface3 : t.navActiveBg, border: `1px solid ${busy ? t.border : t.navActiveBorder}`,
          color: busy ? t.text4 : t.navActiveText, borderRadius: RADIUS.md, padding: '0 16px', height: 38, boxSizing: 'border-box',
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
              padding: '10px 14px', fontSize: fs(12.5), color: t.danger, marginBottom: SPACE.md }}>
              {error}
              <div style={{ marginTop: 6, fontSize: FONT.size.xs }}>Your Review and any existing Key Points are untouched. You can retry.</div>
            </div>
          )}

          {hasContent ? (
            <>
              <KeyPointsContent sections={keyPoints.sections} fidelityWarnings={fidelityWarnings} fidelityDisclaimer={fidelityDisclaimer} />

              {generatedAt && (
                <div style={{ fontSize: fs(10.5), color: t.text4, textAlign: 'right', marginTop: 10 }}>
                  Generated {fmtDate(generatedAt)}{model ? ` · ${model}` : ''}
                </div>
              )}
            </>
          ) : !busy && !error && (
            <div style={{ fontSize: fs(12.5), color: t.text4, lineHeight: 1.6 }}>
              Click <strong>Generate</strong> for a concise, exam-oriented summary of this entry — key findings, mechanisms,
              investigations, treatments, and any red flags, organized under short headings.
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
