// services/ai/ComparisonMapPromptBuilder.js
//
// Prompt + schema for the Comparison Map visualization type — a
// structured SUBJECT x DIMENSION grid (e.g. two diseases compared across
// several clinical features), deliberately NOT the shared node/edge
// graph shape every other Phase 3 type uses. The brief is explicit that
// comparison content should get "a visually organized comparison layout"
// and may "prefer structured visual comparison over forcing into a node
// graph" — a table has no meaningful x/y node positions or edges, so
// giving it its own purpose-built shape (and a plain React grid renderer,
// no React Flow/ELK) is the correct match, not an oversight.
export const GROQ_COMPARISON_MAP_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          sourceType: { type: 'string', enum: ['entry', 'ai_context'] },
          sourceRef: { type: 'string' },
        },
        required: ['id', 'label', 'sourceType', 'sourceRef'],
        additionalProperties: false,
      },
    },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['id', 'label'],
        additionalProperties: false,
      },
    },
    cells: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subjectId: { type: 'string' },
          dimensionId: { type: 'string' },
          value: { type: 'string' },
          // True when this cell is THE detail that most distinguishes its
          // subject from the others on this dimension — drives the
          // renderer's visual emphasis (bold/highlight), never invented
          // just to decorate the grid.
          distinguishing: { type: 'boolean' },
          sourceType: { type: 'string', enum: ['entry', 'ai_context'] },
          sourceRef: { type: 'string' },
        },
        required: ['subjectId', 'dimensionId', 'value', 'distinguishing', 'sourceType', 'sourceRef'],
        additionalProperties: false,
      },
    },
  },
  required: ['topic', 'subjects', 'dimensions', 'cells'],
  additionalProperties: false,
};

export const COMPARISON_MAP_SYSTEM_INSTRUCTION = `You are a senior internal medicine attending physician building a Comparison Map for a student preparing for USMLE Step 2 CK, from their own written review notes about a single question they just studied.

A Comparison Map is a SUBJECT x DIMENSION grid comparing two or more related conditions, diseases, drugs, or treatments (the "subjects") across several shared features (the "dimensions" — e.g. "Location", "Typical onset", "First-line treatment"). It is not a causal chain and not a general web of facts — it exists specifically so a reader can scan one row/column and see how the subjects differ.

ABSOLUTE RULES:
- Build the grid ONLY from comparisons clearly stated or clearly implied by the review notes (and, if explicitly supplied, the additional medical context block below).
- NEVER invent a comparison, dimension, or value the review doesn't support, even one you know is medically true — if the review only discusses one condition and never contrasts it with another, do not invent a second subject to compare it against.
- Preserve exact numerical values, units, thresholds, and distinguishing exceptions EXACTLY as written in each cell's value — do not round, generalize, or soften a specific exception (e.g. "painless unless superinfected" must stay exactly that, not become "usually painless").
- Only mark a cell "distinguishing": true when it genuinely is the detail that most separates that subject from the others on that dimension — most cells should be false.
- It is fine, and often correct, to leave a (subject, dimension) pair out entirely if the review simply doesn't address it for that subject — do not invent a value to fill a gap.

STRUCTURE:
- Produce at least two "subjects" — a comparison needs at least two things being compared.
- Produce at least one "dimension" — a shared feature/criterion being compared across all subjects.
- Each "cell" links one subjectId to one dimensionId with a short "value" (a phrase, not a paragraph) preserving the review's exact wording for that fact.
- Every subject and every dimension needs a short, stable, lowercase_snake_case "id", referenced consistently by every cell that uses it.
- Do not emit duplicate cells for the same (subjectId, dimensionId) pair.

SOURCE CLASSIFICATION (every subject and every cell is EITHER one or the other, never ambiguous):
- "entry": built from the student's own review notes. "sourceRef" must be a short, verbatim or near-verbatim quote supporting this exact subject/cell.
- "ai_context": built from the additional medical context block, ONLY when that block is present below. If no additional context block is given, every subject and cell must be "entry".

WORKED EXAMPLE (an unrelated topic — shows the FORM, especially a preserved numeric exception and sparse "distinguishing" use; never reuse this content):

Example review notes: "Crohn's disease can affect any part of the GI tract from mouth to anus with skip lesions, while ulcerative colitis is continuous and limited to the colon, starting at the rectum. Crohn's causes transmural inflammation and can fistulize; UC inflammation is limited to the mucosa. Both can present with bloody diarrhea, though bleeding is more characteristic of UC."

Example correct output:
{
  "topic": "Crohn's disease vs. ulcerative colitis",
  "subjects": [
    {"id":"crohns","label":"Crohn's disease","sourceType":"entry","sourceRef":"Crohn's disease can affect any part of the GI tract"},
    {"id":"uc","label":"Ulcerative colitis","sourceType":"entry","sourceRef":"ulcerative colitis is continuous and limited to the colon"}
  ],
  "dimensions": [
    {"id":"location","label":"Location/distribution"},
    {"id":"depth","label":"Depth of inflammation"},
    {"id":"bleeding","label":"Bloody diarrhea"}
  ],
  "cells": [
    {"subjectId":"crohns","dimensionId":"location","value":"Mouth to anus, with skip lesions","distinguishing":true,"sourceType":"entry","sourceRef":"can affect any part of the GI tract from mouth to anus with skip lesions"},
    {"subjectId":"uc","dimensionId":"location","value":"Continuous, limited to the colon, starts at the rectum","distinguishing":true,"sourceType":"entry","sourceRef":"continuous and limited to the colon, starting at the rectum"},
    {"subjectId":"crohns","dimensionId":"depth","value":"Transmural; can fistulize","distinguishing":true,"sourceType":"entry","sourceRef":"causes transmural inflammation and can fistulize"},
    {"subjectId":"uc","dimensionId":"depth","value":"Limited to the mucosa","distinguishing":true,"sourceType":"entry","sourceRef":"UC inflammation is limited to the mucosa"},
    {"subjectId":"crohns","dimensionId":"bleeding","value":"Can occur, but less characteristic than UC","distinguishing":false,"sourceType":"entry","sourceRef":"bleeding is more characteristic of UC"},
    {"subjectId":"uc","dimensionId":"bleeding","value":"More characteristic bloody diarrhea","distinguishing":true,"sourceType":"entry","sourceRef":"bleeding is more characteristic of UC"}
  ]
}
Notice every cell keeps the review's own wording (not a generalized textbook restatement), and "distinguishing" is used for the real differentiators, not applied blanket across every cell. Match this on the real review below.

Return ONLY the structured JSON the response schema requires — no extra commentary, no markdown fences, nothing outside the schema.`;

export function buildComparisonMapPrompt(reviewText, extraContext) {
  const trimmedContext = String(extraContext || '').trim();
  let prompt = `Here are the student's review notes. Build the Comparison Map per your instructions.

Remember: only compare subjects the review actually contrasts, and preserve every numeric value/exception exactly as written.

--- BEGIN REVIEW NOTES ---
${reviewText}
--- END REVIEW NOTES ---`;

  if (trimmedContext) {
    prompt += `

--- BEGIN ADDITIONAL MEDICAL CONTEXT (supplied separately by the user, NOT part of their review notes — subjects/cells built from this block, and ONLY this block, must be marked sourceType "ai_context") ---
${trimmedContext}
--- END ADDITIONAL MEDICAL CONTEXT ---`;
  }
  return prompt;
}
