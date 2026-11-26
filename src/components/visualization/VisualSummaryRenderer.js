// components/visualization/VisualSummaryRenderer.js
//
// Visual Summary: a compact revision overview with real hierarchy (no
// React Flow). Highlights are grouped by importance — Critical as
// prominent cards, Important as regular cards, the rest as a compact
// "Also worth knowing" list — keeping the model's order within each group.
// Category drives the icon and accent (red flag / key fact / number /
// pearl); a "number" headline is set in tabular figures so values scan.
import { useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';
import DiagramDetailPanel from './DiagramDetailPanel';
import ContentDiagramFrame from './ContentDiagramFrame';

const CATEGORY_ICON = { red_flag: '🚩', key_fact: '◆', number: '#', pearl: '💡' };

function treatment(t, category) {
  switch (category) {
    case 'red_flag': return { accent: t.danger, tint: t.dangerBg, border: t.dangerBorder, headline: t.danger };
    case 'number': return { accent: t.warn, tint: t.warnBg, border: t.warnBorder, headline: t.text };
    case 'pearl': return { accent: t.ok, tint: t.okBg, border: t.okBorder, headline: t.text };
    default: return { accent: t.accent, tint: t.navActiveBg, border: t.navActiveBorder, headline: t.text };
  }
}

const over = (tint, base) => `linear-gradient(${tint}, ${tint}), ${base}`;

const GRID_CSS = `
  .mb-vs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .mb-vs-grid--critical { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .mb-vs-item { transition: box-shadow 120ms ease, background 120ms ease; }
`;

function SectionLabel({ t, children }) {
  return (
    <div style={{ fontSize: FONT.size.micro, fontWeight: FONT.weight.semibold, color: t.text4, textTransform: 'uppercase',
      letterSpacing: .7, margin: `${SPACE.md}px 0 ${SPACE.sm}px` }}>{children}</div>
  );
}

function Card({ h, t, critical, selected, onSelect }) {
  const tr = treatment(t, h.category);
  return (
    <div role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className="mb-vs-item"
      style={{
        boxSizing: 'border-box', borderRadius: RADIUS.lg, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
        padding: critical ? '14px 16px' : '11px 13px',
        background: critical ? over(tr.tint, t.surface) : t.surface,
        border: `1px solid ${critical ? tr.border : t.border}`, borderLeft: `3px solid ${tr.accent}`,
        boxShadow: selected ? `0 0 0 3px ${tr.accent}44` : 'var(--mb-viz-node-shadow)',
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span aria-hidden style={{ fontSize: critical ? FONT.size.md : FONT.size.sm, lineHeight: 1.35, flexShrink: 0, color: tr.accent, fontWeight: 700 }}>
          {CATEGORY_ICON[h.category]}
        </span>
        <span style={{ fontSize: critical ? FONT.size.md : FONT.size.base, fontWeight: FONT.weight.bold, lineHeight: 1.35,
          color: tr.headline, fontVariantNumeric: h.category === 'number' ? 'tabular-nums' : undefined }}>
          {h.headline}
        </span>
      </div>
      <div style={{ fontSize: FONT.size.xs, color: t.text2, lineHeight: 1.55,
        display: '-webkit-box', WebkitLineClamp: selected ? 'unset' : 3, WebkitBoxOrient: 'vertical', overflow: selected ? 'visible' : 'hidden' }}>
        {h.detail}
      </div>
    </div>
  );
}

function Row({ h, t, selected, onSelect, last }) {
  const tr = treatment(t, h.category);
  return (
    <div role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className="mb-vs-item"
      style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 10px', cursor: 'pointer', fontFamily: 'Inter,sans-serif',
        borderBottom: last ? 'none' : `1px solid ${t.border}`, background: selected ? t.navActiveBg : 'transparent', borderRadius: selected ? RADIUS.sm : 0 }}>
      <span aria-hidden style={{ color: tr.accent, fontSize: FONT.size.xs, fontWeight: 700, width: 14, flexShrink: 0, textAlign: 'center' }}>{CATEGORY_ICON[h.category]}</span>
      <span style={{ fontSize: FONT.size.sm, lineHeight: 1.45 }}>
        <span style={{ fontWeight: FONT.weight.semibold, color: t.text }}>{h.headline}</span>
        {h.detail && <span style={{ color: t.text3 }}> — {h.detail}</span>}
      </span>
    </div>
  );
}

/** @param {{diagram:{topic,highlights}}} props — a validated Visual Summary diagram. */
export default function VisualSummaryRenderer({ diagram }) {
  const { t } = useTheme();
  const [selectedId, setSelectedId] = useState(null);
  const highlights = diagram?.highlights || [];
  const critical = highlights.filter(h => h.importance === 'critical');
  const high = highlights.filter(h => h.importance === 'high');
  const standard = highlights.filter(h => h.importance !== 'critical' && h.importance !== 'high');
  const selected = selectedId ? highlights.find(h => h.id === selectedId) : null;
  const toggle = (id) => setSelectedId(prev => (prev === id ? null : id));

  return (
    <ContentDiagramFrame
      title={diagram?.topic || 'Visual summary'}
      overlay={<DiagramDetailPanel
        node={selected && { label: selected.headline, explanation: selected.detail, category: selected.category, sourceType: selected.sourceType, sourceRef: selected.sourceRef }}
        onClose={() => setSelectedId(null)} />}
    >
      <style>{GRID_CSS}</style>
      <div style={{ padding: `${SPACE.xs}px ${SPACE.lg}px ${SPACE.lg}px`, fontFamily: 'Inter,sans-serif' }}>
        {critical.length > 0 && (
          <>
            <SectionLabel t={t}>Critical</SectionLabel>
            <div className="mb-vs-grid mb-vs-grid--critical">
              {critical.map(h => <Card key={h.id} h={h} t={t} critical selected={selectedId === h.id} onSelect={() => toggle(h.id)} />)}
            </div>
          </>
        )}
        {high.length > 0 && (
          <>
            <SectionLabel t={t}>Important</SectionLabel>
            <div className="mb-vs-grid">
              {high.map(h => <Card key={h.id} h={h} t={t} selected={selectedId === h.id} onSelect={() => toggle(h.id)} />)}
            </div>
          </>
        )}
        {standard.length > 0 && (
          <>
            <SectionLabel t={t}>Also worth knowing</SectionLabel>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: RADIUS.md, background: t.surface }}>
              {standard.map((h, i) => <Row key={h.id} h={h} t={t} selected={selectedId === h.id} last={i === standard.length - 1} onSelect={() => toggle(h.id)} />)}
            </div>
          </>
        )}
      </div>
    </ContentDiagramFrame>
  );
}
