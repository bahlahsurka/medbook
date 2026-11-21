// components/visualization/VisualLearningPanel.js
//
// Phase 2's one integration point into DetailView.js — a self-contained
// "generate → cache → render" panel for the Mind Map visualization type.
// Everything React Flow-specific (MindMapRenderer.js and everything IT
// imports, including @xyflow/react itself and its stylesheet) is pulled
// in via React.lazy below, so none of it reaches the browser until a
// user actually clicks Generate — this module itself has zero @xyflow
// import, so IT stays in the main bundle (cheap: a button + some text)
// while the actual rendering engine stays out until needed.
//
// Deliberately makes NO request on mount — see the module-level comment
// on `status` below. The only two things that ever trigger a network call
// are the explicit Generate and Regenerate buttons.
import { useState, useRef, useEffect, lazy, Suspense, useCallback } from 'react';
import { useTheme, SPACE, RADIUS, FONT, elevation } from '../../lib/theme';
import { IconSparkle } from '../../lib/icons';
import VisualizationService, { VisualizationServiceError } from '../../services/visualization';

const MindMapRenderer = lazy(() => import('./MindMapRenderer'));

function RendererFallback({ t }) {
  return (
    <div style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, background: t.surface2 }}>
      <span style={{ display: 'inline-block', width: 16, height: 16, border: `2px solid ${t.border}`,
        borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
    </div>
  );
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
  // 'idle' (nothing requested yet) | 'loading' | 'error' | 'loaded'.
  // Starting at 'idle' and never transitioning out of it except via the
  // Generate/Regenerate button's own onClick is THE mechanism that
  // satisfies "do not make automatic API calls simply because an entry
  // was opened" — there is no mount effect here at all.
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null); // { cached, visualization, disclaimer, coverage, timing, usage }
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState('');
  const [showContextInput, setShowContextInput] = useState(false);
  const [extraContext, setExtraContext] = useState('');
  const [showCoverage, setShowCoverage] = useState(false);

  // Same debounce reasoning as DetailView.js's analyzeInFlight — a ref,
  // not state, so a second fast click is dropped synchronously rather
  // than racing setStatus('loading')'s own re-render.
  const requestInFlight = useRef(false);

  // "Immediate loading feedback and meaningful progress states" — a plain
  // spinner says nothing about WHY a request that can genuinely take
  // several seconds (gpt-oss's own reasoning pass, not something this
  // app controls) hasn't returned yet. Ticks while `status==='loading'`
  // only; harmless if generation finishes before the first tick.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (status !== 'loading') { setElapsedSec(0); return; }
    const id = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const run = useCallback(async (regenerate) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setStatus('loading');
    setError(''); setErrorKind('');
    try {
      const res = await VisualizationService.generateMindMap(entryId, { extraContext: extraContext.trim(), regenerate });
      setResult(res);
      setStatus('loaded');
    } catch (e) {
      const message = e instanceof VisualizationServiceError ? e.message : 'Something went wrong generating the Mind Map.';
      setError(message);
      setErrorKind(e instanceof VisualizationServiceError ? e.kind : '');
      setStatus('error');
    } finally {
      requestInFlight.current = false;
    }
  }, [entryId, extraContext, requestInFlight]);

  return (
    <div className="mb-detail-card" style={{ background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: RADIUS.lg, boxShadow: elevation(t, 'sm') }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.md, flexWrap: 'wrap' }}>
        <div style={{ fontSize: FONT.size.micro, color: t.text4, letterSpacing: .8, fontWeight: FONT.weight.semibold,
          textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconSparkle size={11} style={{ color: t.text4, flexShrink: 0 }} /> Visual Learning
        </div>
        <span style={{ fontSize: FONT.size.micro, color: t.text4, background: t.surface3, borderRadius: RADIUS.sm,
          padding: '2px 7px', fontWeight: FONT.weight.semibold }}>
          Preview
        </span>
      </div>

      {status === 'loaded' && result ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.sm, flexWrap: 'wrap' }}>
            <span style={{ fontSize: FONT.size.xs, color: t.text4 }}>
              {result.cached ? '✓ Loaded from cache (instant)' : `✓ Generated${result.timing?.totalMs ? ` in ${(result.timing.totalMs / 1000).toFixed(1)}s` : ''}`}
              {result.visualization?.aiModel ? ` · ${result.visualization.aiModel}` : ''}
            </span>
            <button onClick={() => run(true)} disabled={status === 'loading'} style={regenerateButtonStyle(t)}>
              ↻ Regenerate
            </button>
          </div>

          <Suspense fallback={<RendererFallback t={t} />}>
            <MindMapRenderer diagram={result.visualization.graphData} />
          </Suspense>

          {result.coverage?.uncoveredStatements?.length > 0 && (
            <div style={{ marginTop: SPACE.sm }}>
              <button onClick={() => setShowCoverage(s => !s)}
                style={{ background: 'none', border: 'none', color: t.warn, fontSize: FONT.size.xs,
                  cursor: 'pointer', padding: 0, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif' }}>
                ⚠ {result.coverage.uncoveredStatements.length} statement{result.coverage.uncoveredStatements.length !== 1 ? 's' : ''} from your Review may not be shown {showCoverage ? '▾' : '▸'}
              </button>
              {showCoverage && (
                <div style={{ background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: RADIUS.md,
                  padding: '10px 12px', marginTop: 6, fontSize: 11.5, color: t.text2 }}>
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
                    {result.coverage.uncoveredStatements.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                  </ul>
                  <div style={{ color: t.text4, fontSize: FONT.size.micro, lineHeight: 1.5 }}>{result.coverage.disclaimer}</div>
                </div>
              )}
            </div>
          )}

          {result.disclaimer && (
            <div style={{ fontSize: FONT.size.micro, color: t.text4, marginTop: SPACE.sm, lineHeight: 1.5 }}>
              {result.disclaimer}
            </div>
          )}
        </>
      ) : (
        <>
          {status !== 'error' && (
            <div style={{ fontSize: 12.5, color: t.text4, lineHeight: 1.6, marginBottom: SPACE.md }}>
              Turn this Review into an interactive Mind Map — the central topic, its branches, and any
              red flags or high-yield facts it supports. Your Review itself is never changed.
            </div>
          )}

          {error && (
            <div style={{
              background: errorKind === 'in_progress' ? t.navActiveBg : t.dangerBg,
              border: `1px solid ${errorKind === 'in_progress' ? t.navActiveBorder : t.dangerBorder}`,
              borderRadius: RADIUS.md, padding: '10px 14px', fontSize: 12.5,
              color: errorKind === 'in_progress' ? t.navActiveText : t.danger, marginBottom: SPACE.md,
            }}>
              {error}
            </div>
          )}

          <button onClick={() => setShowContextInput(s => !s)} disabled={status === 'loading'}
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
                disabled={status === 'loading'}
                placeholder="Optional — e.g. a related guideline or dosing detail NOT in your Review. Clearly kept separate from your own notes; the diagram marks anything built from this as supplementary, not from your Review."
                rows={3}
                style={{ width: '100%', background: t.surface2, border: `1px solid ${t.borderStrong}`,
                  borderRadius: RADIUS.sm, color: t.text, padding: '8px 10px', fontSize: 12.5,
                  lineHeight: 1.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                  fontFamily: 'Inter,sans-serif' }}
              />
            </div>
          )}

          <button onClick={() => run(false)} disabled={status === 'loading'} style={generateButtonStyle(t, status === 'loading')}>
            {status === 'loading' ? (
              <>
                <span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${t.border}`,
                  borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
                {elapsedSec < 6 ? 'Generating…' : `Still working… (${elapsedSec}s)`}
              </>
            ) : (
              <><IconSparkle size={12} /> Generate Mind Map</>
            )}
          </button>
          {status === 'loading' && elapsedSec >= 6 && (
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
