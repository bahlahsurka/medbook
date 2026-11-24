// components/visualization/nodeTheme.js
//
// One design system for every graph-type node (Mind Map, Knowledge Network,
// Clinical Flowchart, Mechanism Diagram): typography VARIANTS set hierarchy
// (how prominent a node is) and TONES set meaning (what kind of node it is).
// Layout code sizes nodes from the same variant table GraphNode renders
// with, so the two can never disagree.
import { measureNode } from './nodeMetrics';

// Hierarchy, most to least prominent.
export const NODE_VARIANTS = {
  root:      { fontSize: 15,   weight: 700, lineHeight: 1.3,  padX: 18, padY: 11, minWidth: 132, maxWidth: 260 },
  primary:   { fontSize: 13.5, weight: 700, lineHeight: 1.32, padX: 13, padY: 9,  minWidth: 104, maxWidth: 230 },
  standard:  { fontSize: 12.5, weight: 600, lineHeight: 1.36, padX: 12, padY: 8,  minWidth: 92,  maxWidth: 214 },
  secondary: { fontSize: 12,   weight: 500, lineHeight: 1.38, padX: 11, padY: 7,  minWidth: 84,  maxWidth: 200 },
};

export const SHAPE_INSET = { hexagon: 14 }; // horizontal room the chamfered ends take on each side

const RULE_WIDTH = 3;

/** Layout box for a node: exactly what GraphNode will render. */
export function sizeForNode({ label, variant = 'standard', icon, shape = 'rect' }) {
  const spec = NODE_VARIANTS[variant] || NODE_VARIANTS.standard;
  const iconRoom = icon ? Math.round(spec.fontSize * 1.25 + 5) : 0;
  const ruleRoom = variant === 'root' ? 2 : RULE_WIDTH + 1;
  const shapeRoom = (SHAPE_INSET[shape] || 0) * 2;
  return measureNode(label || '', { ...spec, extraX: iconRoom + ruleRoom + shapeRoom, extraY: 2 });
}

// Translucent dark-mode tints are layered over the solid surface so edges
// passing behind a node never show through it.
const over = (tint, base) => `linear-gradient(${tint}, ${tint}), ${base}`;

/**
 * Colour treatment by meaning. `rule` is the left accent stripe colour
 * (null = none). Root/start nodes are the one solid-fill exception: the
 * diagram's single anchor is meant to dominate.
 */
export function toneStyle(t, tone) {
  switch (tone) {
    case 'root':
      return { background: t.accent, color: '#fff', border: t.accent, rule: null, ring: `${t.accent}66`,
        shadow: `0 6px 18px -6px ${t.accent}99` };
    case 'decision':
      return { background: over(t.navActiveBg, t.surface), color: t.text, border: t.navActiveBorder, rule: null, ring: `${t.accent}55` };
    case 'danger':
      return { background: over(t.dangerBg, t.surface), color: t.danger, border: t.dangerBorder, rule: t.danger, ring: `${t.danger}55` };
    case 'warn':
      return { background: over(t.warnBg, t.surface), color: t.text, border: t.warnBorder, rule: t.warn, ring: `${t.warn}55` };
    case 'ok':
      return { background: over(t.okBg, t.surface), color: t.text, border: t.okBorder, rule: t.ok, ring: `${t.ok}55` };
    case 'accent':
      return { background: t.surface, color: t.text, border: t.borderStrong, rule: t.accent, ring: `${t.accent}55` };
    case 'strong':
      return { background: t.surface2, color: t.text, border: t.borderStrong, rule: t.text3, ring: `${t.accent}55` };
    case 'amber':
      return { background: t.surface, color: t.text2, border: t.border, rule: t.warn, ring: `${t.warn}55` };
    default: // 'neutral'
      return { background: t.surface, color: t.text2, border: t.border, rule: t.borderStrong, ring: `${t.accent}55` };
  }
}

/** Builds the shared `data` payload every graph builder hands to GraphNode. */
export function nodeData(n, { variant, tone, icon, shape = 'rect' }) {
  const size = sizeForNode({ label: n.label, variant, icon, shape });
  return {
    data: {
      label: n.label, variant, tone, icon, shape, width: size.width, height: size.height,
      category: n.category, explanation: n.explanation, sourceType: n.sourceType, sourceRef: n.sourceRef,
    },
    size,
  };
}
