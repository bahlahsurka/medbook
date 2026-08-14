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
