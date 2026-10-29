// lib/reviewQueueTheme.js
//
// A scoped visual-identity layer for the Review Queue redesign (editorial
// luxury × modern precision — see the supplied design-direction brief).
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
// Palette direction: warm graphite (not cold slate, not pure black/white,
// and deliberately NOT violet-tinted — the neutrals below are as close to
// true neutral as a "warm" graphite gets, so purple reads only where it's
// meant to: the restrained aubergine accent/selection color, used with
// intention rather than bleeding into every surface) and three distinct
// warm semantic accents (muted burgundy for "due", soft antique gold for
// "new", sage for success) so due/new/priority states stay legible without
// leaning on the brand color for everything. Every surface/border/text tier
// below exists because a real element in ReviewQueue.js's redesign needs
// exactly that role — this is not a generic duotone.

export function getReviewQueueTheme(isDark) {
  return isDark ? DARK : LIGHT;
}

const DARK = {
  // Page / deep background — a true warm-neutral near-black graphite, not
  // a cold slate, not pure #000, and (unlike an earlier pass) not tinted
  // violet either — the whole neutral scale below sits within a couple of
  // RGB units of true gray, so the only purple on screen is the deliberate
  // accent color below, not the backdrop it sits on.
  page: '#161516',
  // Primary containers (the setup card, the active review card) — richer
  // contrast against the page than a "secondary" surface gets.
  surface: '#1e1c1e',
  surfaceRaised: '#252225',   // the active card itself, one step up
  // Recessed — insets, the track behind a selected-chip fill, the progress
  // bar's own background.
  surfaceSunken: '#111011',
  // Secondary elements (chips, pills) get a quieter fill than primary
  // containers, matching the brief's "subtle outlines for secondary
  // elements."
  surfaceQuiet: '#201e20',

  // Borders — two distinct weights, not one border color reused everywhere.
  border: '#2c2a2c',          // subtle, for secondary elements
  borderRich: '#423f42',      // richer, for primary containers

  // Text tiers.
  text: '#efeaf2',            // primary — warm off-white, not pure white
  text2: '#c7c0d1',           // secondary
  text3: '#968ea2',           // tertiary / metadata
  text4: '#6c6577',           // quaternary / faint, disabled-adjacent

  // Brand / selected state — one restrained aubergine, used with intention
  // (a border + a low-alpha wash for "selected", never a solid fill across
  // multiple chips at once — see accentBg below, which is what selection
  // actually uses now).
  accent: '#b08bdb',
  accentStrong: '#c7a8e8',    // hover/active text-on-accent moments
  accentDeep: '#4f3862',      // reserved for small, singular accents only
                               // (e.g. a hover shadow tint) — NOT a chip fill
  accentBg: 'rgba(176,139,219,0.14)',
  accentBorder: 'rgba(176,139,219,0.45)',

  // Semantic states — each its own hue family, not tints of the accent.
  due: '#c97b8a',             // muted burgundy-rose
  dueBg: 'rgba(201,123,138,0.13)',
  dueBorder: 'rgba(201,123,138,0.38)',

  fresh: '#cfa15a',           // soft antique gold ("new")
  freshBg: 'rgba(207,161,90,0.13)',
  freshBorder: 'rgba(207,161,90,0.36)',

  success: '#7fac8e',
  successBg: 'rgba(127,172,142,0.14)',
  successBorder: 'rgba(127,172,142,0.36)',

  warn: '#cf9a5e',
  warnBg: 'rgba(207,154,94,0.14)',
  warnBorder: 'rgba(207,154,94,0.36)',

  // Shadows — warm-tinted, not neutral black, so elevation reads as part
  // of the same material rather than a generic drop-shadow.
  shadow: 'rgba(10,8,14,0.45)',
  shadowRich: 'rgba(10,8,14,0.6)',
};

const LIGHT = {
  // Parchment-leaning warm neutral, not a stark white.
  page: '#f2efe9',
  surface: '#fbf9f5',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#eae6de',
  surfaceQuiet: '#f3f0ea',

  border: '#e1dcd1',
  borderRich: '#c9c0b0',

  text: '#211d28',
  text2: '#4a4350',
  text3: '#766e7c',
  text4: '#a79fae',

  accent: '#6e4590',
  accentStrong: '#5a3677',
  accentDeep: '#ead9f7',
  accentBg: 'rgba(110,69,144,0.08)',
  accentBorder: 'rgba(110,69,144,0.3)',

  due: '#9c4255',
  dueBg: 'rgba(156,66,85,0.08)',
  dueBorder: 'rgba(156,66,85,0.28)',

  fresh: '#8a6420',
  freshBg: 'rgba(138,100,32,0.09)',
  freshBorder: 'rgba(138,100,32,0.28)',

  success: '#3f7355',
  successBg: 'rgba(63,115,85,0.09)',
  successBorder: 'rgba(63,115,85,0.28)',

  warn: '#8f5f23',
  warnBg: 'rgba(143,95,35,0.09)',
  warnBorder: 'rgba(143,95,35,0.28)',

  shadow: 'rgba(40,32,20,0.1)',
  shadowRich: 'rgba(40,32,20,0.18)',
};
