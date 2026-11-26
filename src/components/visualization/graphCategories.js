// components/visualization/graphCategories.js
//
// Client-safe duplicate of each graph type's node-category enum, used ONLY
// to populate the "category" <select> in EditableDiagramDetailPanel.js.
// Deliberately NOT imported from the real source of truth (VisualizationPromptBuilder.js /
// KnowledgeNetworkPromptBuilder.js / ClinicalFlowchartPromptBuilder.js /
// MechanismDiagramPromptBuilder.js) — those are server-only modules whose
// bulk is their multi-paragraph system-instruction prompt strings, and
// importing one into the client bundle just to read a 4-5-item array would
// drag all of that text into the browser for nothing. Four short arrays
// duplicated here is the cheaper, correct trade — same reasoning
// VisualLearningPanel.js already applies to its own small client-side
// `VISUALIZATION_TYPES` metadata table instead of importing the server
// registry.
export const CATEGORY_OPTIONS_BY_TYPE = {
  mind_map: [
    { value: 'branch', label: 'Branch' },
    { value: 'subtopic', label: 'Subtopic' },
    { value: 'red_flag', label: 'Red flag' },
    { value: 'high_yield', label: 'High yield' },
    // 'central_topic' is deliberately excluded — a Mind Map has exactly
    // one, assigned at generation time; re-categorizing a node TO or FROM
    // it is not a "lightweight edit", it's a structural redesign.
  ],
  knowledge_network: [
    { value: 'concept', label: 'Concept' },
    { value: 'red_flag', label: 'Red flag' },
    { value: 'high_yield', label: 'High yield' },
  ],
  clinical_flowchart: [
    { value: 'decision', label: 'Decision' },
    { value: 'action', label: 'Action' },
    { value: 'outcome', label: 'Outcome' },
    { value: 'red_flag', label: 'Red flag' },
    // 'start' is excluded for the same reason as Mind Map's central_topic
    // — exactly one is required, and the validator enforces that.
  ],
  mechanism_diagram: [
    { value: 'cause', label: 'Cause' },
    { value: 'mechanism', label: 'Mechanism' },
    { value: 'manifestation', label: 'Clinical feature' },
    { value: 'consequence', label: 'Consequence' },
    { value: 'red_flag', label: 'Red flag' },
    { value: 'investigation', label: 'Investigation' },
    { value: 'management', label: 'Management' },
  ],
};

/** The category a brand-new node gets by default for this type — the most structurally "safe" one that is never a required/limited category. */
export const DEFAULT_CATEGORY_BY_TYPE = {
  mind_map: 'subtopic',
  knowledge_network: 'concept',
  clinical_flowchart: 'action',
  mechanism_diagram: 'mechanism',
};
