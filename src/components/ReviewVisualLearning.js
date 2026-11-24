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
import useSavedVisualizationTypes from './visualization/useSavedVisualizationTypes';

const VisualLearningPanel = lazy(() => import('./visualization/VisualLearningPanel'));

const stop = (e) => e.stopPropagation();

// Slide-in for the drawer. No fill-mode, so once it finishes the panel has
// no transform — a transform would trap the diagrams' position:fixed
// fullscreen mode inside the drawer.
const DRAWER_CSS = `
  @keyframes mb-drawer-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
  @keyframes mb-drawer-up { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
  .mb-drawer-panel { animation: mb-drawer-in 220ms cubic-bezier(.2,.7,.2,1); }
  @media (max-width: 640px) { .mb-drawer-panel { animation-name: mb-drawer-up; } }
  .mb-drawer-btn { transition: background 120ms ease, border-color 120ms ease; }
  @media (prefers-reduced-motion: reduce) { .mb-drawer-panel, .mb-drawer-scrim { animation: none !important; } }
`;

export function ReviewVisualLearningButton({ entryId, onOpen, colors }) {
  const { t } = useTheme();
  const types = useSavedVisualizationTypes(entryId);
  if (!VisualizationService.isConfigured()) return null;
  const c = { text: t.text2, muted: t.text4, border: t.border, bg: t.surface2, ...colors };
  const known = Array.isArray(types);
  const count = known ? types.length : 0;
  const none = known && count === 0;

  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" className="mb-drawer-btn"
      title={none ? 'No diagrams saved for this entry yet' : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '8px 14px',
        background: none ? 'transparent' : c.bg, border: `1px solid ${c.border}`, borderRadius: RADIUS.pill, cursor: 'pointer',
        fontFamily: 'Inter,sans-serif', fontSize: FONT.size.sm, fontWeight: FONT.weight.semibold, color: none ? c.muted : c.text }}>
      <IconNetwork size={14} />
      Visual Learning
      {count > 0 && (
        <span style={{ fontSize: FONT.size.xs, fontWeight: FONT.weight.semibold, color: t.navActiveText, background: t.navActiveBg,
          border: `1px solid ${t.navActiveBorder}`, borderRadius: RADIUS.pill, padding: '1px 8px' }}>
          {count} saved
        </span>
      )}
      {none && <span style={{ fontSize: FONT.size.xs, fontWeight: FONT.weight.medium }}>· none yet</span>}
      <IconChevronRight size={14} style={{ color: c.muted }} />
    </button>
  );
}

export function ReviewVisualLearningDrawer({ entryId, entryTitle, entryNotes, onClose }) {
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
    // A diagram in fullscreen handles Esc itself (exits fullscreen first).
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('[data-mb-viz-fullscreen="true"]')) return;
      e.preventDefault();
      onCloseRef.current();
    };
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
      <style>{DRAWER_CSS}</style>
      <div onClick={onClose} className="mb-drawer-scrim" style={{ position: 'absolute', inset: 0, background: t.overlay,
        animation: `medbook-scrim-in ${MOTION.normal} ${MOTION.ease}` }} />
      <div ref={panelRef} tabIndex={-1} className="mb-drawer-panel" style={{ outline: 'none', position: 'relative', width: 'min(880px, 100%)', height: '100%', background: t.surface,
        borderLeft: `1px solid ${t.border}`, boxShadow: `0 0 40px ${t.shadowStrong}`, display: 'flex', flexDirection: 'column' }}>
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
          <button type="button" onClick={onClose} aria-label="Back to review" className="mb-drawer-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '8px 14px',
              background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS.pill, cursor: 'pointer',
              fontFamily: 'Inter,sans-serif', fontSize: FONT.size.sm, fontWeight: FONT.weight.semibold, color: t.text2, flexShrink: 0 }}>
            <IconX size={13} /> Back to review
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px` }}>
          <Suspense fallback={null}>
            <VisualLearningPanel key={entryId} entryId={entryId} mode="saved" notes={entryNotes} />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body
  );
}
