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
// Exceptions (table reads only, never a generation): mode="saved" (review
// screens) reads the already-saved rows on mount, and full mode does one
// tiny read of WHICH types are saved, to mark them on the type chips.
import { useState, useRef, useEffect, lazy, Suspense, useCallback, useMemo } from 'react';
import { useTheme, SPACE, RADIUS, FONT, elevation } from '../../lib/theme';
import { IconSparkle, IconNetwork } from '../../lib/icons';
import VisualizationService, { VisualizationServiceError } from '../../services/visualization';
import { cloneDiagram } from './graphDiagramEdits';
import useSavedVisualizationTypes from './useSavedVisualizationTypes';
import { contentHashHex } from '../../lib/contentHash';

// One metadata entry per supported type — the format dropdown and the
// Generate button's label all read from this instead
// of hardcoding "Mind Map" the way this panel did before Phase 3's other
// five types existed. Keep in sync with visualizationRegistry.js's own
// SUPPORTED_VIZ_TYPES (that file is server-only, so this is a deliberate,
// small, client-side duplication of the six keys — not worth importing a
// server module into the bundle just to avoid repeating six strings).
// `family` picks which Phase 4 editing UI a type gets: the four graph-
// shaped types edit in place inside their own existing Renderer (passed
// `editable`+`onDraftChange`); the other two swap in a dedicated
// purpose-built editor component instead of a graph editor.
const VISUALIZATION_TYPES = [
  { key: 'mind_map', label: 'Mind Map', family: 'graph' },
  { key: 'knowledge_network', label: 'Knowledge Network', family: 'graph' },
  { key: 'clinical_flowchart', label: 'Clinical Flowchart', family: 'graph' },
  { key: 'mechanism_diagram', label: 'Mechanism Diagram', family: 'graph' },
  { key: 'comparison_map', label: 'Comparison Map', family: 'comparison' },
  { key: 'visual_summary', label: 'Visual Summary', family: 'summary' },
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

// Phase 4: the two non-graph types get their own dedicated editor
// component instead of reusing their Renderer with an `editable` prop —
// see ComparisonMapEditor.js/VisualSummaryEditor.js's own headers for why
// (a grid/card-list editor is a genuinely different UI, not a graph
// canvas in disguise). The four graph types don't appear here at all —
// their existing Renderer handles both modes itself.
const EDITOR_BY_TYPE = {
  comparison_map: lazy(() => import('./ComparisonMapEditor')),
  visual_summary: lazy(() => import('./VisualSummaryEditor')),
};

// `editMode`/`draft`/`isDirty`/`saveStatus`/`saveError`/`confirmAction`
// are the Phase 4 additions — everything else is unchanged from Phase 3.
// `draft` lives ONLY in this component's React state until an explicit
// Save Changes click; nothing here ever persists a drag, a keystroke, or
// any other intermediate edit on its own.
const EMPTY_TYPE_STATE = {
  status: 'idle', result: null, error: '', errorKind: '', startedAt: 0,
  editMode: false, draft: null, isDirty: false,
  saveStatus: 'idle', saveError: '', confirmAction: null,
};

// mode="saved": seeds per-type state from already-saved rows so the normal
// loaded-diagram rendering path is reused unchanged.
function stateFromSaved(list) {
  const out = {};
  for (const v of list || []) {
    if (TYPE_BY_KEY[v.vizType]) out[v.vizType] = { ...EMPTY_TYPE_STATE, status: 'loaded', result: { cached: true, visualization: v } };
  }
  return out;
}
function firstSavedType(list) {
  return VISUALIZATION_TYPES.find(({ key }) => (list || []).some(v => v.vizType === key))?.key || 'mind_map';
}

function fmtSavedDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; }
}

