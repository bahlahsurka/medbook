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
// Palette direction: a sage-green / cream / warm-tan family (five supplied
// anchor colors — #76B7A6, #A9D7C8, #FFF2DA, #EBCFB1, #3F6A5E — deliberately
// NOT a purple/aubergine identity), read as calm and organic rather than a
// generic "AI SaaS" dark-plus-violet look. Both ends of the green range get
// used, one per theme: the deep forest tone (#3F6A5E) anchors the LIGHT
// mode accent (dark enough to read on a cream page), and the brighter
// medium sage (#76B7A6) anchors the DARK mode accent (light enough to read
// on a near-black page) — plus the given mint (#A9D7C8) and tan (#EBCFB1)
// reused directly for a hover tint and the "new" semantic color
// respectively. Semantic states each keep their own hue family (terracotta
// for "due", tan/gold for "new", sage for "success") so due/new/priority
// states stay legible without leaning on the brand color for everything.

export function getReviewQueueTheme(isDark) {
  return isDark ? DARK : LIGHT;
}

const DARK = {
  // Page / deep background — a true warm-neutral near-black graphite, with
  // only the faintest cool-green whisper (not a cold slate, not pure #000,
  // and not tinted toward any one hue strongly enough to read as "colored
  // surfaces" — the palette's identity lives in the accent/semantic colors
  // below, not bled into the backdrop).
  page: '#151817',
  // Primary containers (the setup card, the active review card) — richer
  // contrast against the page than a "secondary" surface gets.
  surface: '#1d201e',
  surfaceRaised: '#252825',   // the active card itself, one step up
  // Recessed — insets, the track behind a selected-chip fill, the progress
  // bar's own background.
  surfaceSunken: '#101211',
  // Secondary elements (chips, pills) get a quieter fill than primary
  // containers, matching the brief's "subtle outlines for secondary
  // elements."
  surfaceQuiet: '#1f2220',

  // Borders — two distinct weights, not one border color reused everywhere.
  border: '#2a2d2b',          // subtle, for secondary elements
  borderRich: '#40443f',      // richer, for primary containers

  // Text tiers.
  text: '#eef3ef',            // primary — warm off-white, not pure white
  text2: '#c6cec8',           // secondary
  text3: '#95a099',           // tertiary / metadata
  text4: '#69746d',           // quaternary / faint, disabled-adjacent

  // Brand / selected state — the given medium sage, bright enough to read
  // on a near-black page. One restrained accent, used with intention (a
  // border + a low-alpha wash for "selected", never a solid fill across
  // multiple chips at once — see accentBg below, which is what selection
  // actually uses).
  accent: '#76B7A6',
  accentStrong: '#A9D7C8',    // the given mint — hover/active text-on-accent
  accentDeep: '#3F6A5E',      // reserved for small, singular accents only
                               // (e.g. a hover shadow tint) — NOT a chip fill
  accentBg: 'rgba(118,183,166,0.16)',
  accentBorder: 'rgba(118,183,166,0.45)',

  // Semantic states — each its own hue family, not tints of the accent.
  due: '#d98f68',             // warm terracotta
  dueBg: 'rgba(217,143,104,0.14)',
  dueBorder: 'rgba(217,143,104,0.38)',

  fresh: '#EBCFB1',           // the given tan, used directly — reads well
  freshBg: 'rgba(235,207,177,0.14)',
  freshBorder: 'rgba(235,207,177,0.36)',

  success: '#8fcdb0',
  successBg: 'rgba(143,205,176,0.14)',
  successBorder: 'rgba(143,205,176,0.36)',

  warn: '#d9a855',
  warnBg: 'rgba(217,168,85,0.14)',
  warnBorder: 'rgba(217,168,85,0.36)',

  // Shadows — warm-tinted, not neutral black, so elevation reads as part
  // of the same material rather than a generic drop-shadow.
  shadow: 'rgba(8,10,9,0.45)',
  shadowRich: 'rgba(8,10,9,0.6)',
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
