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

// One metadata entry per supported type — the selector, the idle-state
// description, and the Generate button's label all read from this instead
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
  { key: 'mind_map', label: 'Mind Map', description: 'A central topic with its branches, red flags, and high-yield facts.', family: 'graph' },
  { key: 'knowledge_network', label: 'Knowledge Network', description: 'Related concepts cross-linked by multiple kinds of relationships.', family: 'graph' },
  { key: 'clinical_flowchart', label: 'Clinical Flowchart', description: 'A step-by-step clinical decision pathway, with clear branch conditions.', family: 'graph' },
  { key: 'mechanism_diagram', label: 'Mechanism Diagram', description: 'A cause → mechanism → consequence chain showing how it happens.', family: 'graph' },
  { key: 'comparison_map', label: 'Comparison Map', description: 'A side-by-side grid comparing related conditions, drugs, or treatments.', family: 'comparison' },
  { key: 'visual_summary', label: 'Visual Summary', description: 'A compact, prioritized set of highlights for quick revision.', family: 'summary' },
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
function VisualLearningPanelContent({ entryId, mode = 'full', notes }) {
  const { t } = useTheme();
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

  if (savedOnly && (savedStatus !== 'loaded' || visibleTypes.length === 0)) {
    return <SavedModeState t={t} status={savedStatus} error={savedError}
      onRetry={() => { setSavedError(''); setSavedStatus('loading'); }} />;
  }

  return (
    <div className={savedOnly ? undefined : 'mb-detail-card'} style={savedOnly ? undefined : { background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: RADIUS.lg, boxShadow: elevation(t, 'sm') }}>

      {!savedOnly && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.md, flexWrap: 'wrap' }}>
        <div style={{ fontSize: FONT.size.micro, color: t.text4, letterSpacing: .8, fontWeight: FONT.weight.semibold,
          textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 7 }}>
          <IconNetwork size={13} style={{ color: t.text4, flexShrink: 0 }} /> Visual Learning
        </div>
        <span style={{ fontSize: FONT.size.micro, color: t.text4, background: t.surface3, borderRadius: RADIUS.sm,
          padding: '2px 7px', fontWeight: FONT.weight.semibold }}>
          Preview
        </span>
      </div>}

      {/* Type selector — explicit, never auto-generates. A ✓ marks a type
          already generated this session so switching back to it is known
          to be instant. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: SPACE.sm }}>
        {visibleTypes.map(({ key, label }) => {
          const typeState = getTypeState(key);
          return (
            <button key={key} onClick={() => setSelectedType(key)} style={typeChipStyle(t, key === selectedType)}
              title={!savedOnly && typeState.status !== 'loaded' && savedTypes?.includes(key) ? 'Saved to this entry' : undefined}>
              {!savedOnly && typeState.status === 'loaded' && <span style={{ color: t.ok }}>✓</span>}
              {!savedOnly && typeState.status !== 'loaded' && savedTypes?.includes(key) && (
                <span aria-label="saved" style={{ width: 6, height: 6, borderRadius: 999, background: t.accent, flexShrink: 0 }} />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {/* Recommend — optional, advisory, never auto-generates anything.
          Picking a recommended chip only switches the selector above;
          generating still requires the usual explicit Generate click. */}
      {!savedOnly && <div style={{ marginBottom: SPACE.md }}>
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
      </div>}
      {savedOnly && <div style={{ marginBottom: SPACE.sm }} />}

      {current.status === 'loaded' && current.result ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.sm, flexWrap: 'wrap' }}>
            <span style={{ fontSize: FONT.size.xs, color: t.text4 }}>
              {savedOnly
                ? `Saved${fmtSavedDate(current.result.visualization?.updatedAt) ? ` ${fmtSavedDate(current.result.visualization.updatedAt)}` : ''}`
                : current.result.cached
                  ? `✓ Saved to this entry${fmtSavedDate(current.result.visualization?.updatedAt) ? ` · ${fmtSavedDate(current.result.visualization.updatedAt)}` : ''}`
                  : `✓ Generated and saved to this entry${current.result.timing?.totalMs ? ` in ${(current.result.timing.totalMs / 1000).toFixed(1)}s` : ''}`}
              {current.result.visualization?.aiModel ? ` · ${current.result.visualization.aiModel}` : ''}
              {current.result.visualization?.isEdited && !current.editMode && (
                <span style={{ marginLeft: 6, color: t.navActiveText, fontWeight: FONT.weight.semibold }}>· Edited by you</span>
              )}
            </span>

            {/* Compact editing toolbar — Edit/Save/Discard/Restore. Save/
                Discard/Restore only ever appear once editing is actually
                active or there's something to restore, so view mode stays
                exactly as clean as Phase 3 shipped it. */}
            {savedOnly && current.result.visualization?.isEdited && (
              <span style={{ fontSize: FONT.size.micro, color: t.text4 }}>· original AI version kept</span>
            )}
            {savedOnly ? (
              <span style={{ fontSize: FONT.size.micro, color: t.text4, marginLeft: 'auto' }}>Edit or regenerate from the entry page</span>
            ) : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {current.editMode ? (
                <>
                  {current.isDirty && <span style={{ fontSize: FONT.size.micro, color: t.warn, alignSelf: 'center', fontWeight: FONT.weight.semibold }}>● Unsaved changes</span>}
                  <button onClick={() => performSave(selectedType)} disabled={isBusy} style={saveButtonStyle(t, isBusy)}>
                    {isBusy ? 'Saving…' : '✓ Save Changes'}
                  </button>
                  <button onClick={() => requestDiscard(selectedType)} disabled={isBusy} style={regenerateButtonStyle(t)}>Discard Changes</button>
                </>
              ) : (
                <>
                  <button onClick={() => startEdit(selectedType)} style={regenerateButtonStyle(t)}>✎ Edit</button>
                  <button onClick={() => requestRegenerate(selectedType)} disabled={current.status === 'loading'} style={regenerateButtonStyle(t)}>↻ Regenerate</button>
                  <button onClick={() => requestDelete(selectedType)} disabled={isBusy} style={{ ...regenerateButtonStyle(t), color: t.danger }}>🗑 Delete</button>
                </>
              )}
              {current.result.visualization?.isEdited && (
                <button onClick={() => requestRestore(selectedType)} disabled={isBusy} style={regenerateButtonStyle(t)}>⟲ Restore Original AI Version</button>
              )}
            </div>}
          </div>

          {isStale && !current.editMode && (
            <div role="status" style={{ background: t.warnBg, border: `1px solid ${t.warnBorder}`, borderRadius: RADIUS.md,
              padding: '8px 12px', marginBottom: SPACE.sm, fontSize: FONT.size.xs, color: t.text2, lineHeight: 1.5 }}>
              <strong style={{ color: t.warn }}>May be out of date.</strong> Your Review changed after this diagram was made.
              {savedOnly ? ' Regenerate it from the entry page to update it.' : ' Use ↻ Regenerate to rebuild it from the current Review.'}
              {current.result.visualization?.isEdited ? ' Your edits are kept until you do.' : ''}
            </div>
          )}

          {/* Inline confirmation — shown instead of acting immediately
              whenever discarding/restoring would lose something real. */}
          {current.confirmAction && (
            <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: RADIUS.md,
              padding: '10px 12px', marginBottom: SPACE.sm, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: FONT.size.xs, color: t.danger, flex: 1 }}>
                {current.confirmAction === 'discard'
                  ? 'Discard your unsaved changes? This can\'t be undone.'
                  : current.confirmAction === 'regenerate'
                    ? 'Regenerate this diagram? Your edited version and the current AI version will be replaced by a new one.'
                    : current.confirmAction === 'delete'
                      ? `Delete this ${currentMeta?.label || 'diagram'} from the entry? It will no longer appear here or in review. This can't be undone.`
                      : 'Restore the original AI version? Your saved edits will be replaced and can\'t be recovered.'}
              </span>
              <button
                onClick={() => (current.confirmAction === 'discard' ? performDiscard(selectedType)
                  : current.confirmAction === 'regenerate' ? (cancelConfirm(selectedType), run(selectedType, true))
                  : current.confirmAction === 'delete' ? performDelete(selectedType)
                  : performRestore(selectedType))}
                style={{ ...saveButtonStyle(t, false), background: t.danger, border: `1px solid ${t.danger}`, color: '#fff' }}>
                Yes, {current.confirmAction}
              </button>
              <button onClick={() => cancelConfirm(selectedType)} style={regenerateButtonStyle(t)}>Cancel</button>
            </div>
          )}

          {current.saveStatus === 'error' && (
            <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: RADIUS.md,
              padding: '10px 14px', fontSize: 12.5, color: t.danger, marginBottom: SPACE.sm }}>
              {current.saveError}{current.editMode ? ' Your edits are still here — try saving again.' : ''}
            </div>
          )}
          {current.saveStatus === 'saved' && !current.editMode && (
            <div style={{ fontSize: FONT.size.xs, color: t.ok, marginBottom: SPACE.sm, animation: 'medbook-scrim-in 220ms ease' }}>✓ Saved</div>
          )}

          {current.editMode ? (
            currentMeta.family === 'graph' ? (
              <Suspense fallback={<RendererFallback t={t} />}>
                <Renderer diagram={current.draft} editable onDraftChange={next => changeDraft(selectedType, next)} />
              </Suspense>
            ) : (
              <div style={{ width: '100%', height: 'clamp(320px, 65vh, 480px)', borderRadius: RADIUS.lg, overflow: 'hidden', border: `1px solid ${t.accent}55` }}>
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

function SavedModeState({ t, status, error, onRetry }) {
  const box = { border: `1px dashed ${t.border}`, borderRadius: RADIUS.lg, padding: '18px 16px',
    fontSize: 12.5, color: t.text3, lineHeight: 1.6, textAlign: 'center' };
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
          <button onClick={onRetry} style={regenerateButtonStyle(t)}>Try again</button>
        </div>
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ fontWeight: FONT.weight.semibold, color: t.text2, marginBottom: 4 }}>No saved visualizations yet</div>
      Open this entry's detail page to generate a Mind Map, Flowchart, or another diagram. It will show up here on your next review.
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
    borderRadius: RADIUS.sm - 1, padding: '5px 10px', cursor: 'pointer', minHeight: 30,
  };
}

function saveButtonStyle(t, busy) {
  return {
    fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, fontFamily: 'Inter,sans-serif',
    background: busy ? t.surface3 : t.okBg, border: `1px solid ${busy ? t.border : t.okBorder}`,
    color: busy ? t.text4 : t.ok, borderRadius: RADIUS.sm - 1, padding: '5px 10px',
    cursor: busy ? 'default' : 'pointer', minHeight: 30,
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
export default function VisualLearningPanel({ entryId, mode = 'full', notes }) {
  if (!VisualizationService.isConfigured()) return null;
  return <VisualLearningPanelContent entryId={entryId} mode={mode} notes={notes} />;
}
