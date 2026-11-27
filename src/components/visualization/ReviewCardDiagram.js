// components/visualization/ReviewCardDiagram.js
//
// The entry's most recent saved diagram, shown on the review card above the
// revealed notes (Review Queue and System-wise Review). Read-only; reads the
// saved rows only for entries known (or not known not) to have a diagram,
// and re-reads when that entry's diagrams change — e.g. one just generated
// from the Visual Learning drawer. Collapsible; every card starts open.
import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';
import { IconNetwork } from '../../lib/icons';
import VisualizationService from '../../services/visualization';
import useSavedVisualizationTypes from './useSavedVisualizationTypes';
import { RENDERER_BY_TYPE, TYPE_BY_KEY } from './rendererRegistry';

/** The most recently generated/updated diagram in a saved list, or null. */
export function latestSaved(list) {
  let best = null;
  for (const v of list || []) {
    if (!RENDERER_BY_TYPE[v.vizType]) continue;
    if (!best || Date.parse(v.updatedAt || 0) > Date.parse(best.updatedAt || 0)) best = v;
  }
  return best;
}

export default function ReviewCardDiagram({ entryId }) {
  const { t } = useTheme();
  const types = useSavedVisualizationTypes(entryId);
  const revision = useSyncExternalStore(VisualizationService.subscribeSaved, () => VisualizationService.getSavedRevision(entryId));
  const [latest, setLatest] = useState(() => latestSaved(VisualizationService.peekSaved(entryId)));
  const [collapsed, setCollapsed] = useState(false);
  const knownNone = Array.isArray(types) && types.length === 0;

  useEffect(() => {
    if (knownNone) { setLatest(null); return undefined; }
    let cancelled = false;
    VisualizationService.listSaved(entryId).then(list => { if (!cancelled) setLatest(latestSaved(list)); }, () => {});
    return () => { cancelled = true; };
  }, [entryId, knownNone, revision]);

  if (!VisualizationService.isConfigured() || !latest) return null;
  const Renderer = RENDERER_BY_TYPE[latest.vizType];
  const label = TYPE_BY_KEY[latest.vizType]?.label || 'Diagram';

  return (
    <div data-testid="review-card-diagram" style={{ marginBottom: SPACE.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : SPACE.sm }}>
        <IconNetwork size={14} style={{ color: t.text3, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: FONT.size.sm, fontWeight: FONT.weight.semibold, color: t.text2 }}>{label}</span>
        <button type="button" onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}
          style={{ fontFamily: 'Inter,sans-serif', fontSize: FONT.size.sm, fontWeight: FONT.weight.semibold, color: t.text2,
            background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.md, height: 34, padding: '0 12px',
            cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {collapsed ? '▾ Expand' : '▴ Collapse'}
        </button>
      </div>
      {!collapsed && (
        <Suspense fallback={<div style={{ height: 240, borderRadius: RADIUS.lg, border: `1px solid ${t.border}`, background: t.surface2 }} />}>
          <Renderer diagram={latest.graphData} />
        </Suspense>
      )}
    </div>
  );
}
