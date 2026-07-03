import { DIFF_COLOR, SYS_COLOR } from '../lib/constants';
import { useTheme } from '../lib/theme';

export default function EntryCard({ entry, color, onClick, showSystem }) {
  const { t } = useTheme();
  const dc = DIFF_COLOR[entry.difficulty] || t.text3;
  const sc = showSystem ? (SYS_COLOR[entry.system] || color) : color;

  return (
    <div onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = t.surface2}
      onMouseLeave={e => e.currentTarget.style.background = t.surface}
      style={{ background:t.surface, border:`1px solid ${t.border}`,
        borderLeft:`4px solid ${sc}`, borderRadius:8, padding:'13px 16px',
        cursor:'pointer', display:'flex', gap:14, alignItems:'flex-start',
        transition:'background .1s', boxShadow:`0 1px 2px ${t.shadow}`,
        fontFamily:'Inter,sans-serif' }}>

      {entry.images?.length > 0 && (
        <div style={{ width:60, height:44, borderRadius:6, flexShrink:0,
          background:t.surface3, overflow:'hidden', border:`1px solid ${t.border}` }}>
          <img src={entry.images[0]} alt=""
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        </div>
      )}

      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:5 }}>
          <div style={{ fontSize:13.5, fontWeight:600, color:t.text,
            lineHeight:1.4, flex:1 }}>{entry.title}</div>
          {entry.pinned && <span style={{ fontSize:13, flexShrink:0 }}>📌</span>}
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          {showSystem && <Tag label={entry.system} color={sc} />}
          <Tag label={entry.difficulty} color={dc} />
          {entry.review_count > 0 && (
            <span style={{ fontSize:11, color:t.ok, fontWeight:600 }}>✓ ×{entry.review_count}</span>
          )}
        </div>
        {entry.notes && (
          <div style={{ fontSize:12, color:t.text4, marginTop:5,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {entry.notes}
          </div>
        )}
      </div>

      <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
        <span style={{ fontSize:10, color:t.text4 }}>
          {new Date(entry.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
        </span>
        {entry.images?.length > 0 && (
          <span style={{ fontSize:10, color:t.text4 }}>📷 {entry.images.length}</span>
        )}
      </div>
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{ fontSize:11, fontWeight:500, background:`${color}12`, color,
      borderRadius:4, padding:'2px 7px', border:`1px solid ${color}25` }}>{label}</span>
  );
}
