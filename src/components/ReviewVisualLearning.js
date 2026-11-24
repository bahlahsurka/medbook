// Visual Learning access for the review screens (ReviewQueue, SystemReview):
// a compact trigger plus an in-context drawer showing the entry's SAVED
// diagrams via VisualLearningPanel's read-only mode="saved". The parent owns
// `open` so it can pause its own review keyboard shortcuts while the drawer
// is up; the review session itself stays mounted underneath.
import { lazy, Suspense, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme, SPACE, RADIUS, FONT, MOTION, Z } from '../lib/theme';
import { IconNetwork, IconX, IconChevronRight } from '../lib/icons';
import VisualizationService from '../services/visualization';

const VisualLearningPanel = lazy(() => import('./visualization/VisualLearningPanel'));

const stop = (e) => e.stopPropagation();

export function ReviewVisualLearningButton({ entryId, onOpen, colors }) {
  const { t } = useTheme();
  if (!VisualizationService.isConfigured()) return null;
  const c = { text: t.text2, muted: t.text4, border: t.border, bg: t.surface2, ...colors };
  const saved = VisualizationService.peekSaved(entryId);
  const countLabel = Array.isArray(saved) ? (saved.length ? `${saved.length} saved` : 'none saved') : '';

  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '8px 14px',
        background: c.bg, border: `1px solid ${c.border}`, borderRadius: RADIUS.pill, cursor: 'pointer',
        fontFamily: 'Inter,sans-serif', fontSize: FONT.size.sm, fontWeight: FONT.weight.semibold, color: c.text }}>
      <IconNetwork size={14} />
      Visual Learning
      {countLabel && <span style={{ fontSize: FONT.size.xs, fontWeight: FONT.weight.medium, color: c.muted }}>· {countLabel}</span>}
      <IconChevronRight size={14} style={{ color: c.muted }} />
    </button>
  );
}

export function ReviewVisualLearningDrawer({ entryId, entryTitle, onClose }) {
  const { t } = useTheme();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    // Focus the panel, not the close button: a habitual Enter/Space (the
    // review's Easy/flip keys) would otherwise "click" Back to review.
    panelRef.current?.focus({ preventScroll: true });
    // Capture phase: the drawer's own stopPropagation (below) blocks the
    // bubble phase from reaching document.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); } };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  // React events from a portal still bubble to the review screen's React
  // tree: clicks and keys are stopped here so none reach it (keys also never
  // reach the document-level review shortcuts). Pointer/mouse/touch events
  // are deliberately NOT stopped — the diagram's pan/drag relies on
  // window-level move/up listeners.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Visual Learning" data-testid="review-visual-learning"
      onClick={stop} onKeyDown={stop} onKeyUp={stop}
      style={{ position: 'fixed', inset: 0, zIndex: Z.modalStack, display: 'flex', justifyContent: 'flex-end',
        fontFamily: 'Inter,sans-serif' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: t.overlay,
        animation: `medbook-scrim-in ${MOTION.normal} ${MOTION.ease}` }} />
      {/* Opacity-only animation: a transform here would turn the renderers'
          position:fixed fullscreen mode into position-relative-to-drawer. */}
      <div ref={panelRef} tabIndex={-1} style={{ outline: 'none', position: 'relative', width: 'min(880px, 100%)', height: '100%', background: t.surface,
        borderLeft: `1px solid ${t.border}`, boxShadow: `0 0 40px ${t.shadowStrong}`, display: 'flex', flexDirection: 'column',
        animation: `medbook-scrim-in ${MOTION.normal} ${MOTION.ease}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
          borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <IconNetwork size={15} style={{ color: t.text3, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.size.micro, color: t.text4, letterSpacing: .8, fontWeight: FONT.weight.semibold, textTransform: 'uppercase' }}>
              Visual Learning
            </div>
            {entryTitle && (
              <div style={{ fontSize: FONT.size.md, fontWeight: FONT.weight.bold, color: t.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entryTitle}</div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Back to review"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '8px 14px',
              background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.pill, cursor: 'pointer',
              fontFamily: 'Inter,sans-serif', fontSize: FONT.size.sm, fontWeight: FONT.weight.semibold, color: t.text2, flexShrink: 0 }}>
            <IconX size={13} /> Back to review
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px` }}>
          <Suspense fallback={null}>
            <VisualLearningPanel key={entryId} entryId={entryId} mode="saved" />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body
  );
}
