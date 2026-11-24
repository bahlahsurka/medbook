// Phase 4: how the original AI diagram and the current (possibly edited)
// diagram share the existing graph_data jsonb column — no migration. See
// visualizationStorage.js's own header for the full design.
import { isEnvelope, unwrapGraphData, wrapEdited, wrapRestored, toVisualizationResponseShape } from '../services/ai/visualizationStorage';

const RAW_DIAGRAM = { centralTopic: 'DKA', nodes: [{ id: 'a' }], edges: [] };

describe('unwrapGraphData — backward compatibility', () => {
  test('a legacy/fresh raw diagram (no envelope) is its own original AND current', () => {
    const { original, current, edited, editedAt } = unwrapGraphData(RAW_DIAGRAM);
    expect(original).toBe(RAW_DIAGRAM);
    expect(current).toBe(RAW_DIAGRAM);
    expect(edited).toBe(false);
    expect(editedAt).toBeNull();
  });

  test('the empty claim sentinel ({}) unwraps to itself on both sides, not edited', () => {
    const { original, current, edited } = unwrapGraphData({});
    expect(original).toEqual({});
    expect(current).toEqual({});
    expect(edited).toBe(false);
  });

  test('null/undefined graph_data unwraps safely', () => {
    expect(unwrapGraphData(null)).toEqual({ original: null, current: null, edited: false, editedAt: null });
  });

  test('an envelope unwraps to its own original/current/edited/editedAt', () => {
    const envelope = wrapEdited(RAW_DIAGRAM, { ...RAW_DIAGRAM, centralTopic: 'DKA (edited)' }, 't1');
    const { original, current, edited, editedAt } = unwrapGraphData(envelope);
    expect(original).toBe(RAW_DIAGRAM);
    expect(current.centralTopic).toBe('DKA (edited)');
    expect(edited).toBe(true);
    expect(editedAt).toBe('t1');
  });
});

describe('isEnvelope', () => {
  test('identifies an envelope vs. a raw diagram', () => {
    expect(isEnvelope(wrapEdited(RAW_DIAGRAM, RAW_DIAGRAM, 't0'))).toBe(true);
    expect(isEnvelope(RAW_DIAGRAM)).toBe(false);
    expect(isEnvelope({})).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });
});

describe('wrapEdited / wrapRestored — the true original survives repeated edits', () => {
  test('a second save keeps pointing at the FIRST original, not the previous edit', () => {
    const edit1 = { ...RAW_DIAGRAM, centralTopic: 'edit 1' };
    const envelope1 = wrapEdited(RAW_DIAGRAM, edit1, 't1');
    // A second save reads the original back OUT of envelope1 (as
    // api/visualize-edit.mjs does via unwrapGraphData) rather than being
    // handed RAW_DIAGRAM directly a second time — this is the real
    // invariant under test.
    const { original: stillTheRealOriginal } = unwrapGraphData(envelope1);
    const edit2 = { ...RAW_DIAGRAM, centralTopic: 'edit 2' };
    const envelope2 = wrapEdited(stillTheRealOriginal, edit2, 't2');

    expect(envelope2.original).toBe(RAW_DIAGRAM);
    expect(envelope2.current.centralTopic).toBe('edit 2');
    expect(envelope2.edited).toBe(true);
  });

  test('restoring sets current back to original and clears edited/editedAt, but keeps the envelope shape', () => {
    const envelope = wrapEdited(RAW_DIAGRAM, { ...RAW_DIAGRAM, centralTopic: 'edited' }, 't1');
    const restored = wrapRestored(unwrapGraphData(envelope).original);
    expect(isEnvelope(restored)).toBe(true);
    expect(restored.current).toBe(RAW_DIAGRAM);
    expect(restored.edited).toBe(false);
    expect(restored.editedAt).toBeNull();
  });
});

describe('toVisualizationResponseShape', () => {
  test('exposes graphData as CURRENT, plus originalGraphData/isEdited/editedAt, for a raw (never-edited) row', () => {
    const row = { id: '1', entry_id: 'e1', viz_type: 'mind_map', graph_data: RAW_DIAGRAM, extra_context: null, ai_provider: 'groq', ai_model: 'm', source_content_hash: 'h', created_at: 'c', updated_at: 'u' };
    const shape = toVisualizationResponseShape(row);
    expect(shape.graphData).toBe(RAW_DIAGRAM);
    expect(shape.originalGraphData).toBe(RAW_DIAGRAM);
    expect(shape.isEdited).toBe(false);
    expect(shape.editedAt).toBeNull();
    expect(shape.updatedAt).toBe('u');
  });

  test('exposes graphData as CURRENT (the edited version) for an envelope row, never leaking user_id', () => {
    const edited = { ...RAW_DIAGRAM, centralTopic: 'edited' };
    const row = { id: '1', entry_id: 'e1', user_id: 'someone', viz_type: 'mind_map', graph_data: wrapEdited(RAW_DIAGRAM, edited, 't1'), updated_at: 'u2' };
    const shape = toVisualizationResponseShape(row);
    expect(shape.graphData.centralTopic).toBe('edited');
    expect(shape.originalGraphData).toBe(RAW_DIAGRAM);
    expect(shape.isEdited).toBe(true);
    expect(shape.editedAt).toBe('t1');
    expect(shape.user_id).toBeUndefined();
  });
});
