// services/ai/index.js
//
// The ONLY surface UI components are allowed to touch.
// Components call AIService.analyzeReview(review) and nothing else.
// Swapping provider, model, or moving the key server-side never reaches the UI.

import { generate, isConfigured, activeModel, GeminiError } from './GeminiService';
import { buildAnalysisPrompt, buildSectionPrompt } from './PromptBuilder';
import { parseAnalysis, isAllEmpty, normalizeSections, emptySections, ParseError } from './ResponseParser';

export { GeminiError, ParseError, isAllEmpty, normalizeSections, emptySections };

const AIService = {
  /** Is the key present? UI uses this to hide/disable the Analyze buttons. */
  isConfigured,

  /** Which model is in use (shown in the UI footer for transparency). */
  activeModel,

  /**
   * Analyse a review and return the six sections.
   * ONLY the review text is sent — never the question, images, or metadata.
   *
   * Throws GeminiError (transport/quota/config) or ParseError (bad output).
   * Callers must treat a throw as "change nothing".
   */
  async analyzeReview(reviewText, opts = {}) {
    const text = String(reviewText || '').trim();
    if (!text) {
      throw new ParseError('There is nothing in the Review to analyse yet.');
    }
    if (text.length < 40) {
      throw new ParseError('The Review is too short to analyse meaningfully. Write a bit more first.');
    }
    const raw = await generate(buildAnalysisPrompt(text), opts);
    return parseAnalysis(raw);
  },

  /**
   * Future expansion (spec): regenerate ONE section without redoing everything.
   * Wired here so adding it to the UI later needs no architectural change.
   */
  async analyzeSection(reviewText, sectionKey, opts = {}) {
    const text = String(reviewText || '').trim();
    if (!text) throw new ParseError('There is nothing in the Review to analyse yet.');
    const raw = await generate(buildSectionPrompt(text, sectionKey), opts);
    const parsed = parseAnalysis(raw);
    return { [sectionKey]: parsed[sectionKey] || [] };
  },

  // Planned, per spec's Future Expansion — each becomes a method here:
  //   generateQuestions(reviewText)
  //   generateClinicalCase(reviewText)
  //   generateMnemonics(reviewText)
  //   generateDifferential(reviewText)
};

export default AIService;
