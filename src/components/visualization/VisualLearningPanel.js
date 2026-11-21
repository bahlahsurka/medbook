// components/visualization/VisualLearningPanel.js
//
// The one integration point into DetailView.js — a self-contained
// "select type → generate → cache → render" panel covering all six Visual
// Learning types (Mind Map, Knowledge Network, Clinical Flowchart,
// Mechanism Diagram, Comparison Map, Visual Summary). Each type's own
// renderer (and everything IT imports — @xyflow/react, ELK, etc.) is
// pulled in via React.lazy below, one entry per type, so only the renderer
// for whichever type is actually being VIEWED ever reaches the browser —
// selecting a different tab or generating a different type loads its own
// chunk independently, never all six at once.
//
// Deliberately makes NO request on mount, and switching the selected type
// alone never triggers a request either — see `stateByType` below. The
// only things that ever trigger a network call are the explicit Generate/
// Regenerate buttons (per type) and the explicit Recommend button.
import { useState, useRef, useEffect, lazy, Suspense, useCallback, useMemo } from 'react';
import { useTheme, SPACE, RADIUS, FONT, elevation } from '../../lib/theme';
import { IconSparkle, IconNetwork } from '../../lib/icons';
import VisualizationService, { VisualizationServiceError } from '../../services/visualization';

// One metadata entry per supported type — the selector, the idle-state
// description, and the Generate button's label all read from this instead
// of hardcoding "Mind Map" the way this panel did before Phase 3's other
// five types existed. Keep in sync with visualizationRegistry.js's own
// SUPPORTED_VIZ_TYPES (that file is server-only, so this is a deliberate,
// small, client-side duplication of the six keys — not worth importing a
// server module into the bundle just to avoid repeating six strings).
const VISUALIZATION_TYPES = [
  { key: 'mind_map', label: 'Mind Map', description: 'A central topic with its branches, red flags, and high-yield facts.' },
  { key: 'knowledge_network', label: 'Knowledge Network', description: 'Related concepts cross-linked by multiple kinds of relationships.' },
  { key: 'clinical_flowchart', label: 'Clinical Flowchart', description: 'A step-by-step clinical decision pathway, with clear branch conditions.' },
  { key: 'mechanism_diagram', label: 'Mechanism Diagram', description: 'A cause → mechanism → consequence chain showing how it happens.' },
  { key: 'comparison_map', label: 'Comparison Map', description: 'A side-by-side grid comparing related conditions, drugs, or treatments.' },
  { key: 'visual_summary', label: 'Visual Summary', description: 'A compact, prioritized set of highlights for quick revision.' },
];
const TYPE_BY_KEY = Object.fromEntries(VISUALIZATION_TYPES.map(t => [t.key, t]));

// One lazy import per type — created once at module scope (not inside the
// component) so each is a stable component reference across re-renders.
const RENDERER_BY_TYPE = {
  mind_map: lazy(() => import('./MindMapRenderer')),
  knowledge_network: lazy(() => import('./KnowledgeNetworkRenderer')),
  clinical_flowchart: lazy(() => import('./ClinicalFlowchartRenderer')),
  mechanism_diagram: lazy(() => import('./MechanismDiagramRenderer')),
  comparison_map: lazy(() => import('./ComparisonMapRenderer')),
  visual_summary: lazy(() => import('./VisualSummaryRenderer')),
};

const EMPTY_TYPE_STATE = { status: 'idle', result: null, error: '', errorKind: '', startedAt: 0 };

function RendererFallback({ t }) {
  return (
    <div style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, background: t.surface2 }}>
      <span style={{ display: 'inline-block', width: 16, height: 16, border: `2px solid ${t.border}`,
        borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
    </div>
  );
}

function typeChipStyle(t, isSelected) {
  return {
    fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
    background: isSelected ? t.navActiveBg : t.surface2,
    border: `1px solid ${isSelected ? t.navActiveBorder : t.border}`,
    color: isSelected ? t.navActiveText : t.text3,
    borderRadius: RADIUS.pill, padding: '6px 12px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
  };
}

/**
 * @param {{entryId: string}} props — the one thing this needs from
 *   DetailView; it fetches/generates everything else itself through
 *   VisualizationService, exactly the way AISections.js's caller
 *   (DetailView's own runAnalyze) owns the AI Analysis request instead of
 *   AISections.js making it.
 */
