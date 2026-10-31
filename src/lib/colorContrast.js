// lib/colorContrast.js
//
// Small, self-contained color-math helpers for the syllabus-progress
// register's per-system colors. Two problems these solve:
//
//   1. Dark-color visibility floor — a system's identity color (e.g. a
//      near-black ENT or deep-maroon Rheumatology swatch) is tuned to read
//      fine on a LIGHT page, but against this app's dark card surfaces the
//      same swatch can be nearly invisible. ensureDarkContrastFloor nudges
//      a color's lightness up (preserving hue/saturation) only as far as
//      needed to clear a real WCAG contrast ratio against the surface it
//      sits on, and only in dark mode — light mode is untouched.
//   2. Directional bar luminance — a restrained left-to-right brightness
//      sweep on progress-bar fills (barFillGradient), so a fill reads as
//      gently lit rather than a flat block of color, without introducing
//      any new hue or a decorative background wash.
//
// No new color palette is introduced: every output color is a lightness-
// adjusted variant of a color the caller already owns (a system's own
// identity color), never a foreign hue.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const toHex = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v }; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

// WCAG relative luminance.
function relLuminance({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(l1, l2) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

// Typical near-black MedBook dark-mode card surface luminance (lib/theme.js
// DARK.surface '#181b21' and neighbors all sit in this range) — used as the
// reference background a system dot/bar is judged against. Not imported
// directly from theme.js to keep this module pure/dependency-free; the
// value itself IS that surface's own measured luminance.
const DARK_SURFACE_LUMINANCE = 0.012;
const MIN_CONTRAST = 3.5;

// Raises `hex`'s lightness (hue/saturation preserved) only as far as needed
// to clear MIN_CONTRAST against a dark card surface. No-op in light mode or
// for a color that already clears the floor.
export function ensureDarkContrastFloor(hex, isDark) {
  if (!isDark || !hex) return hex;
  const hsl = rgbToHsl(hexToRgb(hex));
  let { l } = hsl;
  let guard = 0;
  while (contrastRatio(relLuminance(hslToRgb({ ...hsl, l })), DARK_SURFACE_LUMINANCE) < MIN_CONTRAST && l < 85 && guard < 40) {
    l += 2;
    guard++;
  }
  return l === hsl.l ? hex : rgbToHex(hslToRgb({ ...hsl, l }));
}

// A restrained left-to-right luminance sweep for a progress-bar fill: ~88%
// richness on the left tip, 100% (the floored, crisp) color on the right
// tip. Returns a CSS `background` value (a two-stop linear-gradient).
export function barFillGradient(hex, isDark) {
  const floored = ensureDarkContrastFloor(hex, isDark);
  const hsl = rgbToHsl(hexToRgb(floored));
  const richer = rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, hsl.l * 0.88) }));
  return `linear-gradient(90deg, ${richer} 0%, ${floored} 100%)`;
}
