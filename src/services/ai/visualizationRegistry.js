// services/ai/visualizationRegistry.js
//
// The one place that maps a vizType string to everything api/visualize.mjs
// needs to generate/validate/cache it: the prompt builder, system
// instruction, Groq schema + schema name, validator function,
// "is this a real diagram or an empty claim sentinel" check, and (for the
// two non-graph types) a source-coverage pair extractor. Deliberately a
// lookup table, NOT one universal schema or validator — every type below
// keeps its own dedicated prompt/schema/validator file; this module only
// wires them together so api/visualize.mjs can dispatch on vizType instead
// of hardcoding Mind Map the way it did before Phase 3's other five types
// existed. Adding a 7th type later means adding one entry here, nothing
// about this file's shape needs to change.
import { buildMindMapPrompt, MINDMAP_SYSTEM_INSTRUCTION, GROQ_MINDMAP_SCHEMA } from './VisualizationPromptBuilder.js';
import { validateMindMap } from './VisualizationValidator.js';

import {
  buildKnowledgeNetworkPrompt, KNOWLEDGE_NETWORK_SYSTEM_INSTRUCTION, GROQ_KNOWLEDGE_NETWORK_SCHEMA,
} from './KnowledgeNetworkPromptBuilder.js';
import { validateKnowledgeNetwork } from './KnowledgeNetworkValidator.js';

import {
  buildClinicalFlowchartPrompt, CLINICAL_FLOWCHART_SYSTEM_INSTRUCTION, GROQ_CLINICAL_FLOWCHART_SCHEMA,
} from './ClinicalFlowchartPromptBuilder.js';
import { validateClinicalFlowchart } from './ClinicalFlowchartValidator.js';

import {
  buildMechanismDiagramPrompt, MECHANISM_DIAGRAM_SYSTEM_INSTRUCTION, GROQ_MECHANISM_DIAGRAM_SCHEMA,
} from './MechanismDiagramPromptBuilder.js';
import { validateMechanismDiagram } from './MechanismDiagramValidator.js';

import {
  buildComparisonMapPrompt, COMPARISON_MAP_SYSTEM_INSTRUCTION, GROQ_COMPARISON_MAP_SCHEMA,
} from './ComparisonMapPromptBuilder.js';
import { validateComparisonMap } from './ComparisonMapValidator.js';

import {
  buildVisualSummaryPrompt, VISUAL_SUMMARY_SYSTEM_INSTRUCTION, GROQ_VISUAL_SUMMARY_SCHEMA,
} from './VisualSummaryPromptBuilder.js';
import { validateVisualSummary } from './VisualSummaryValidator.js';

// A graph-shaped diagram ({nodes:[...]}) is "real" once it has at least one
// node — the shared check every node/edge type (Mind Map, Knowledge
// Network, Clinical Flowchart, Mechanism Diagram) uses.
function isRealGraphDiagram(graphData) {
  return !!graphData && Array.isArray(graphData.nodes) && graphData.nodes.length > 0;
}

function defaultExtractPairs(diagram) {
  return (diagram?.nodes || []).map(n => [n.explanation, n.sourceRef]);
}

// Comparison Map has no `nodes` array at all — it's real once it has at
// least one subject/dimension/cell (validateComparisonMap already
// guarantees all three are non-empty, so checking one is enough here).
function isRealComparisonMap(graphData) {
  return !!graphData && Array.isArray(graphData.cells) && graphData.cells.length > 0;
}
function comparisonMapExtractPairs(diagram) {
  const subjectPairs = (diagram?.subjects || []).map(s => [s.label, s.sourceRef]);
  const cellPairs = (diagram?.cells || []).map(c => [c.value, c.sourceRef]);
  return [...subjectPairs, ...cellPairs];
}

// Visual Summary has no `nodes` array either — it's real once it has at
// least one highlight.
function isRealVisualSummary(graphData) {
  return !!graphData && Array.isArray(graphData.highlights) && graphData.highlights.length > 0;
}
function visualSummaryExtractPairs(diagram) {
  return (diagram?.highlights || []).map(h => [h.detail, h.sourceRef]);
}

export const VISUALIZATION_REGISTRY = {
  mind_map: {
    schemaName: 'medbook_mind_map',
    buildPrompt: buildMindMapPrompt,
    systemInstruction: MINDMAP_SYSTEM_INSTRUCTION,
    schema: GROQ_MINDMAP_SCHEMA,
    validate: validateMindMap,
    isRealDiagram: isRealGraphDiagram,
    extractCoveragePairs: defaultExtractPairs,
  },
  knowledge_network: {
    schemaName: 'medbook_knowledge_network',
    buildPrompt: buildKnowledgeNetworkPrompt,
    systemInstruction: KNOWLEDGE_NETWORK_SYSTEM_INSTRUCTION,
    schema: GROQ_KNOWLEDGE_NETWORK_SCHEMA,
    validate: validateKnowledgeNetwork,
    isRealDiagram: isRealGraphDiagram,
    extractCoveragePairs: defaultExtractPairs,
  },
  clinical_flowchart: {
    schemaName: 'medbook_clinical_flowchart',
    buildPrompt: buildClinicalFlowchartPrompt,
    systemInstruction: CLINICAL_FLOWCHART_SYSTEM_INSTRUCTION,
    schema: GROQ_CLINICAL_FLOWCHART_SCHEMA,
    validate: validateClinicalFlowchart,
    isRealDiagram: isRealGraphDiagram,
    extractCoveragePairs: defaultExtractPairs,
  },
  mechanism_diagram: {
    schemaName: 'medbook_mechanism_diagram',
    buildPrompt: buildMechanismDiagramPrompt,
    systemInstruction: MECHANISM_DIAGRAM_SYSTEM_INSTRUCTION,
    schema: GROQ_MECHANISM_DIAGRAM_SCHEMA,
    validate: validateMechanismDiagram,
    isRealDiagram: isRealGraphDiagram,
    extractCoveragePairs: defaultExtractPairs,
  },
  comparison_map: {
    schemaName: 'medbook_comparison_map',
    buildPrompt: buildComparisonMapPrompt,
    systemInstruction: COMPARISON_MAP_SYSTEM_INSTRUCTION,
    schema: GROQ_COMPARISON_MAP_SCHEMA,
    validate: validateComparisonMap,
    isRealDiagram: isRealComparisonMap,
    extractCoveragePairs: comparisonMapExtractPairs,
  },
  visual_summary: {
    schemaName: 'medbook_visual_summary',
    buildPrompt: buildVisualSummaryPrompt,
    systemInstruction: VISUAL_SUMMARY_SYSTEM_INSTRUCTION,
    schema: GROQ_VISUAL_SUMMARY_SCHEMA,
    validate: validateVisualSummary,
    isRealDiagram: isRealVisualSummary,
    extractCoveragePairs: visualSummaryExtractPairs,
  },
};

export const SUPPORTED_VIZ_TYPES = Object.keys(VISUALIZATION_REGISTRY);

export function getVisualizationDefinition(vizType) {
  return VISUALIZATION_REGISTRY[vizType] || null;
}
