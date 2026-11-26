// services/ai/diagramQuality.js
//
// Post-validation quality layer for the four graph-shaped visualization
// types (mind map, knowledge network, clinical flowchart, mechanism
// diagram). Two parts:
//
// normalizeGraphDiagram() — safe, mechanical REPAIRS applied to a freshly
//   generated diagram before it is saved (never to saved or user-edited
//   data): readable labels, duplicate concepts merged, repeated links
//   dropped, hedges/qualifiers the model dropped restored from the node's
//   own verbatim source quote, and impossible categories corrected.
//
// checkDiagramQuality() — WARNINGS for a human to double-check, computed
//   against the current notes on every response: nodes whose quote isn't
//   found in the notes, links whose two concepts are never mentioned
//   together, details that may have been lost.
//
// Both are heuristics. Neither can establish medical accuracy — they only
// catch shape and wording problems that are visible programmatically.
import { humanizeLabel, conceptKey, isMachineLabel } from './diagramLabels.js';

const GRAPH_TYPES = new Set(['mind_map', 'knowledge_network', 'clinical_flowchart', 'mechanism_diagram']);
export const isGraphVizType = (t) => GRAPH_TYPES.has(t);

const HEDGE_RE = /\b(can|could|may|might|potentially|possibly|probably|likely|rarely|sometimes|occasionally|proposed|thought to|suspected|if)\b/i;
const QUALIFIER_RE = /\b\d+(?:\.\d+)?\s*(?:%|mg|mcg|g|kg|mmol|meq|mmhg|ml|l|hours?|hrs?|days?|weeks?|months?|years?|min(?:utes?)?)?\b|\b(?:i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,2})\b(?=[\s,]|$)|\b(?:can|could|may|might|potentially|possibly|proposed|thought to|rarely|sometimes)\b/gi;
const STOP = new Set(('the a an and or of to in into on for with is are was were be been this that it as by at from has have had ' +
  'not but if than then their its also can will such these those which who whom within through after before during may might ' +
  'could should would there here more most less very some any each both all patient patients').split(' '));

// Hedged forms of common relationship verbs (restored when the source quote is hedged).
const HEDGED = {
  causes: 'can_cause', cause: 'can_cause', leads_to: 'can_lead_to', results_in: 'can_result_in', progresses_to: 'can_progress_to',
  extends_into: 'can_extend_into', extends_to: 'can_extend_to', spreads_to: 'can_spread_to', spreads_through: 'can_spread_through',
  spreads_into: 'can_spread_into', triggers: 'can_trigger', precipitates: 'can_precipitate', produces: 'can_produce',
  transmits_to: 'can_transmit_to', complicates: 'can_complicate',
};
const isHedgedRel = (r) => /^(can|could|may|might|possibly|potentially)[_\s]/i.test(r) || /possibl|potential/i.test(r);

const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const stem = (w) => w.slice(0, 6);
const contentStems = (s) => [...new Set(words(s).filter(w => w.length > 2 && !STOP.has(w)).map(stem))];
const qualifiersOf = (s) => [...new Set((String(s || '').match(QUALIFIER_RE) || []).map(q => q.trim().toLowerCase()))];
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function quoteAsSentence(ref) {
  const t = String(ref || '').trim().replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+/, '');
  if (!t) return t;
  return capFirst(/[.!?)]$/.test(t) ? t : `${t}.`);
}

/**
 * Mechanical repairs for a just-generated graph diagram. Returns a new
 * object; the input is not modified.
 * @param {{topic?:string, nodes:Array, edges:Array}} diagram
 * @param {string} vizType
 * @param {{notes?:string}} [options] — the review notes, to read the words
 *   just before a node's quote (e.g. "potentially resulting in <quote>").
 */