function RendererFallback({ t }) {
  return (
    <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, background: t.surface2,
      color: t.text4, fontSize: FONT.size.xs, fontFamily: 'Inter,sans-serif', animation: 'medbook-scrim-in 200ms ease' }}>
      <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${t.border}`,
        borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
      Loading diagram…
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
function VisualLearningPanelContent({ entryId, mode = 'full', notes, collapsible = false, onHasDiagramChange }) {
  const { t, isDark } = useTheme();
  // mode="saved" (review screens): read-only view of already-saved diagrams.
  // Loads them once via VisualizationService.listSaved (a plain RLS-scoped
  // table read, never /api/visualize, so never Groq) and hides every
  // generate/regenerate/recommend/edit control.
  const savedOnly = mode === 'saved';
  // Both modes show the entry's saved diagrams straight away (a read-only
  // table read — never Groq): saved diagrams belong to the entry and stay
  // until the user deletes them.
  const [initialSaved] = useState(() => VisualizationService.peekSaved(entryId));
  const [savedStatus, setSavedStatus] = useState(() => (initialSaved ? 'loaded' : 'loading'));
  const [savedError, setSavedError] = useState('');
  const [staleByType, setStaleByType] = useState({});
  const [selectedType, setSelectedType] = useState(() => (initialSaved ? firstSavedType(initialSaved) : 'mind_map'));

  // Independent per-type state — each of the six types has its own
  // status/result/error, so switching tabs is purely a client-side view
  // change (never triggers or interrupts a request), and a result already
  // fetched this session for one type stays visible when you switch back
  // to it, with zero extra network call. Server-side caching (per
  // entry_id + viz_type row) is the other half of "independent caching
  // behavior per type" — this is the client-side half of that guarantee.
  const [stateByType, setStateByType] = useState(() => (initialSaved ? stateFromSaved(initialSaved) : {}));
  const savedTypes = useSavedVisualizationTypes(entryId);

  useEffect(() => {
    if (savedStatus !== 'loading') return undefined;
    let cancelled = false;
    VisualizationService.listSaved(entryId).then(list => {
      if (cancelled) return;
      if (savedOnly) {
        setStateByType(stateFromSaved(list));
        setSelectedType(firstSavedType(list));
      } else {
        // Never clobber a type the user already started generating/loading.
        setStateByType(prev => {
          const next = { ...stateFromSaved(list) };
          for (const [k, st] of Object.entries(prev)) if (st.status !== 'idle') next[k] = st;
          return next;
        });
        if (list.length) setSelectedType(prev => (list.some(v => v.vizType === prev) ? prev : firstSavedType(list)));
      }
      setSavedStatus('loaded');
    }, e => {
      if (cancelled) return;
      setSavedError(e instanceof VisualizationServiceError ? e.message : 'Could not load saved visualizations.');
      setSavedStatus('error');
    });
    return () => { cancelled = true; };
  }, [savedOnly, savedStatus, entryId]);
  const getTypeState = useCallback((key) => stateByType[key] || EMPTY_TYPE_STATE, [stateByType]);
  const updateTypeState = useCallback((key, patch) => {
    setStateByType(prev => ({ ...prev, [key]: { ...(prev[key] || EMPTY_TYPE_STATE), ...patch } }));
  }, []);

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
      const res = await VisualizationService.generate(key, entryId, { regenerate });
      updateTypeState(key, { status: 'loaded', result: res });
    } catch (e) {
      const message = e instanceof VisualizationServiceError ? e.message : 'Something went wrong generating this diagram.';
      updateTypeState(key, { status: 'error', error: message, errorKind: e instanceof VisualizationServiceError ? e.kind : '' });
    } finally {
      requestInFlight.current.delete(key);
    }
  }, [entryId, updateTypeState]);

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

  // ---- Phase 4: editing. `draft` is a deep clone of whatever's currently
  // displayed — mutated locally by the renderer/editor's own onDraftChange
  // calls, never touching `result` (and therefore the server) until Save
  // Changes succeeds. ----
  const startEdit = useCallback((key) => {
    const typeState = getTypeState(key);
    const sourceDiagram = typeState.result?.visualization?.graphData;
    updateTypeState(key, { editMode: true, draft: cloneDiagram(sourceDiagram), isDirty: false, saveStatus: 'idle', saveError: '', confirmAction: null });
  }, [getTypeState, updateTypeState]);

  const changeDraft = useCallback((key, nextDraft) => {
    updateTypeState(key, { draft: nextDraft, isDirty: true });
  }, [updateTypeState]);

  const performDiscard = useCallback((key) => {
    updateTypeState(key, { editMode: false, draft: null, isDirty: false, saveStatus: 'idle', saveError: '', confirmAction: null });
  }, [updateTypeState]);

  const requestDiscard = useCallback((key) => {
    const typeState = getTypeState(key);
    if (!typeState.isDirty) { performDiscard(key); return; } // nothing to lose — no confirmation needed
    updateTypeState(key, { confirmAction: 'discard' });
  }, [getTypeState, performDiscard, updateTypeState]);

  const saveInFlight = useRef(new Set());
  const performSave = useCallback(async (key) => {
    if (saveInFlight.current.has(key)) return;
    const typeState = getTypeState(key);
    saveInFlight.current.add(key);
    updateTypeState(key, { saveStatus: 'saving', saveError: '' });
    try {
      const res = await VisualizationService.saveEdit(key, entryId, typeState.draft, { baseUpdatedAt: typeState.result?.visualization?.updatedAt });
      updateTypeState(key, {
        result: { ...typeState.result, visualization: res.visualization },
        editMode: false, draft: null, isDirty: false, saveStatus: 'saved', saveError: '', confirmAction: null,
      });
    } catch (e) {
      // The draft is left exactly as it was — a failed save must never
      // lose the user's in-memory edits.
      const message = e instanceof VisualizationServiceError ? e.message : 'Something went wrong saving your changes.';
      updateTypeState(key, { saveStatus: 'error', saveError: message });
    } finally {
      saveInFlight.current.delete(key);
    }
  }, [entryId, getTypeState, updateTypeState]);

  const restoreInFlight = useRef(new Set());
  const performRestore = useCallback(async (key) => {
    if (restoreInFlight.current.has(key)) return;
    const typeState = getTypeState(key);
    restoreInFlight.current.add(key);
    updateTypeState(key, { saveStatus: 'saving', saveError: '' });
    try {
      // Never calls Groq — see api/visualize-edit.mjs's own header.
      const res = await VisualizationService.restoreOriginal(key, entryId, { baseUpdatedAt: typeState.result?.visualization?.updatedAt });
      updateTypeState(key, {
        result: { ...typeState.result, visualization: res.visualization },
        editMode: false, draft: null, isDirty: false, saveStatus: 'saved', saveError: '', confirmAction: null,
      });
    } catch (e) {
      const message = e instanceof VisualizationServiceError ? e.message : 'Something went wrong restoring the original.';
      updateTypeState(key, { saveStatus: 'error', saveError: message });
    } finally {
      restoreInFlight.current.delete(key);
    }
  }, [entryId, getTypeState, updateTypeState]);

  const requestRestore = useCallback((key) => {
    updateTypeState(key, { confirmAction: 'restore' }); // always confirm — restoring discards the saved edited version outright
  }, [updateTypeState]);

  const cancelConfirm = useCallback((key) => updateTypeState(key, { confirmAction: null }), [updateTypeState]);

  // Delete — permanently removes this saved diagram from the entry (the
  // only way a saved diagram goes away). Always confirmed first.
  const deleteInFlight = useRef(new Set());
  const performDelete = useCallback(async (key) => {
    if (deleteInFlight.current.has(key)) return;
    deleteInFlight.current.add(key);
    updateTypeState(key, { saveStatus: 'saving', saveError: '' });
    try {
      await VisualizationService.deleteSaved(key, entryId);
      setStateByType(prev => ({ ...prev, [key]: EMPTY_TYPE_STATE }));
      setStaleByType(prev => ({ ...prev, [key]: false }));
    } catch (e) {
      const message = e instanceof VisualizationServiceError ? e.message : 'Something went wrong deleting this diagram.';
      updateTypeState(key, { saveStatus: 'error', saveError: message, confirmAction: null });
    } finally {
      deleteInFlight.current.delete(key);
    }
  }, [entryId, updateTypeState]);
  const requestDelete = useCallback((key) => updateTypeState(key, { confirmAction: 'delete' }), [updateTypeState]);

  // Regenerating replaces the saved diagram — confirm first if the user edited it.
  const requestRegenerate = useCallback((key) => {
    if (getTypeState(key).result?.visualization?.isEdited) updateTypeState(key, { confirmAction: 'regenerate' });
    else run(key, true);
  }, [getTypeState, updateTypeState, run]);

  // Diagrams read from the table (both modes) carry no server `stale` flag:
  // compare each one's source hash with the current Review (client-side
  // sha256, no request) to flag possibly outdated ones.
  useEffect(() => {
    if (notes == null || savedStatus !== 'loaded') return undefined;
    let cancelled = false;
    const loaded = Object.entries(stateByType).filter(([, st]) => st.result?.visualization?.sourceContentHash);
    Promise.all(loaded.map(async ([key, st]) => {
      const v = st.result.visualization;
      const hash = await contentHashHex(notes, v.extraContext);
      return [key, !!hash && hash !== v.sourceContentHash];
    })).then(pairs => { if (!cancelled) setStaleByType(Object.fromEntries(pairs)); }, () => {});
    return () => { cancelled = true; };
    // stateByType is only populated once, when the saved rows load.
  }, [notes, savedStatus]);

  const current = getTypeState(selectedType);
  const currentMeta = TYPE_BY_KEY[selectedType];
  const Renderer = RENDERER_BY_TYPE[selectedType];
  const Editor = EDITOR_BY_TYPE[selectedType];
  const elapsedSec = current.status === 'loading' ? Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)) : 0;
  const isBusy = current.saveStatus === 'saving';
  // A fresh /api/visualize response says itself whether it is stale; a row
  // read straight from the table falls back to the client-side hash check.
  const isStale = typeof current.result?.stale === 'boolean' ? current.result.stale : !!staleByType[selectedType];
  const visibleTypes = savedOnly ? VISUALIZATION_TYPES.filter(({ key }) => stateByType[key]?.status === 'loaded') : VISUALIZATION_TYPES;
  const isSavedType = (key) => !!stateByType[key]?.result?.visualization || !!savedTypes?.includes(key);

  // Tells the entry page whether this entry has any diagram, so on wide
  // screens it can move this panel to the full-width slot above the notes.
  // Counts a diagram that is being regenerated too, so it doesn't jump.
  const hasDiagram = useMemo(() => Object.values(stateByType).some(st => !!st.result?.visualization), [stateByType]);
  useEffect(() => { if (!savedOnly) onHasDiagramChange?.(hasDiagram); }, [savedOnly, hasDiagram, onHasDiagramChange]);

  // Collapse is per visit only: every time the entry opens it starts expanded.
  const [collapsed, setCollapsed] = useState(false);
  const canCollapse = collapsible && hasDiagram;

  if (savedOnly && (savedStatus !== 'loaded' || visibleTypes.length === 0)) {
    return <SavedModeState t={t} status={savedStatus} error={savedError}
      onRetry={() => { setSavedError(''); setSavedStatus('loading'); }} />;
  }

  const loaded = current.status === 'loaded' && current.result;
  const savedAt = fmtSavedDate(current.result?.visualization?.updatedAt);
  const typeSelect = (
    <TypeSelect t={t} isDark={isDark} value={selectedType} onChange={setSelectedType}
      options={visibleTypes} isSaved={savedOnly ? null : isSavedType} />
  );

  const moreItems = [];
  if (loaded && !savedOnly && !current.editMode && current.result.visualization?.isEdited) {
    moreItems.push({ label: '⟲ Restore original AI version', onClick: () => requestRestore(selectedType) });
  }
  if (loaded && !savedOnly && !current.editMode) {
    moreItems.push({ label: `🗑 Delete ${currentMeta.label}`, danger: true, onClick: () => requestDelete(selectedType) });
  }

  return (
    <div className={savedOnly ? undefined : 'mb-detail-card'} data-testid={savedOnly ? undefined : 'visual-learning-panel'}
      style={savedOnly ? undefined : { background: t.surface, border: `1px solid ${t.border}`,
        borderRadius: RADIUS.lg, boxShadow: elevation(t, 'sm') }}>

      {!savedOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: collapsed && canCollapse ? 0 : SPACE.lg }}>
          <div style={{ fontSize: FONT.size.xs, color: t.text3, letterSpacing: .8, fontWeight: FONT.weight.bold,
            textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconNetwork size={15} style={{ color: t.text3, flexShrink: 0 }} /> Visual Learning
            {collapsed && canCollapse && loaded && (
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: FONT.weight.semibold, color: t.text2, fontSize: FONT.size.base }}>
                · {currentMeta.label}
              </span>
            )}
          </div>
          {canCollapse && (
            <button onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed} style={secondaryButtonStyle(t)}>
              {collapsed ? '▾ Expand' : '▴ Collapse'}
            </button>
          )}
        </div>
      )}

      {!(collapsed && canCollapse) && (loaded ? (
        <>
          {/* One header bar: format · saved date · actions. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: SPACE.md, flexWrap: 'wrap' }}>
            {typeSelect}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: FONT.size.sm, color: t.text3, flexWrap: 'wrap' }}>
              <span>{current.result.cached || savedOnly ? `Saved${savedAt ? ` · ${savedAt}` : ''}` : 'Generated and saved'}</span>
              {current.result.visualization?.isEdited && !current.editMode && (
                <span style={{ color: t.navActiveText, background: t.navActiveBg, border: `1px solid ${t.navActiveBorder}`,
                  borderRadius: RADIUS.pill, padding: '2px 9px', fontWeight: FONT.weight.semibold, fontSize: FONT.size.xs }}>Edited by you</span>
              )}
              <InfoTip t={t} text="AI-generated from your notes. It has not been checked for medical accuracy, so verify it before relying on it." />
            </span>
            {!savedOnly && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto', alignItems: 'center' }}>
                {current.editMode ? (
                  <>
                    {current.isDirty && <span style={{ fontSize: FONT.size.sm, color: t.warn, fontWeight: FONT.weight.semibold }}>● Unsaved changes</span>}
                    <button onClick={() => performSave(selectedType)} disabled={isBusy} style={saveButtonStyle(t, isBusy)}>
                      {isBusy ? 'Saving…' : '✓ Save changes'}
                    </button>
                    <button onClick={() => requestDiscard(selectedType)} disabled={isBusy} style={secondaryButtonStyle(t)}>Discard</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(selectedType)} style={secondaryButtonStyle(t)}>✎ Edit</button>
                    <button onClick={() => requestRegenerate(selectedType)} disabled={current.status === 'loading'} style={secondaryButtonStyle(t)}>↻ Regenerate</button>
                    {moreItems.length > 0 && <MoreMenu t={t} items={moreItems} />}
                  </>
                )}
              </div>
            )}
          </div>

          {isStale && !current.editMode && (
            <div role="status" style={noticeStyle(t, 'warn')}>
              <strong style={{ color: t.warn }}>May be out of date</strong> — your Review changed after this diagram was made.
              {savedOnly ? '' : ' Regenerate to update it.'}
            </div>
          )}

          {current.confirmAction && (
            <div style={{ ...noticeStyle(t, 'danger'), display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: t.danger, flex: 1, minWidth: 200 }}>
                {current.confirmAction === 'discard'
                  ? 'Discard your unsaved changes? This can\'t be undone.'
                  : current.confirmAction === 'regenerate'
                    ? 'Regenerate this diagram? Your edited version will be replaced by a new one.'
                    : current.confirmAction === 'delete'
                      ? `Delete this ${currentMeta?.label || 'diagram'}? It will be removed from this entry and from review. This can't be undone.`
                      : 'Restore the original AI version? Your saved edits will be replaced and can\'t be recovered.'}
              </span>
              <button
                onClick={() => (current.confirmAction === 'discard' ? performDiscard(selectedType)
                  : current.confirmAction === 'regenerate' ? (cancelConfirm(selectedType), run(selectedType, true))
                  : current.confirmAction === 'delete' ? performDelete(selectedType)
                  : performRestore(selectedType))}
                style={{ ...secondaryButtonStyle(t), background: t.danger, border: `1px solid ${t.danger}`, color: '#fff' }}>
                Yes, {current.confirmAction}
              </button>
              <button onClick={() => cancelConfirm(selectedType)} style={secondaryButtonStyle(t)}>Cancel</button>
            </div>
          )}

          {current.saveStatus === 'error' && (
            <div style={noticeStyle(t, 'danger')}>
              <span style={{ color: t.danger }}>{current.saveError}{current.editMode ? ' Your edits are still here — try saving again.' : ''}</span>
            </div>
          )}
          {current.saveStatus === 'saved' && !current.editMode && (
            <div style={{ fontSize: FONT.size.sm, color: t.ok, marginBottom: SPACE.sm, animation: 'medbook-scrim-in 220ms ease' }}>✓ Saved</div>
          )}

          {current.editMode ? (
            currentMeta.family === 'graph' ? (
              <Suspense fallback={<RendererFallback t={t} />}>
                <Renderer diagram={current.draft} editable onDraftChange={next => changeDraft(selectedType, next)} />
              </Suspense>
            ) : (
              <div style={{ width: '100%', height: 'clamp(320px, 65vh, 520px)', borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.accent}55` }}>
                <Suspense fallback={<RendererFallback t={t} />}>
                  <Editor diagram={current.draft} onDraftChange={next => changeDraft(selectedType, next)} />
                </Suspense>
              </div>
            )
          ) : (
            <Suspense fallback={<RendererFallback t={t} />}>
              <Renderer diagram={current.result.visualization.graphData} />
            </Suspense>
          )}

          {current.result.coverage?.uncoveredStatements?.length > 0 && (
            <div style={{ marginTop: SPACE.sm }}>
              <button onClick={() => setShowCoverage(v => !v)}
                style={{ background: 'none', border: 'none', color: t.warn, fontSize: FONT.size.sm,
                  cursor: 'pointer', padding: '4px 0', fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif' }}>
                ⚠ {current.result.coverage.uncoveredStatements.length} statement{current.result.coverage.uncoveredStatements.length !== 1 ? 's' : ''} from your Review may not be shown {showCoverage ? '▾' : '▸'}
              </button>
              {showCoverage && (
                <ul style={{ ...noticeStyle(t, 'warn'), margin: '6px 0 0', paddingLeft: 30 }}>
                  {current.result.coverage.uncoveredStatements.map((line, i) => <li key={i} style={{ marginBottom: 4 }}>{line}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {current.error && (
            <div style={noticeStyle(t, current.errorKind === 'in_progress' ? 'info' : 'danger')}>
              <span style={{ color: current.errorKind === 'in_progress' ? t.navActiveText : t.danger }}>{current.error}</span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {typeSelect}
            <button onClick={() => run(selectedType, false)} disabled={current.status === 'loading'} style={primaryButtonStyle(t, current.status === 'loading')}>
              {current.status === 'loading' ? (
                <>
                  <span style={{ display: 'inline-block', width: 12, height: 12, border: `2px solid ${t.border}`,
                    borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
                  {elapsedSec < 6 ? 'Generating…' : `Still working… ${elapsedSec}s`}
                </>
              ) : (
                <><IconSparkle size={14} /> Generate {currentMeta.label}</>
              )}
            </button>
          </div>

          {/* Suggest a format — optional and secondary; it only switches the
              dropdown, never generates on its own. */}
          {!savedOnly && recommendState.status !== 'loaded' && (
            <button onClick={runRecommend} disabled={recommendState.status === 'loading' || current.status === 'loading'}
              style={{ ...secondaryButtonStyle(t), marginTop: SPACE.md, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <IconSparkle size={13} />
              {recommendState.status === 'loading' ? 'Finding the best format…' : 'Suggest the best format'}
            </button>
          )}
          {!savedOnly && recommendState.status === 'error' && (
            <div style={{ fontSize: FONT.size.sm, color: t.text3, marginTop: 8 }}>{recommendState.error}</div>
          )}
          {!savedOnly && recommendState.status === 'loaded' && (
            <div style={{ ...noticeStyle(t, 'info'), marginTop: SPACE.md, marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: FONT.weight.semibold, color: t.text2 }}>
                <IconSparkle size={13} /> Suggested format
              </div>
              {recommendState.rationale && <div style={{ color: t.text2, marginBottom: 10 }}>{recommendState.rationale}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {recommendState.recommended.map(key => (
                  <button key={key} onClick={() => setSelectedType(key)} style={key === selectedType ? selectedChipStyle(t) : secondaryButtonStyle(t)}>
                    {TYPE_BY_KEY[key]?.label || key}
                  </button>
                ))}
                <button onClick={() => setRecommendState({ status: 'idle', recommended: [], rationale: '', error: '' })}
                  style={{ ...secondaryButtonStyle(t), background: 'none', border: '1px solid transparent', color: t.text3 }}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </>
      ))}
    </div>
  );
}

// Native <select> (keyboard/screen-reader friendly), styled to match the app.
function TypeSelect({ t, isDark, value, onChange, options, isSaved }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
      <select aria-label="Diagram format" value={value} onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', colorScheme: isDark ? 'dark' : 'light',
          background: t.surface2, border: `1px solid ${t.borderStrong}`, borderRadius: RADIUS.md, color: t.text,
          fontSize: FONT.size.md, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
          padding: '0 38px 0 14px', height: 40, cursor: 'pointer', maxWidth: '100%',
        }}>
        {options.map(({ key, label }) => (
          <option key={key} value={key}>{label}{isSaved && isSaved(key) ? '  ✓' : ''}</option>
        ))}
      </select>
      <span aria-hidden style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)',
        pointerEvents: 'none', color: t.text3, fontSize: FONT.size.sm }}>▼</span>
    </span>
  );
}

// ⓘ — the AI caveat, shown on hover/focus/tap instead of a paragraph.
function InfoTip({ t, text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="About this diagram" title={text} onClick={() => setOpen(o => !o)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        style={{ width: 22, height: 22, borderRadius: RADIUS.circle, border: `1px solid ${t.borderStrong}`, background: t.surface2,
          color: t.text3, fontSize: FONT.size.xs, fontWeight: FONT.weight.bold, cursor: 'help', padding: 0, lineHeight: 1,
          fontFamily: 'Georgia,serif', fontStyle: 'italic' }}>i</button>
      {open && (
        <span role="tooltip" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: -8, zIndex: 30, width: 260,
          background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.md, boxShadow: elevation(t, 'lg'),
          padding: '10px 12px', fontSize: FONT.size.sm, color: t.text2, lineHeight: 1.5, fontWeight: FONT.weight.regular }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ⋯ — less frequent / destructive actions (Delete, Restore original).
function MoreMenu({ t, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ ...secondaryButtonStyle(t), width: 40, padding: 0, fontSize: FONT.size.lg, letterSpacing: 1 }}>⋯</button>
      {open && (
        <span role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, minWidth: 230,
          background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.md, boxShadow: elevation(t, 'lg'),
          padding: 6, display: 'flex', flexDirection: 'column' }}>
          {items.map(item => (
            <button key={item.label} role="menuitem" onClick={() => { setOpen(false); item.onClick(); }}
              style={{ textAlign: 'left', background: 'none', border: 'none', borderRadius: RADIUS.sm, padding: '10px 12px',
                color: item.danger ? t.danger : t.text2, fontSize: FONT.size.base, fontWeight: FONT.weight.semibold,
                fontFamily: 'Inter,sans-serif', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function SavedModeState({ t, status, error, onRetry }) {
  const box = { border: `1px dashed ${t.border}`, borderRadius: RADIUS.lg, padding: '20px 18px',
    fontSize: FONT.size.base, color: t.text3, lineHeight: 1.6, textAlign: 'center' };
  if (status === 'loading') {
    return (
      <div style={{ ...box, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, border: `2px solid ${t.border}`,
          borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
        Loading saved visualizations…
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div style={{ ...box, borderStyle: 'solid', borderColor: t.dangerBorder, background: t.dangerBg, color: t.danger }}>
        {error}
        <div style={{ marginTop: 10 }}>
          <button onClick={onRetry} style={secondaryButtonStyle(t)}>Try again</button>
        </div>
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ fontWeight: FONT.weight.semibold, color: t.text2, marginBottom: 4 }}>No saved visualizations yet</div>
      Generate one from this entry's page and it will show up here.
    </div>
  );
}

function noticeStyle(t, tone) {
  const map = {
    warn: [t.warnBg, t.warnBorder], danger: [t.dangerBg, t.dangerBorder], info: [t.navActiveBg, t.navActiveBorder],
  };
  const [bg, border] = map[tone] || map.info;
  return { background: bg, border: `1px solid ${border}`, borderRadius: RADIUS.md, padding: '10px 14px',
    marginBottom: SPACE.md, fontSize: FONT.size.base, color: t.text2, lineHeight: 1.5 };
}

const BUTTON_BASE = {
  fontFamily: 'Inter,sans-serif', fontWeight: FONT.weight.semibold, fontSize: FONT.size.base,
  borderRadius: RADIUS.md, height: 40, padding: '0 16px', display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', boxSizing: 'border-box',
};

function primaryButtonStyle(t, busy) {
  return { ...BUTTON_BASE, background: busy ? t.surface3 : t.accent, border: `1px solid ${busy ? t.border : t.accent}`,
    color: busy ? t.text3 : '#fff', cursor: busy ? 'default' : 'pointer' };
}

function secondaryButtonStyle(t) {
  return { ...BUTTON_BASE, background: t.surface2, border: `1px solid ${t.borderStrong}`, color: t.text2, cursor: 'pointer' };
}

function selectedChipStyle(t) {
  return { ...BUTTON_BASE, background: t.navActiveBg, border: `1px solid ${t.navActiveBorder}`, color: t.navActiveText, cursor: 'pointer' };
}

function saveButtonStyle(t, busy) {
  return { ...BUTTON_BASE, background: busy ? t.surface3 : t.okBg, border: `1px solid ${busy ? t.border : t.okBorder}`,
    color: busy ? t.text4 : t.ok, cursor: busy ? 'default' : 'pointer' };
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
export default function VisualLearningPanel(props) {
  if (!VisualizationService.isConfigured()) return null;
  return <VisualLearningPanelContent {...props} />;
}
