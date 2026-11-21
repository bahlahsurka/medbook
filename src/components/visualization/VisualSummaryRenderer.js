// components/visualization/VisualSummaryRenderer.js
//
// Purpose-built React card grid for Visual Summary — no React Flow, no
// layout engine, per the brief's explicit allowance for Comparison Map/
// Visual Summary to use "purpose-built React layouts instead of graph
// rendering". Importance drives a card's visual prominence (a "critical"
// highlight spans two columns on screens wide enough to afford it, via a
// media query rather than JS measurement — simpler and never overflows a
// narrow single-column layout); category drives its icon/accent colour.
import { useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../../lib/theme';
import DiagramDetailPanel from './DiagramDetailPanel';

const CATEGORY_ICON = { red_flag: '🚩', key_fact: '●', number: '#', pearl: '💡' };

function categoryTreatment(t, category) {
  switch (category) {
    case 'red_flag': return { accent: t.danger, bg: t.dangerBg, border: t.dangerBorder };
    case 'number': return { accent: t.warn, bg: t.warnBg, border: t.warnBorder };
    case 'pearl': return { accent: t.ok, bg: t.okBg, border: t.okBorder };
    default: return { accent: t.accent, bg: t.surface2, border: t.border }; // 'key_fact'
  }
}

function fullscreenButtonStyle(t) {
  return {
    background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.sm,
    color: t.text3, fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold,
    fontFamily: 'Inter,sans-serif', padding: '8px 12px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', minHeight: 34,
  };
}

// Only "critical" cards span two columns, and only once the grid has room
// for at least two ~220px tracks — below that this rule simply never
// matches, so a narrow phone always gets a clean single column.
const RESPONSIVE_CSS = `
  @media (min-width: 560px) {
    .mb-vs-card--critical { grid-column: span 2; }
  }
`;

function SummaryCard({ h, isSelected, onClick, t }) {
  const treatment = categoryTreatment(t, h.category);
  const isCritical = h.importance === 'critical';
  const isStandard = h.importance === 'standard';
  return (
    <div
      role="button" tabIndex={0} onClick={onClick}
      className={isCritical ? 'mb-vs-card--critical' : undefined}
      style={{
        boxSizing: 'border-box', borderRadius: RADIUS.lg, cursor: 'pointer',
        padding: isCritical ? '16px 18px' : '12px 14px',
        background: isCritical ? treatment.bg : t.surface,
        border: `1px solid ${isCritical ? treatment.border : t.border}`,
        borderLeft: `3px solid ${treatment.accent}`,
        boxShadow: isSelected ? `0 0 0 3px ${treatment.accent}55` : 'none',
        opacity: isStandard ? 0.92 : 1,
        transition: 'box-shadow 120ms ease',
        fontFamily: 'Inter,sans-serif', display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: isCritical ? FONT.size.md : FONT.size.sm, flexShrink: 0, lineHeight: 1.3 }}>{CATEGORY_ICON[h.category]}</span>
        <span style={{
          fontSize: isCritical ? FONT.size.md : FONT.size.sm, fontWeight: FONT.weight.bold,
          color: isCritical ? treatment.accent : t.text, lineHeight: 1.35,
        }}>
          {h.headline}
        </span>
      </div>
      <div style={{
        fontSize: FONT.size.xs, color: t.text2, lineHeight: 1.55,
        display: '-webkit-box', WebkitLineClamp: isSelected ? 'unset' : 3, WebkitBoxOrient: 'vertical', overflow: isSelected ? 'visible' : 'hidden',
      }}>
        {h.detail}
      </div>
      {h.sourceType === 'ai_context' && (
        <span style={{ fontSize: FONT.size.micro, color: t.text4, alignSelf: 'flex-start' }}>From supplementary context</span>
      )}
    </div>
  );
}

function VisualSummaryGrid({ diagram, isFullscreen, onToggleFullscreen }) {
  const { t } = useTheme();
  const [selectedId, setSelectedId] = useState(null);
  const highlights = diagram?.highlights || [];
  const selected = selectedId ? highlights.find(h => h.id === selectedId) : null;
  const selectedNode = selected ? {
    label: selected.headline, explanation: selected.detail,
    sourceType: selected.sourceType, sourceRef: selected.sourceRef,
  } : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <style>{RESPONSIVE_CSS}</style>
      <div style={{ position: 'absolute', top: SPACE.sm, right: SPACE.sm, zIndex: 5 }}>
        <button style={fullscreenButtonStyle(t)} onClick={onToggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {isFullscreen ? '⤡ Exit' : '⤢ Fullscreen'}
        </button>
      </div>
      <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: SPACE.lg, boxSizing: 'border-box' }}>
        {diagram?.topic && (
          <div style={{ fontSize: FONT.size.sm, fontWeight: FONT.weight.bold, color: t.text, marginBottom: SPACE.md, paddingRight: 96 }}>
            {diagram.topic}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {highlights.map(h => (
            <SummaryCard
              key={h.id} h={h} t={t} isSelected={selectedId === h.id}
              onClick={() => setSelectedId(prev => (prev === h.id ? null : h.id))}
            />
          ))}
        </div>
      </div>
      <DiagramDetailPanel node={selectedNode} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/** @param {{diagram:{topic,highlights}}} props — a validated Visual Summary diagram. */
export default function VisualSummaryRenderer({ diagram }) {
  const { t } = useTheme();
  const [isFullscreen, setFullscreen] = useState(false);
  const grid = <VisualSummaryGrid diagram={diagram} isFullscreen={isFullscreen} onToggleFullscreen={() => setFullscreen(f => !f)} />;

  if (!isFullscreen) {
    return (
      <div style={{ width: '100%', height: 'clamp(320px, 65vh, 480px)', borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.border}` }}>
        {grid}
      </div>
    );
  }
  return <div style={{ position: 'fixed', inset: 0, zIndex: Z.lightbox, background: t.appBg }}>{grid}</div>;
}