export function normalizeGraphDiagram(diagram, vizType, { notes } = {}) {
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges) || !isGraphVizType(vizType)) return diagram;

  // 1. Readable labels; restore qualifiers (hedges, numbers, cranial-nerve
  //    numerals) the explanation dropped, from the node's own verbatim quote.
  let nodes = diagram.nodes.map(n => {
    const label = humanizeLabel(n.label, { sourceRef: n.sourceRef });
    let explanation = n.explanation;
    if (n.sourceRef && n.sourceType !== 'user_added') {
      const have = `${label} ${explanation || ''}`.toLowerCase();
      const missing = qualifiersOf(n.sourceRef).filter(q => !have.includes(q));
      if (missing.length || !String(explanation || '').trim() || isMachineLabel(explanation)) explanation = quoteAsSentence(n.sourceRef);
    }
    return { ...n, label, explanation };
  });

  let edges = diagram.edges.map(e => ({ ...e }));

  // 2. Merge duplicate concepts (same label once case/punctuation/articles
  //    are ignored) — not for mind maps (a tree) or flowcharts (the same
  //    action can legitimately appear on different branches).
  if (vizType === 'knowledge_network' || vizType === 'mechanism_diagram') {
    const keep = new Map(); const alias = new Map();
    for (const n of nodes) {
      const k = conceptKey(n.label);
      if (k && keep.has(k)) alias.set(n.id, keep.get(k));
      else keep.set(k, n.id);
    }
    if (alias.size) {
      nodes = nodes.filter(n => !alias.has(n.id));
      edges = edges.map(e => ({ ...e, source: alias.get(e.source) || e.source, target: alias.get(e.target) || e.target }))
        .filter(e => e.source !== e.target);
    }
  }

  // 3. One link per ordered pair of nodes.
  if (vizType !== 'clinical_flowchart') {
    const seen = new Set();
    edges = edges.filter(e => { const k = `${e.source}\u0000${e.target}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // 4. Mechanism diagram: a "cause" with something before it isn't a root
  //    cause; and a causal link into a hedged finding keeps the hedge.
  if (vizType === 'mechanism_diagram' || vizType === 'knowledge_network') {
    const byId = new Map(nodes.map(n => [n.id, n]));
    edges = edges.map(e => {
      const rel = String(e.relationship || '').trim().toLowerCase().replace(/\s+/g, '_');
      const target = byId.get(e.target);
      if (!target?.sourceRef || isHedgedRel(rel) || HEDGE_RE.test(e.label || '')) return e;
      const hedged = /\b(can|could|may|might|potentially|possibly)\b/i.test(target.sourceRef) || hedgedBefore(notes, target.sourceRef);
      if (hedged && HEDGED[rel]) return { ...e, relationship: HEDGED[rel] };
      return e;
    });
    if (vizType === 'mechanism_diagram') {
      const hasIncoming = new Set(edges.map(e => e.target));
      const roots = nodes.filter(n => !hasIncoming.has(n.id));
      nodes = nodes.map(n => (n.category === 'cause' && hasIncoming.has(n.id) && roots.some(r => r.category === 'cause')
        ? { ...n, category: 'mechanism' } : n));
    }
  }

  return { ...diagram, nodes, edges };
}

// Is the quote introduced by a hedge in the notes ("…potentially resulting in <quote>")?
function hedgedBefore(notes, quote) {
  const n = String(notes || '').replace(/\*\*|\{\{\/?[a-z]+\}\}/gi, '');
  const q = String(quote || '').trim();
  if (!n || q.length < 4) return false;
  const at = n.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return false;
  let before = n.slice(Math.max(0, at - 80), at);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n'));
  if (cut >= 0) before = before.slice(cut + 1);
  return /\b(can|could|may|might|potentially|possibly)\b/i.test(before);
}

function sentencesOf(notes) {
  return String(notes || '')
    .replace(/\{\{\/?[a-z]+\}\}/gi, ' ').replace(/\*\*/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim()).filter(Boolean);
}

/**
 * Warnings (plain sentences) for a graph diagram checked against the
 * current notes. Empty when nothing looks off. Capped to keep it readable.
 */
export function checkDiagramQuality(notes, diagram, vizType, { max = 8 } = {}) {
  if (!isGraphVizType(vizType) || !diagram || !Array.isArray(diagram.nodes)) return [];
  const warnings = [];
  const noteStems = new Set(contentStems(notes));
  const sentences = sentencesOf(notes).map(s => new Set(contentStems(s)));
  const lowerNotes = String(notes || '').toLowerCase();
  const nodes = diagram.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const name = (n) => humanizeLabel(n.label, { sourceRef: n.sourceRef });

  // Machine-style labels / duplicates (saved diagrams aren't rewritten).
  const keys = new Map();
  for (const n of nodes) {
    const k = conceptKey(name(n));
    if (keys.has(k)) warnings.push(`"${name(n)}" appears more than once.`);
    keys.set(k, true);
  }

  for (const n of nodes) {
    if (n.sourceType !== 'entry' || !n.sourceRef) continue;
    const ref = contentStems(n.sourceRef);
    if (ref.length >= 2) {
      const found = ref.filter(w => noteStems.has(w)).length / ref.length;
      if (found < 0.6) warnings.push(`"${name(n)}" — its supporting quote wasn't found in your notes.`);
    }
    const have = `${n.label} ${n.explanation || ''}`.toLowerCase();
    const lost = qualifiersOf(n.sourceRef).filter(q => !have.includes(q) && lowerNotes.includes(q));
    if (lost.length) warnings.push(`"${name(n)}" may have lost a detail from your notes (${lost.slice(0, 3).map(q => `"${q}"`).join(', ')}).`);
  }

  // A link whose two concepts never appear together in one sentence of the
  // notes may not be stated by them.
  if (vizType !== 'mind_map') {
    for (const e of diagram.edges || []) {
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b || a.sourceType !== 'entry' || b.sourceType !== 'entry') continue;
      const sa = contentStems(`${a.label} ${a.sourceRef || ''}`), sb = contentStems(`${b.label} ${b.sourceRef || ''}`);
      const together = sentences.some(S => sa.some(w => S.has(w)) && sb.some(w => S.has(w)));
      const adjacent = sentences.some((S, i) => {
        const T = sentences[i + 1];
        return T && ((sa.some(w => S.has(w)) && sb.some(w => T.has(w))) || (sb.some(w => S.has(w)) && sa.some(w => T.has(w))));
      });
      if (!together && !adjacent) warnings.push(`The link "${name(a)}" → "${name(b)}" isn't stated together in your notes.`);
    }
  }

  return [...new Set(warnings)].slice(0, max);
}
