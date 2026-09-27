import React from 'react';
import { SYS_COLOR } from '../lib/constants';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';

function EntryCard({ entry, color, onClick, showSystem }) {
  const { t } = useTheme();
  const sc = showSystem ? (SYS_COLOR[entry.system] || color) : color;
  const isDue = entry.next_review && new Date(entry.next_review) <= new Date();

  return (
    <div onClick={onClick} className="mb-entrycard"
      style={{ position:'relative', background:t.surface, border:`1px solid ${t.border}`,
        borderRadius:RADIUS.xl, padding:`${SPACE.md+2}px ${SPACE.lg}px ${SPACE.md+2}px ${SPACE.xl2}px`,
        cursor:'pointer', display:'flex', gap:SPACE.md+2, alignItems:'flex-start',
        transition:`transform ${MOTION.fast} ${MOTION.ease}, box-shadow ${MOTION.fast} ${MOTION.ease}, filter ${MOTION.fast} ${MOTION.ease}`,
        boxShadow:elevation(t,'sm') }}>

      {/* A refined inset accent rather than a full-height straight border —
          a short rounded pill, roughly centred, reads as a quiet marker
          instead of a hard rule down the card's whole edge. */}
      <span aria-hidden="true" style={{ position:'absolute', left:10, top:'22%', bottom:'22%',
        width:4, borderRadius:RADIUS.pill, background:sc }} />

      {/* No placeholder when an entry has no photo — the thumbnail slot is
          omitted entirely and the text column simply takes the extra
          width, rather than every row reserving space for an image that
          may not exist. */}
      {entry.images?.length > 0 && (
        <div style={{ width:96, height:64, borderRadius:RADIUS.lg, flexShrink:0,
          background:t.surface3, overflow:'hidden', border:`1px solid ${t.border}` }}>
          <img src={entry.images[0]} alt="" loading="lazy" decoding="async"
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        </div>
      )}

      <div style={{ flex:1, minWidth:0 }}>
        {/* Title is the thing being scanned for during a study session —
            bumped a step up the type scale and given the most contrast on
            the card, everything else here is deliberately quieter. */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:5 }}>
          <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.medium, color:t.text,
            lineHeight:FONT.leading.tight, flex:1 }}>{entry.title}</div>
          {entry.pinned && <span style={{ fontSize:FONT.size.sm, flexShrink:0 }}>📌</span>}
        </div>

        {/* Difficulty is deliberately not shown here — it's still a real,
            editable field (see DetailView's edit mode), just not surfaced
            as a badge on the card itself. The system tag stays a pill
            since (in cross-system contexts like Global Search) it's the
            more load-bearing piece of identifying info. */}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          {showSystem && <Tag label={entry.system} color={sc} />}
          {isDue && (
            <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold, color:t.accent,
              background:t.navActiveBg, borderRadius:RADIUS.pill, padding:'1px 6px' }}>Due</span>
          )}
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
