import React from 'react';
import { DIFF_COLOR, SYS_COLOR } from '../lib/constants';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';

function EntryCard({ entry, color, onClick, showSystem }) {
  const { t } = useTheme();
  const dc = DIFF_COLOR[entry.difficulty] || t.text3;
  const sc = showSystem ? (SYS_COLOR[entry.system] || color) : color;

  return (
    <div onClick={onClick} className="mb-entrycard"
      style={{ background:t.surface, border:`1px solid ${t.border}`,
        borderLeft:`4px solid ${sc}`, borderRadius:RADIUS.md, padding:`${SPACE.md+1}px ${SPACE.lg}px`,
        cursor:'pointer', display:'flex', gap:SPACE.md+2, alignItems:'flex-start',
        transition:`transform ${MOTION.fast} ${MOTION.ease}, box-shadow ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}`,
        boxShadow:elevation(t,'sm') }}>

      {entry.images?.length > 0 && (
        <div style={{ width:60, height:44, borderRadius:RADIUS.sm, flexShrink:0,
          background:t.surface3, overflow:'hidden', border:`1px solid ${t.border}` }}>
          <img src={entry.images[0]} alt="" loading="lazy" decoding="async"
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        </div>
      )}

      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:5 }}>
          <div style={{ fontSize:FONT.size.base+0.5, fontWeight:FONT.weight.semibold, color:t.text,
            lineHeight:FONT.leading.normal, flex:1 }}>{entry.title}</div>
          {entry.pinned && <span style={{ fontSize:FONT.size.base, flexShrink:0 }}>📌</span>}
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          {showSystem && <Tag label={entry.system} color={sc} />}
          <Tag label={entry.difficulty} color={dc} />
          {entry.review_count > 0 && (
            <span style={{ fontSize:FONT.size.xs, color:t.ok, fontWeight:FONT.weight.semibold }}>✓ ×{entry.review_count}</span>
          )}
        </div>
        {entry.notes && (
          <div style={{ fontSize:FONT.size.sm, color:t.text4, marginTop:5,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {entry.notes}
          </div>
        )}
      </div>

      <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
        <span style={{ fontSize:FONT.size.micro, color:t.text4 }}>
          {new Date(entry.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
        </span>
        {entry.images?.length > 0 && (
          <span style={{ fontSize:FONT.size.micro, color:t.text4 }}>📷 {entry.images.length}</span>
        )}
      </div>
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.medium, background:`${color}12`, color,
      borderRadius:RADIUS.sm-2, padding:'2px 7px', border:`1px solid ${color}25` }}>{label}</span>
  );
}

// Memoised: with ~250+ cards, this stops every card re-rendering on each
// keystroke/selection. Parent must pass stable props (see App.js).
//
// Hover/press feedback (.mb-entrycard) lives once in index.html's global
// stylesheet rather than a <style> tag here — with hundreds of these on
// screen at once, per-instance <style> tags would mean hundreds of
// identical nodes instead of one shared rule.
export default React.memo(EntryCard);
