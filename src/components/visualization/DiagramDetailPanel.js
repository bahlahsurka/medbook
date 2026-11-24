// components/visualization/DiagramDetailPanel.js
//
// Read-only detail for a selected node/cell/highlight, shared by all six
// renderers: title, a category tag, the explanation, the node's links
// (graph types), and where it came from. Keeps the title clearly distinct
// from the supporting explanation.
import { useTheme, SPACE, RADIUS, FONT } from '../../lib/theme';

const CATEGORY_LABEL = {
  central_topic: 'Central topic', branch: 'Branch', subtopic: 'Subtopic', red_flag: 'Red flag', high_yield: 'High yield',
  concept: 'Concept', start: 'Start', decision: 'Decision', action: 'Action', outcome: 'Outcome',
  cause: 'Cause', mechanism: 'Mechanism', consequence: 'Consequence',
  key_fact: 'Key fact', number: 'Number', pearl: 'Pearl',
};

function tagColors(t, category) {
  if (category === 'red_flag') return { bg: t.dangerBg, fg: t.danger, border: t.dangerBorder };
  if (category === 'high_yield' || category === 'number') return { bg: t.warnBg, fg: t.warn, border: t.warnBorder };
  if (category === 'outcome' || category === 'pearl') return { bg: t.okBg, fg: t.ok, border: t.okBorder };
  return { bg: t.surface2, fg: t.text3, border: t.border };
}

/**
 * @param {{label,explanation,category?,sourceType,sourceRef,connections?:{out:Array,inc:Array},extra?:React.ReactNode}} node
 */
export default function DiagramDetailPanel({ node, onClose }) {
  const { t } = useTheme();
  if (!node) return null;
  const tag = node.category && CATEGORY_LABEL[node.category];
  const tc = tagColors(t, node.category);
  const links = node.connections ? [...node.connections.out.map(c => ({ ...c, dir: '→' })), ...node.connections.inc.map(c => ({ ...c, dir: '←' }))] : [];

  return (
    <div className="mb-viz-pop" style={{
      position: 'absolute', top: SPACE.md, right: SPACE.md, zIndex: 6,
      width: 288, maxWidth: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)',
      overflowY: 'auto', background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: RADIUS.lg, padding: SPACE.md, boxShadow: `0 10px 28px -8px ${t.shadowStrong}`,
      fontFamily: 'Inter,sans-serif', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: FONT.size.base, fontWeight: FONT.weight.bold, color: t.text, lineHeight: 1.35 }}>{node.label}</div>
        <button onClick={onClose} aria-label="Close" className="mb-viz-btn"
          style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer', fontSize: FONT.size.md, lineHeight: 1,
            width: 28, height: 28, borderRadius: RADIUS.sm, flexShrink: 0, margin: '-4px -6px 0 0' }}>
          ✕
        </button>
      </div>
      {tag && (
        <span style={{ display: 'inline-block', fontSize: FONT.size.micro, fontWeight: FONT.weight.semibold, letterSpacing: .3,
          color: tc.fg, background: tc.bg, border: `1px solid ${tc.border}`, borderRadius: RADIUS.sm, padding: '1px 6px', marginBottom: 8 }}>
          {tag}
        </span>
      )}
      {node.explanation && (
        <div style={{ fontSize: FONT.size.sm, color: t.text2, lineHeight: 1.6, marginBottom: 10 }}>{node.explanation}</div>
      )}
      {node.extra}
      {links.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: FONT.size.micro, color: t.text4, fontWeight: FONT.weight.semibold, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 4 }}>
            Links
          </div>
          {links.slice(0, 8).map((l, i) => (
            <div key={i} style={{ fontSize: FONT.size.xs, color: t.text2, lineHeight: 1.5, display: 'flex', gap: 6 }}>
              <span style={{ color: t.text4, flexShrink: 0 }}>{l.dir}</span>
              <span><span style={{ color: t.text3 }}>{l.rel}</span> {l.other}</span>
            </div>
          ))}
          {links.length > 8 && <div style={{ fontSize: FONT.size.micro, color: t.text4 }}>+{links.length - 8} more</div>}
        </div>
      )}
      <div style={{ fontSize: FONT.size.micro, color: t.text4, borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
        {node.sourceType === 'ai_context' ? 'From supplementary context, not the entry itself'
          : node.sourceType === 'user_added' ? 'Added by you during editing'
          : 'From the entry'}
        {node.sourceRef && (
          <div style={{ marginTop: 4, fontStyle: 'italic', color: t.text3, lineHeight: 1.5 }}>"{node.sourceRef}"</div>
        )}
      </div>
    </div>
  );
}
