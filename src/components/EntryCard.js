import { DIFF_COLOR, SYS_COLOR } from '../lib/constants';

export default function EntryCard({ entry, color, onClick, showSystem }) {
  const dc = DIFF_COLOR[entry.difficulty] || '#5a6580';
  const sc = SYS_COLOR[entry.system] || color;
  const displayColor = showSystem ? sc : color;

  return (
    <div onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = '#14161e'}
      onMouseLeave={e => e.currentTarget.style.background = '#10121a'}
      style={{
        background: '#10121a', border: '1px solid #1c1f2e',
        borderLeft: `4px solid ${displayColor}`,
        borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
        display: 'flex', gap: 14, alignItems: 'flex-start',
        transition: 'background .12s', fontFamily: "'Syne', sans-serif"
      }}>

      {/* Thumbnail */}
      {entry.images?.length > 0 && (
        <div style={{
          width: 64, height: 48, borderRadius: 7, flexShrink: 0,
          background: '#0c0e14', overflow: 'hidden',
          border: '1px solid #1c1f2e'
        }}>
          <img src={entry.images[0]} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', marginBottom: 6, lineHeight: 1.3 }}>
          {entry.title}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {showSystem && (
            <Tag label={entry.system} color={sc} />
          )}
          {entry.topic && <Tag label={entry.topic} color={displayColor} />}
          <Tag label={entry.difficulty} color={dc} />
          {entry.review_count > 0 && (
            <span style={{ fontSize: 10, color: '#27ae60', fontWeight: 700 }}>
              ✓ ×{entry.review_count}
            </span>
          )}
        </div>
        {entry.notes && (
          <div style={{
            fontSize: 12, color: '#4a5070', marginTop: 6,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{entry.notes}</div>
        )}
      </div>

      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#2a2f42' }}>
          {new Date(entry.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}
        </span>
        {entry.images?.length > 0 && (
          <span style={{ fontSize: 10, color: '#3a4060' }}>📷 {entry.images.length}</span>
        )}
      </div>
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, background: `${color}20`, color,
      borderRadius: 5, padding: '2px 8px', letterSpacing: 0.3
    }}>{label}</span>
  );
}
