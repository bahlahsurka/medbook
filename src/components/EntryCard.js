import { DIFF_COLOR, SYS_COLOR } from '../lib/constants';

export default function EntryCard({ entry, color, onClick, showSystem }) {
  const dc = DIFF_COLOR[entry.difficulty] || '#6b7280';
  const sc = showSystem ? (SYS_COLOR[entry.system] || color) : color;

  return (
    <div onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background='#f9fafb'}
      onMouseLeave={e => e.currentTarget.style.background='#fff'}
      style={{ background:'#fff', border:'1px solid #e5e7eb',
        borderLeft:`4px solid ${sc}`, borderRadius:8, padding:'13px 16px',
        cursor:'pointer', display:'flex', gap:14, alignItems:'flex-start',
        transition:'background .1s', boxShadow:'0 1px 2px rgba(0,0,0,.04)',
        fontFamily:'Inter,sans-serif' }}>

      {entry.images?.length > 0 && (
        <div style={{ width:60, height:44, borderRadius:6, flexShrink:0,
          background:'#f3f4f6', overflow:'hidden', border:'1px solid #e5e7eb' }}>
          <img src={entry.images[0]} alt=""
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        </div>
      )}

      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:5 }}>
          <div style={{ fontSize:13.5, fontWeight:600, color:'#111827',
            lineHeight:1.4, flex:1 }}>{entry.title}</div>
          {entry.pinned && <span style={{ fontSize:13, flexShrink:0 }}>📌</span>}
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          {showSystem && <Tag label={entry.system} color={sc} />}
          <Tag label={entry.difficulty} color={dc} />
          {entry.review_count > 0 && (
            <span style={{ fontSize:11, color:'#16a34a', fontWeight:600 }}>✓ ×{entry.review_count}</span>
          )}
        </div>
        {entry.notes && (
          <div style={{ fontSize:12, color:'#9ca3af', marginTop:5,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {entry.notes}
          </div>
        )}
      </div>

      <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
        <span style={{ fontSize:10, color:'#9ca3af' }}>
          {new Date(entry.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
        </span>
        {entry.images?.length > 0 && (
          <span style={{ fontSize:10, color:'#9ca3af' }}>📷 {entry.images.length}</span>
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
