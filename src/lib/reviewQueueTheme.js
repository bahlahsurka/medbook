// lib/reviewQueueTheme.js
//
// A scoped visual-identity layer for the Review Queue redesign.
// Deliberately NOT added to lib/theme.js's LIGHT/DARK palettes: those are
// consumed by every other screen in the app (Dashboard, Insights, Sidebar,
// DetailView, FlashCards, ...), so changing their color values would
// redesign the whole product, not just this one page. This module is
// additive and import-only-from-ReviewQueue.js, so the blast radius of this
// redesign is exactly one file.
//
// Structural tokens (spacing scale, radius scale, motion timing, font
// SIZE/WEIGHT scale, breakpoints) are still read from lib/theme.js as
// normal — only the COLOR language here is bespoke. Reusing those keeps
// this redesign's rhythm consistent with the rest of the app's existing
// 4px spacing grid and motion curve, per "reuse existing tokens where
// appropriate."
//
// Palette direction:
//   - LIGHT mode keeps the sage-green / cream / warm-tan family (five
//     supplied anchor colors — #76B7A6, #A9D7C8, #FFF2DA, #EBCFB1, #3F6A5E).
//   - DARK mode is deliberately NOT part of that bespoke identity — per
//     explicit user feedback asking for "the original blue and black best
//     color palette" back, DARK is instead derived directly from lib/
//     theme.js's own DARK export (the same near-black/blue-accent identity
//     every other screen already uses), so Review Queue's dark mode reads
//     as the rest of the app again rather than its own standalone brand.
//     Semantic states (due/fresh/success/warn) are likewise pulled from
//     lib/theme.js's existing danger/ok/warn tokens where one exists, so
//     a rating button here matches the same hue it would anywhere else.

export function getReviewQueueTheme(isDark) {
  return isDark ? DARK : LIGHT;
}

const DARK = {
  // Page / deep background — lib/theme.js DARK.bg, the same near-black
  // every other screen's dark mode sits on.
  page: '#0d0f13',
  // Primary containers (the setup card, the active review card).
  surface: '#181b21',
  surfaceRaised: '#22262e',   // the active card itself, one step up
  // Recessed — insets, the track behind a selected-chip fill, the progress
  // bar's own background.
  surfaceSunken: '#090a0d',
  // Secondary elements (chips, pills) get a quieter fill than primary
  // containers.
  surfaceQuiet: '#14171c',

  // Borders — two distinct weights, not one border color reused everywhere.
  border: '#2c313a',          // subtle, for secondary elements
  borderRich: '#3a404b',      // richer, for primary containers

  // Text tiers — lib/theme.js DARK's own text scale.
  text: '#f1f3f5',
  text2: '#c7ccd4',
  text3: '#9aa2ad',
  text4: '#6b7280',

  // Brand / selected state — lib/theme.js DARK's own blue accent.
  accent: '#3b82f6',
  accentStrong: '#60a5fa',    // lighter blue — hover/active text-on-accent
  accentDeep: '#1d4ed8',      // deep blue — small singular accents only
                               // (e.g. a hover shadow tint) — NOT a chip fill
  accentBg: 'rgba(59,130,246,0.16)',
  accentBorder: 'rgba(59,130,246,0.4)',

  // Semantic states — matching lib/theme.js DARK's own danger/ok/warn hues,
  // plus a sky-blue "fresh" that stays in the blue family while reading
  // distinct from the main accent.
  due: '#f87171',             // lib/theme.js DARK.danger
  dueBg: 'rgba(220,38,38,0.14)',
  dueBorder: 'rgba(220,38,38,0.38)',

  fresh: '#38bdf8',
  freshBg: 'rgba(56,189,248,0.14)',
  freshBorder: 'rgba(56,189,248,0.36)',

  success: '#4ade80',         // lib/theme.js DARK.ok
  successBg: 'rgba(22,163,74,0.14)',
  successBorder: 'rgba(22,163,74,0.38)',

  warn: '#fbbf24',            // lib/theme.js DARK.warn
  warnBg: 'rgba(217,119,6,0.14)',
  warnBorder: 'rgba(217,119,6,0.4)',

  // Shadows — neutral black, matching lib/theme.js DARK's own shadow tokens.
  shadow: 'rgba(0,0,0,.5)',
  shadowRich: 'rgba(0,0,0,.6)',
};

const LIGHT = {
  // The given cream, used directly for the page itself.
  page: '#FFF2DA',
  surface: '#FFFBF2',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#F5E7C9',
  surfaceQuiet: '#FCF6E7',

  border: '#E9DCC0',
  borderRich: '#D9BF93',

  text: '#211d18',
  text2: '#4a443a',
  text3: '#766f61',
  text4: '#a69d8a',

  // Brand / selected state — the given deep forest tone, dark enough to
  // read on the cream page.
  accent: '#3F6A5E',
  accentStrong: '#2c4d43',
  accentDeep: '#A9D7C8',      // the given mint — reserved for small,
                               // singular accents only (e.g. a hover
                               // shadow tint) — NOT a chip fill
  accentBg: 'rgba(63,106,94,0.08)',
  accentBorder: 'rgba(63,106,94,0.3)',

  due: '#b5693f',             // warm terracotta
  dueBg: 'rgba(181,105,63,0.08)',
  dueBorder: 'rgba(181,105,63,0.28)',

  fresh: '#8a6a37',           // the given tan, darkened for text contrast
                               // on a light page — EBCFB1 itself is the
                               // background tint it sits on (freshBg below)
  freshBg: 'rgba(235,207,177,0.35)',
  freshBorder: 'rgba(180,140,90,0.35)',

  success: '#3f7a63',
  successBg: 'rgba(63,122,99,0.09)',
  successBorder: 'rgba(63,122,99,0.28)',

  warn: '#8f6423',
  warnBg: 'rgba(143,100,35,0.09)',
  warnBorder: 'rgba(143,100,35,0.28)',

  shadow: 'rgba(60,48,20,0.1)',
  shadowRich: 'rgba(60,48,20,0.18)',
};
