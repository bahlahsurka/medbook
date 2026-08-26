// Minimal hand-rolled stroke-icon set for the app shell/navigation.
//
// Emoji render inconsistently across OS/browser (different weight, colour,
// style per platform) which fights the "premium, restrained" direction and
// the light/dark theme system — these are plain SVG so they inherit
// `currentColor` and transition colour smoothly with everything else.
// No icon library added: this keeps bundle size and dependencies unchanged,
// per "do NOT introduce a heavy animation/UI library unnecessarily".
import React from 'react';

const base = { fill:'none', stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round' };

function Svg({ size, style, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className} {...base}>
      {children}
    </svg>
  );
}

export function IconMenu({ size=18, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </Svg>;
}

export function IconX({ size=18, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </Svg>;
}

export function IconSearch({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>;
}

export function IconRepeat({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Svg>;
}

export function IconCards({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <rect x="4" y="7" width="13" height="15" rx="2" />
    <path d="M8 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-3" />
  </Svg>;
}

export function IconChart({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <line x1="4" y1="21" x2="4" y2="10" />
    <line x1="12" y1="21" x2="12" y2="4" />
    <line x1="20" y1="21" x2="20" y2="14" />
  </Svg>;
}

export function IconSun({ size=15, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="2" y1="12" x2="4" y2="12" />
    <line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </Svg>;
}

export function IconMoon({ size=15, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M20 12.5A8 8 0 1 1 11.5 4a6.5 6.5 0 0 0 8.5 8.5z" />
  </Svg>;
}

export function IconDownload({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Svg>;
}

export function IconUpload({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </Svg>;
}

export function IconSettings({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>;
}

export function IconLogout({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Svg>;
}

export function IconChevronLeft({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="15 18 9 12 15 6" />
  </Svg>;
}

export function IconChevronRight({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>;
}

export function IconChevronDown({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="6 9 12 15 18 9" />
  </Svg>;
}

export function IconInbox({ size=32, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Svg>;
}

// App mark — a simple pulse/ECG line. Reads as medical without being
// literal, and renders identically everywhere (unlike the old ⚕ emoji).
export function IconPulse({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="2 12 7 12 9 6 12 18 15 9 17 12 22 12" />
  </Svg>;
}

export function IconPlus({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>;
}

// --- Added for the Entry detail/editor screen (batch 6) --------------------

export function IconEdit({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </Svg>;
}

export function IconCheck({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>;
}

export function IconTrash({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>;
}

// A pushpin rather than a map-marker — reads more clearly at 14px as
// "pinned to the top" rather than "location".
export function IconPin({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
    <line x1="12" y1="17" x2="12" y2="22" />
  </Svg>;
}

export function IconImages({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </Svg>;
}

// Four-point sparkle — stands in for the ✨ emoji on the AI Analyze action so
// it renders identically across platforms/themes like the rest of this set.
export function IconSparkle({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <path d="M12 3 L13.6 9.4 L20 11 L13.6 12.6 L12 19 L10.4 12.6 L4 11 L10.4 9.4 Z" />
  </Svg>;
}

// --- Added for Flashcards + Review Queue (batch 7) --------------------------

// Filled triangle (not just an outline) — reads clearly as "play/study" at
// small sizes, replacing the ▶ character used ad hoc before this batch.
export function IconPlay({ size=14, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className}
      fill="currentColor" stroke="none">
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" />
    </svg>
  );
}

export function IconPause({ size=14, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className}
      fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

// Stacked cards — used for the flashcard folder/deck rows.
export function IconLayers({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" />
    <polyline points="2 15.5 12 22 22 15.5" />
    <polyline points="2 12 12 18.5 22 12" />
  </Svg>;
}

// Lightning bolt — a compact "this needs attention" marker for the highest-
// due systems in the Review Queue's priority breakdown.
export function IconZap({ size=14, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className}
      fill="currentColor" stroke="none">
      <path d="M13 2 3 14h7l-1 8 11-14h-7l0-6z" />
    </svg>
  );
}

// Upward trend line — Insights nav item. Deliberately distinct from
// IconChart (plain bars, used for Dashboard) so the two entries read as
// different destinations at a glance, not two icons for the same idea.
export function IconTrendUp({ size=16, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="3 17 9 11 13 15 21 6" />
    <polyline points="14 6 21 6 21 13" />
  </Svg>;
}

// --- Added for Imported Decks study screen (batch 2 — Focus Mode) -----------

// Four corner brackets pointing outward — "enter focus/fullscreen".
export function IconMaximize({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="8 3 3 3 3 8" />
    <polyline points="16 3 21 3 21 8" />
    <polyline points="3 16 3 21 8 21" />
    <polyline points="21 16 21 21 16 21" />
  </Svg>;
}

// Same four brackets, pointing inward — "exit focus/fullscreen". Distinct
// from IconX: this reads as "shrink back", not "cancel/close", which
// matters when it sits alone as the only way out of Focus Mode.
export function IconMinimize({ size=14, style, className }) {
  return <Svg size={size} style={style} className={className}>
    <polyline points="3 8 8 8 8 3" />
    <polyline points="21 8 16 8 16 3" />
    <polyline points="8 21 8 16 3 16" />
    <polyline points="16 16 16 21 21 21" />
  </Svg>;
}

// --- Added for Favorites (batch 4) -------------------------------------

// Star — "favorite this card" toggle and the Favorite Cards nav/empty-state
// icon. `filled` switches between an outline (not favorited) and a solid
// currentColor fill (favorited), same solid-vs-stroke split IconPlay/
// IconPause already use elsewhere in this file for an on/off icon state,
// rather than inventing a second convention for it.
export function IconStar({ size=14, style, className, filled=false }) {
  const points = "12 2.5 15.09 8.76 22 9.77 17 14.64 18.18 21.52 12 18.27 5.82 21.52 7 14.64 2 9.77 8.91 8.76";
  if (filled) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className}
        fill="currentColor" stroke="none">
        <polygon points={points} />
      </svg>
    );
  }
  return <Svg size={size} style={style} className={className}>
    <polygon points={points} strokeLinejoin="round" />
  </Svg>;
}
