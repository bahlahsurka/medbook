// Client-side readers for the Phase 5 Key Points payload stored at
// entries.ai_sections.keyPoints. Read-only: nothing here generates or writes.

const EMPHASIS = new Set(['red_flag', 'high_yield', 'normal']);

/**
 * Returns the saved Key Points in a render-safe shape, or null when the entry
 * has none (legacy-only rows, never-analyzed rows, or a malformed payload).
 * Malformed sections/bullets are dropped rather than crashing a review.
 */
export function getSavedKeyPoints(aiSections) {
  const saved = aiSections && typeof aiSections === 'object' ? aiSections.keyPoints : null;
  const content = saved && typeof saved === 'object' ? saved.content : null;
  if (!content || !Array.isArray(content.sections)) return null;

  const sections = content.sections
    .map(s => ({
      heading: typeof s?.heading === 'string' ? s.heading.trim() : '',
      bullets: (Array.isArray(s?.bullets) ? s.bullets : [])
        .filter(b => typeof b?.text === 'string' && b.text.trim())
        .map(b => ({ text: b.text.trim(), emphasis: EMPHASIS.has(b.emphasis) ? b.emphasis : 'normal' })),
    }))
    .filter(s => s.bullets.length > 0);
  if (sections.length === 0) return null;

  return {
    topic: typeof content.topic === 'string' ? content.topic : '',
    sections,
    fidelityWarnings: Array.isArray(saved.fidelityWarnings) ? saved.fidelityWarnings.filter(w => typeof w === 'string') : [],
    fidelityDisclaimer: typeof saved.fidelityDisclaimer === 'string' ? saved.fidelityDisclaimer : '',
    generatedAt: saved.generatedAt || null,
    model: saved.model || null,
    sourceNotesLength: typeof saved.sourceNotesLength === 'number' ? saved.sourceNotesLength : null,
  };
}

/** Same approximate staleness signal DetailView uses: notes length changed since generation. */
export function isKeyPointsStale(saved, notes) {
  return !!saved && typeof saved.sourceNotesLength === 'number' && saved.sourceNotesLength !== (notes || '').length;
}

/**
 * Splits a leading "Term: explanation" label off a bullet so the term can be
 * bolded. Only short labels qualify (≤ 6 words, ≤ 48 chars, no sentence
 * punctuation) so an ordinary sentence containing a colon is left alone.
 */
export function splitLeadTerm(text) {
  if (typeof text !== 'string') return { lead: '', rest: text || '' };
  const i = text.indexOf(': ');
  if (i < 2 || i > 48) return { lead: '', rest: text };
  const lead = text.slice(0, i);
  if (/[.;!?]/.test(lead) || lead.split(/\s+/).length > 6) return { lead: '', rest: text };
  return { lead, rest: text.slice(i + 2) };
}
