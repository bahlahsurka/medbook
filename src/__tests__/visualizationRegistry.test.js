// The vizType -> {buildPrompt, systemInstruction, schema, schemaName,
// validate, isRealDiagram, extractCoveragePairs} dispatch table api/visualize.mjs
// uses instead of hardcoding one type. Mostly a wiring check — the actual
// prompt/schema/validator content is tested in each type's own test file.
import { VISUALIZATION_REGISTRY, SUPPORTED_VIZ_TYPES, getVisualizationDefinition } from '../services/ai/visualizationRegistry';

const EXPECTED_TYPES = ['mind_map', 'knowledge_network', 'clinical_flowchart', 'mechanism_diagram', 'comparison_map', 'visual_summary'];

describe('visualizationRegistry', () => {
  test('exposes exactly the six Phase 3 types', () => {
    expect(SUPPORTED_VIZ_TYPES.sort()).toEqual([...EXPECTED_TYPES].sort());
  });

  test.each(EXPECTED_TYPES)('%s has a complete, correctly-typed registry entry', (type) => {
    const def = getVisualizationDefinition(type);
    expect(def).toBeTruthy();
    expect(typeof def.buildPrompt).toBe('function');
    expect(typeof def.systemInstruction).toBe('string');
    expect(def.systemInstruction.length).toBeGreaterThan(100);
    expect(typeof def.schema).toBe('object');
    expect(typeof def.schemaName).toBe('string');
    expect(typeof def.validate).toBe('function');
    expect(typeof def.isRealDiagram).toBe('function');
    expect(typeof def.extractCoveragePairs).toBe('function');
  });

  test('getVisualizationDefinition returns null for an unknown type', () => {
    expect(getVisualizationDefinition('not_a_real_type')).toBeNull();
  });

  test('every schema name is unique (never confused with another type in Groq logs)', () => {
    const names = Object.values(VISUALIZATION_REGISTRY).map(d => d.schemaName);
    expect(new Set(names).size).toBe(names.length);
  });

  describe('isRealDiagram — the per-type "claim sentinel vs. real diagram" check', () => {
    test('graph-shaped types ({nodes}) are real only with at least one node', () => {
      const def = getVisualizationDefinition('mind_map');
      expect(def.isRealDiagram({})).toBe(false);
      expect(def.isRealDiagram({ nodes: [] })).toBe(false);
      expect(def.isRealDiagram({ nodes: [{ id: 'x' }] })).toBe(true);
    });

    test('comparison_map is real only with at least one cell (it has no `nodes` array at all)', () => {
      const def = getVisualizationDefinition('comparison_map');
      expect(def.isRealDiagram({})).toBe(false);
      expect(def.isRealDiagram({ cells: [] })).toBe(false);
      expect(def.isRealDiagram({ cells: [{ subjectId: 'a', dimensionId: 'b' }] })).toBe(true);
    });

    test('visual_summary is real only with at least one highlight (it has no `nodes` array at all)', () => {
      const def = getVisualizationDefinition('visual_summary');
      expect(def.isRealDiagram({})).toBe(false);
      expect(def.isRealDiagram({ highlights: [] })).toBe(false);
      expect(def.isRealDiagram({ highlights: [{ id: 'x' }] })).toBe(true);
    });
  });

  describe('extractCoveragePairs — feeds the source-coverage heuristic', () => {
    test('graph-shaped types pull [explanation, sourceRef] from nodes', () => {
      const def = getVisualizationDefinition('clinical_flowchart');
      const pairs = def.extractCoveragePairs({ nodes: [{ explanation: 'exp1', sourceRef: 'ref1' }] });
      expect(pairs).toEqual([['exp1', 'ref1']]);
    });

    test('comparison_map pulls pairs from both subjects and cells', () => {
      const def = getVisualizationDefinition('comparison_map');
      const pairs = def.extractCoveragePairs({
        subjects: [{ label: 'Crohns', sourceRef: 'ref-s' }],
        cells: [{ value: 'Transmural', sourceRef: 'ref-c' }],
      });
      expect(pairs).toEqual([['Crohns', 'ref-s'], ['Transmural', 'ref-c']]);
    });

    test('visual_summary pulls [detail, sourceRef] from highlights', () => {
      const def = getVisualizationDefinition('visual_summary');
      const pairs = def.extractCoveragePairs({ highlights: [{ detail: 'det1', sourceRef: 'ref1' }] });
      expect(pairs).toEqual([['det1', 'ref1']]);
    });
  });
});
