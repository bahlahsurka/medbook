import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'medbook_theme';

// Every colour the app's "chrome" uses is expressed as a token here.
// System accent colours (per-system, difficulty) intentionally stay literal —
// they carry meaning and read fine on either background.
export const LIGHT = {
  name:'light',
  bg:'#f3f4f6',            // app shell
  appBg:'#f9fafb',         // scroll/content area + body
  surface:'#ffffff',       // cards, header, sidebar, modals
  surface2:'#f9fafb',      // insets, subtle inputs, hover
  surface3:'#f3f4f6',      // muted buttons
  border:'#e5e7eb',
  borderStrong:'#d1d5db',
  text:'#111827',
  text2:'#374151',
  text3:'#6b7280',
  text4:'#9ca3af',
  accent:'#2563eb',
  navActiveBg:'#eff6ff',
  navActiveText:'#2563eb',
  navActiveBorder:'#bfdbfe',
  dangerBg:'#fef2f2',
  dangerBorder:'#fecaca',
  danger:'#dc2626',
  okBg:'#f0fdf4',
  okBorder:'#bbf7d0',
  ok:'#16a34a',
  warnBg:'#fffbeb',
  warnBorder:'#fde68a',
  warn:'#d97706',
  hlBtnBg:'#fef9c3',
  hlBtnBorder:'#fde68a',
  hlBtnText:'#92400e',
  overlay:'rgba(0,0,0,0.4)',
  shadow:'rgba(0,0,0,.06)',
  shadowStrong:'rgba(0,0,0,.18)',
  spinnerTrack:'#e5e7eb',
};

export const DARK = {
  name:'dark',
  bg:'#0d0f13',
  appBg:'#0d0f13',
  surface:'#181b21',
  surface2:'#22262e',
  surface3:'#2a2f38',
  border:'#2c313a',
  borderStrong:'#3a404b',
  text:'#f1f3f5',
  text2:'#c7ccd4',
  text3:'#9aa2ad',
  text4:'#6b7280',
  accent:'#3b82f6',
  navActiveBg:'rgba(59,130,246,0.16)',
  navActiveText:'#60a5fa',
  navActiveBorder:'rgba(59,130,246,0.4)',
  dangerBg:'rgba(220,38,38,0.14)',
  dangerBorder:'rgba(220,38,38,0.38)',
  danger:'#f87171',
  okBg:'rgba(22,163,74,0.14)',
  okBorder:'rgba(22,163,74,0.38)',
  ok:'#4ade80',
  warnBg:'rgba(217,119,6,0.14)',
  warnBorder:'rgba(217,119,6,0.4)',
  warn:'#fbbf24',
  hlBtnBg:'rgba(217,119,6,0.18)',
  hlBtnBorder:'rgba(217,119,6,0.4)',
  hlBtnText:'#fbbf24',
  overlay:'rgba(0,0,0,0.62)',
  shadow:'rgba(0,0,0,.5)',
  shadowStrong:'rgba(0,0,0,.6)',
  spinnerTrack:'#2c313a',
};

// ---------------------------------------------------------------------------
// Design foundation — spacing, radii, type, elevation, motion, z-index.
//
// Colour already had a proper token system (LIGHT/DARK above); everything
// else was ad-hoc numeric literals repeated per-component (12+ distinct
// border-radius values, 8+ bespoke transition strings, z-index picked per
// file with no scale). These tokens are additive only — nothing that
// consumes LIGHT/DARK needs to change, and no visual output changes just by
// this file existing. Components opt in incrementally.
//
// Kept as plain JS objects (not CSS custom properties) to match the existing
// architecture: every component already reads `t` from useTheme() and builds
// inline style objects from it. Introducing a second, parallel CSS-variable
// system alongside that would be more to keep in sync, not less.

// 4px base scale — covers everything from icon gaps to page padding.
export const SPACE = { xs:4, sm:8, md:12, lg:16, xl:20, xl2:24, xl3:32, xl4:40, xl5:48, xl6:64 };

// Corner radii. `circle`/`pill` are the two special-cased shapes (avatars,
// dots, badges) that don't belong on the linear scale.
export const RADIUS = { sm:6, md:8, lg:10, xl:14, xl2:20, pill:999, circle:'50%' };

// Type scale + weight/line-height ramp. Replaces one-off sizes like 10.5,
// 12.5, 13.5 that crept in from ad hoc tweaks.
export const FONT = {
  size: { micro:10, xs:11, sm:12, base:13, md:14, lg:16, xl:18, xl2:22, xl3:28, display:40 },
  weight: { regular:400, medium:500, semibold:600, bold:700 },
  leading: { tight:1.2, normal:1.4, relaxed:1.6 },
};

// Elevation scale. Pair with the theme's own `shadow`/`shadowStrong` colour
// via the `elevation()` helper below so shadows stay theme-aware.
export const ELEVATION = { sm:'0 1px 2px', md:'0 2px 8px', lg:'0 4px 16px', xl:'0 8px 32px' };

export function elevation(t, level = 'md') {
  const tint = (level === 'lg' || level === 'xl') ? t.shadowStrong : t.shadow;
  return `${ELEVATION[level]} ${tint}`;
}

// Motion — per the animation philosophy: subtle, functional, transform/
// opacity-first, 120–250ms. `ease` is a standard "ease-out"-ish curve that
// reads as calm rather than bouncy, matching the "premium, calm" direction.
export const MOTION = {
  fast: '120ms', normal: '180ms', slow: '250ms',
  ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

// Stacking order, consolidated from what components were already doing
// ad hoc (mobile sidebar scrim at 40, sidebar at 50, dialog overlays
// scattered across 200/300/400, toast/lightbox near 900-1000). Values match
// current call sites so adopting this doesn't change any existing stacking —
// it just gives future components a scale to pick from instead of guessing.
export const Z = { mobileScrim:40, sidebar:50, dropdown:60, overlay:200, modal:300, modalStack:400, toast:900, lightbox:1000 };

const ThemeContext = createContext({ t: LIGHT, theme:'light', toggle:()=>{}, isDark:false });

function readInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return 'light';
}

// Keeps the <body> (outside React's root) in sync so there are no white
// gutters behind the app in dark mode.
function applyBodyTheme(pal) {
  try {
    document.body.style.background = pal.appBg;
    document.body.style.color = pal.text;
    if (pal.name === 'dark') document.body.classList.add('medbook-dark');
    else document.body.classList.remove('medbook-dark');
  } catch {}
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitial);
  const t = theme === 'dark' ? DARK : LIGHT;

  useEffect(() => {
    applyBodyTheme(t);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme, t]);

  const toggle = useCallback(() => setTheme(p => p === 'dark' ? 'light' : 'dark'), []);

  return (
    <ThemeContext.Provider value={{ t, theme, toggle, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
