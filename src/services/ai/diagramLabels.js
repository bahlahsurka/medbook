// services/ai/diagramLabels.js
//
// Human-readable text for diagram nodes and relationships. Shared by the
// server (normalizing freshly generated diagrams before they're saved) and
// the client (normalizing saved diagrams at DISPLAY time only — stored data
// is never rewritten). Pure; no imports, so both bundles can use it.
//
// The model sometimes copies a node's snake_case id into its label
// ("penetrating_trauma_to_posterior_pharynx"). Where the node's own
// verbatim quote from the notes (sourceRef) contains the same words in
// order, the quote's exact wording is used ("Penetrating trauma to the
// posterior pharynx"); otherwise underscores become spaces, with sentence
// case and standard medical capitalization.

const MACHINE_RE = /^[A-Za-z0-9]+(?:[_.-]+[A-Za-z0-9]+)*$/;

/** A label that looks like an internal id: no spaces and joined by "_" (e.g. "neck_stiffness"). */
export function isMachineLabel(s) {
  const t = String(s || '').trim();
  return !!t && !/\s/.test(t) && t.includes('_') && MACHINE_RE.test(t);
}

// Lower-case tokens that are written upper-case in medicine.
const ACRONYMS = new Set([
  'ecg', 'ekg', 'eeg', 'emg', 'ct', 'cta', 'mri', 'mra', 'pet', 'cxr', 'us', 'iv', 'im', 'po', 'sc', 'icu', 'ed', 'er',
  'cns', 'pns', 'csf', 'cn', 'ijv', 'ivc', 'svc', 'dvt', 'pe', 'mi', 'nstemi', 'stemi', 'acs', 'tia', 'cva', 'ards', 'copd',
  'dka', 'hhs', 'uti', 'hiv', 'aids', 'hbv', 'hcv', 'hpv', 'ebv', 'cmv', 'hsv', 'vzv', 'tb', 'mrsa', 'gi', 'gu', 'ent',
  'bp', 'hr', 'rr', 'gcs', 'abg', 'vbg', 'cbc', 'bmp', 'cmp', 'lft', 'lfts', 'inr', 'aptt', 'ptt', 'esr', 'crp', 'tsh',
  'acth', 'adh', 'siadh', 'gfr', 'egfr', 'aki', 'ckd', 'nsaid', 'nsaids', 'ssri', 'ssris', 'snri', 'maoi', 'ace', 'arb',
  'dic', 'ttp', 'hus', 'itp', 'sle', 'ra', 'ibd', 'gerd', 'pcos', 'bph', 'std', 'sti', 'pid', 'ivf', 'icp', 'ldl', 'hdl',
  'dna', 'rna', 'atp', 'ana', 'anca', 'hla', 'rbc', 'wbc', 'ap', 'pa', 'av', 'sa', 'avm', 'nmda',
  'gaba', 'cpr', 'acls', 'ett', 'ng', 'npo', 'prn', 'otc', 'cad', 'chf', 'hf', 'afib', 'svt', 'vt', 'vf',
]);
const MIXED_CASE = { ph: 'pH', ach: 'ACh', achr: 'AChR', mrna: 'mRNA', igg: 'IgG', igm: 'IgM', iga: 'IgA', ige: 'IgE', spo2: 'SpO2', pao2: 'PaO2', paco2: 'PaCO2', fio2: 'FiO2', hba1c: 'HbA1c' };
const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/;
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'into', 'on', 'with', 'and', 'or', 'for', 'by', 'at', 'from', 'its', 'their']);
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

function fixToken(tok, prev) {
  const low = tok.toLowerCase();
  if (ROMAN.test(low) && prev && /^(nerves?|cn|cranial)$/i.test(prev)) return low.toUpperCase();
  if (MIXED_CASE[low]) return MIXED_CASE[low];
  if (ACRONYMS.has(low)) return low.toUpperCase();
  return tok;
}

/**
 * Finds the words of `words` (in order) inside `text`, allowing only short
 * connecting words (the/of/to/…) between them. Returns the matching span of
 * `text` verbatim, or null.
 */
function findSpan(words, text) {
  if (!text || !words.length) return null;
  const toks = [];
  const re = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
  let m;
  while ((m = re.exec(text))) toks.push({ w: norm(m[0]), start: m.index, end: m.index + m[0].length });
  const target = words.map(norm).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].w !== target[0]) continue;
    let j = i, k = 1;
    while (k < target.length) {
      j++;
      if (j >= toks.length) break;
      if (toks[j].w === target[k]) { k++; continue; }
      if (STOP.has(toks[j].w)) continue;
      break;
    }
    if (k === target.length) return text.slice(toks[i].start, toks[j].end);
  }
  return null;
}

const capFirst = (s) => (s && /^[a-z]/.test(s) && !/^[a-z]+[A-Z0-9]/.test(s.split(/\s/)[0]) ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Display text for a node label. Natural-language labels are returned as
 * written (trimmed, first letter capitalized); machine-style ids are turned
 * into readable text, preferring the exact wording of `sourceRef`.
 */
export function humanizeLabel(label, { sourceRef } = {}) {
  const raw = String(label ?? '').trim();
  if (!raw) return raw;
  if (!isMachineLabel(raw)) return capFirst(raw.replace(/\s+/g, ' '));
  const words = raw.split(/[_.]+/).filter(Boolean);
  const span = findSpan(words, sourceRef);
  if (span && span.length <= 90) return capFirst(span.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)\]]+$/g, ''));
  const out = [];
  words.forEach((w, i) => out.push(fixToken(w, i ? words[i - 1] : undefined)));
  const joined = capFirst(out.join(' '));
  // A short quote carrying specifics the id dropped (numbers, cranial-nerve
  // numerals, …) is the better label: "Deficits in cranial nerves IX, X, XI, and XII".
  const ref = String(sourceRef || '').trim().replace(/\s+/g, ' ').replace(/[.;:,]+$/, '');
  if (ref && ref.length <= 64) {
    const specifics = (ref.match(/\b(\d+(?:\.\d+)?|[IVX]{1,4})\b/g) || []).filter(x => !joined.includes(x));
    const overlap = words.filter(w => ref.toLowerCase().includes(w.toLowerCase())).length;
    if (specifics.length && overlap >= Math.ceil(words.length / 2)) return capFirst(ref);
  }
  return joined;
}

/** Display text for an edge relationship ("extends_into" -> "extends into"). */
export function humanizeRelationship(r) {
  return String(r || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Comparison key for "the same concept" (case/punctuation/article-insensitive). */
export function conceptKey(label) {
  return String(label || '').toLowerCase()
    .replace(/[_\-–—/]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/).filter(w => w && !['the', 'a', 'an'].includes(w))
    .join(' ');
}