function VisualLearningPanelContent({ entryId }) {
  const { t } = useTheme();
  const [selectedType, setSelectedType] = useState('mind_map');

  // Independent per-type state — each of the six types has its own
  // status/result/error, so switching tabs is purely a client-side view
  // change (never triggers or interrupts a request), and a result already
  // fetched this session for one type stays visible when you switch back
  // to it, with zero extra network call. Server-side caching (per
  // entry_id + viz_type row) is the other half of "independent caching
  // behavior per type" — this is the client-side half of that guarantee.
  const [stateByType, setStateByType] = useState({});
  const getTypeState = useCallback((key) => stateByType[key] || EMPTY_TYPE_STATE, [stateByType]);
  const updateTypeState = useCallback((key, patch) => {
    setStateByType(prev => ({ ...prev, [key]: { ...(prev[key] || EMPTY_TYPE_STATE), ...patch } }));
  }, []);

  const [showContextInput, setShowContextInput] = useState(false);
  const [extraContext, setExtraContext] = useState('');
  const [showCoverage, setShowCoverage] = useState(false);

  const [recommendState, setRecommendState] = useState({ status: 'idle', recommended: [], rationale: '', error: '' });
  const recommendInFlight = useRef(false);

  // Same debounce reasoning as DetailView.js's analyzeInFlight — a Set of
  // in-flight type keys (not state), so a second fast click on the SAME
  // type is dropped synchronously, while a different type can still start
  // its own independent request (both are legitimate explicit user
  // actions, and the server already dedups each on its own entry+type row).
  const requestInFlight = useRef(new Set());

  // "Immediate loading feedback and meaningful progress states" — ticks
  // once a second whenever ANY type is loading, forcing a re-render so
  // each loading button can compute its own elapsed time from its own
  // `startedAt`. Harmless if every in-flight generation finishes before
  // the first tick.
  const anyLoading = useMemo(() => Object.values(stateByType).some(s => s.status === 'loading'), [stateByType]);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!anyLoading) return;
    const id = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyLoading]);

  const run = useCallback(async (key, regenerate) => {
    if (requestInFlight.current.has(key)) return;
    requestInFlight.current.add(key);
    updateTypeState(key, { status: 'loading', error: '', errorKind: '', startedAt: Date.now() });
    try {
      const res = await VisualizationService.generate(key, entryId, { extraContext: extraContext.trim(), regenerate });
      updateTypeState(key, { status: 'loaded', result: res });
    } catch (e) {
      const message = e instanceof VisualizationServiceError ? e.message : 'Something went wrong generating this diagram.';
      updateTypeState(key, { status: 'error', error: message, errorKind: e instanceof VisualizationServiceError ? e.kind : '' });
    } finally {
      requestInFlight.current.delete(key);
    }
  }, [entryId, extraContext, updateTypeState]);

  const runRecommend = useCallback(async () => {
    if (recommendInFlight.current) return;
    recommendInFlight.current = true;
    setRecommendState({ status: 'loading', recommended: [], rationale: '', error: '' });
    try {
      const res = await VisualizationService.recommend(entryId);
      setRecommendState({ status: 'loaded', recommended: res.recommended || [], rationale: res.rationale || '', error: '' });
    } catch (e) {
      const message = e instanceof VisualizationServiceError ? e.message : 'Could not get a recommendation right now.';
      setRecommendState({ status: 'error', recommended: [], rationale: '', error: message });
    } finally {
      recommendInFlight.current = false;
    }
  }, [entryId]);

  const current = getTypeState(selectedType);
  const currentMeta = TYPE_BY_KEY[selectedType];
  const Renderer = RENDERER_BY_TYPE[selectedType];
  const elapsedSec = current.status === 'loading' ? Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)) : 0;

  return (
    <div className="mb-detail-card" style={{ background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: RADIUS.lg, boxShadow: elevation(t, 'sm') }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.md, flexWrap: 'wrap' }}>
        <div style={{ fontSize: FONT.size.micro, color: t.text4, letterSpacing: .8, fontWeight: FONT.weight.semibold,
          textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 7 }}>
          <IconNetwork size={13} style={{ color: t.text4, flexShrink: 0 }} /> Visual Learning
        </div>
        <span style={{ fontSize: FONT.size.micro, color: t.text4, background: t.surface3, borderRadius: RADIUS.sm,
          padding: '2px 7px', fontWeight: FONT.weight.semibold }}>
          Preview
        </span>
      </div>

      {/* Type selector — explicit, never auto-generates. A ✓ marks a type
          already generated this session so switching back to it is known
          to be instant. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: SPACE.sm }}>
        {VISUALIZATION_TYPES.map(({ key, label }) => {
          const typeState = getTypeState(key);
          return (
            <button key={key} onClick={() => setSelectedType(key)} style={typeChipStyle(t, key === selectedType)}>
              {typeState.status === 'loaded' && <span style={{ color: t.ok }}>✓</span>}
              {label}
            </button>
          );
        })}
      </div>

      {/* Recommend — optional, advisory, never auto-generates anything.
          Picking a recommended chip only switches the selector above;
          generating still requires the usual explicit Generate click. */}
      <div style={{ marginBottom: SPACE.md }}>
        {recommendState.status !== 'loaded' && (
          <button onClick={runRecommend} disabled={recommendState.status === 'loading'}
            style={{ background: 'none', border: 'none', color: t.text3, fontSize: FONT.size.xs,
              cursor: recommendState.status === 'loading' ? 'default' : 'pointer', padding: 0,
              textDecoration: 'underline', fontFamily: 'Inter,sans-serif', display: 'flex', alignItems: 'center', gap: 5 }}>
            <IconSparkle size={11} />
            {recommendState.status === 'loading' ? 'Thinking about the best format…' : 'Not sure which format fits? Recommend one'}
          </button>
        )}
        {recommendState.status === 'error' && (
          <div style={{ fontSize: FONT.size.micro, color: t.text4, marginTop: 4 }}>{recommendState.error}</div>
        )}
        {recommendState.status === 'loaded' && (
          <div style={{ background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.md,
            padding: '8px 10px', fontSize: FONT.size.xs, color: t.text2 }}>
            <div style={{ marginBottom: 6 }}>{recommendState.rationale}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {recommendState.recommended.map(key => (
                <button key={key} onClick={() => setSelectedType(key)} style={typeChipStyle(t, key === selectedType)}>
                  {TYPE_BY_KEY[key]?.label || key}
                </button>
              ))}
              <button onClick={() => setRecommendState({ status: 'idle', recommended: [], rationale: '', error: '' })}
                style={{ background: 'none', border: 'none', color: t.text4, fontSize: FONT.size.micro, cursor: 'pointer', padding: '6px 4px' }}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {current.status === 'loaded' && current.result ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.sm, flexWrap: 'wrap' }}>
            <span style={{ fontSize: FONT.size.xs, color: t.text4 }}>
              {current.result.cached ? '✓ Loaded from cache (instant)' : `✓ Generated${current.result.timing?.totalMs ? ` in ${(current.result.timing.totalMs / 1000).toFixed(1)}s` : ''}`}
              {current.result.visualization?.aiModel ? ` · ${current.result.visualization.aiModel}` : ''}
            </span>
            <button onClick={() => run(selectedType, true)} disabled={current.status === 'loading'} style={regenerateButtonStyle(t)}>
              ↻ Regenerate
            </button>
          </div>

          <Suspense fallback={<RendererFallback t={t} />}>
            <Renderer diagram={current.result.visualization.graphData} />
          </Suspense>

          {current.result.coverage?.uncoveredStatements?.length > 0 && (
            <div style={{ marginTop: SPACE.sm }}>
              <button onClick={() => setShowCoverage(s => !s)}
                style={{ background: 'none', border: 'none', color: t.warn, fontSize: FONT.size.xs,
                  cursor: 'pointer', padding: 0, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif' }}>
                ⚠ {current.result.coverage.uncoveredStatements.length} statement{current.result.coverage.uncoveredStatements.length !== 1 ? 's' : ''} from your Review may not be shown {showCoverage ? '▾' : '▸'}
              </button>
              {showCoverage && (
                <div style={{ background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: RADIUS.md,
                  padding: '10px 12px', marginTop: 6, fontSize: 11.5, color: t.text2 }}>
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
                    {current.result.coverage.uncoveredStatements.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                  </ul>
                  <div style={{ color: t.text4, fontSize: FONT.size.micro, lineHeight: 1.5 }}>{current.result.coverage.disclaimer}</div>
                </div>
              )}
            </div>
          )}

          {current.result.disclaimer && (
            <div style={{ fontSize: FONT.size.micro, color: t.text4, marginTop: SPACE.sm, lineHeight: 1.5 }}>
              {current.result.disclaimer}
            </div>
          )}
        </>
      ) : (
        <>
          {current.status !== 'error' && (
            <div style={{ fontSize: 12.5, color: t.text4, lineHeight: 1.6, marginBottom: SPACE.md }}>
              {currentMeta.description} Your Review itself is never changed.
            </div>
          )}

          {current.error && (
            <div style={{
              background: current.errorKind === 'in_progress' ? t.navActiveBg : t.dangerBg,
              border: `1px solid ${current.errorKind === 'in_progress' ? t.navActiveBorder : t.dangerBorder}`,
              borderRadius: RADIUS.md, padding: '10px 14px', fontSize: 12.5,
              color: current.errorKind === 'in_progress' ? t.navActiveText : t.danger, marginBottom: SPACE.md,
            }}>
              {current.error}
            </div>
          )}

          <button onClick={() => setShowContextInput(s => !s)} disabled={current.status === 'loading'}
            style={{ background: 'none', border: 'none', color: t.text3, fontSize: FONT.size.xs,
              cursor: 'pointer', padding: 0, marginBottom: SPACE.sm, textDecoration: 'underline',
              fontFamily: 'Inter,sans-serif' }}>
            {showContextInput ? 'Hide additional context' : '+ Add optional additional medical context'}
          </button>

          {showContextInput && (
            <div style={{ marginBottom: SPACE.md }}>
              <textarea
                value={extraContext}
                onChange={e => setExtraContext(e.target.value)}
                disabled={current.status === 'loading'}
                placeholder="Optional — e.g. a related guideline or dosing detail NOT in your Review. Clearly kept separate from your own notes; the diagram marks anything built from this as supplementary, not from your Review."
                rows={3}
                style={{ width: '100%', background: t.surface2, border: `1px solid ${t.borderStrong}`,
                  borderRadius: RADIUS.sm, color: t.text, padding: '8px 10px', fontSize: 12.5,
                  lineHeight: 1.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                  fontFamily: 'Inter,sans-serif' }}
              />
            </div>
          )}

          <button onClick={() => run(selectedType, false)} disabled={current.status === 'loading'} style={generateButtonStyle(t, current.status === 'loading')}>
            {current.status === 'loading' ? (
              <>
                <span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${t.border}`,
                  borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
                {elapsedSec < 6 ? 'Generating…' : `Still working… (${elapsedSec}s)`}
              </>
            ) : (
              <><IconSparkle size={12} /> Generate {currentMeta.label}</>
            )}
          </button>
          {current.status === 'loading' && elapsedSec >= 6 && (
            <div style={{ fontSize: FONT.size.micro, color: t.text4, marginTop: 6 }}>
              More complex reviews can take longer to organise into a diagram.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function generateButtonStyle(t, busy) {
  return {
    fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
    background: busy ? t.surface3 : t.navActiveBg, border: `1px solid ${busy ? t.border : t.navActiveBorder}`,
    color: busy ? t.text4 : t.navActiveText, borderRadius: RADIUS.sm - 1, padding: '7px 14px',
    cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  };
}

function regenerateButtonStyle(t) {
  return {
    fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
    background: t.surface3, border: `1px solid ${t.border}`, color: t.text3,
    borderRadius: RADIUS.sm - 1, padding: '5px 10px', cursor: 'pointer', marginLeft: 'auto',
  };
}

/**
 * The actual default export — calls NO hooks of its own, so the
 * isConfigured() early return is unconditionally safe (same reasoning
 * DetailView.js's own `AIService.isConfigured() && <AISections .../>`
 * gate relies on: the stateful component simply never mounts at all when
 * unconfigured, rather than mounting and bailing out partway through its
 * own hooks). Keeps this self-contained — DetailView.js doesn't need to
 * know this check exists at all.
 */
export default function VisualLearningPanel({ entryId }) {
  if (!VisualizationService.isConfigured()) return null;
  return <VisualLearningPanelContent entryId={entryId} />;
}
