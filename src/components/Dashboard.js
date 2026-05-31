import { useMemo } from 'react';
import { SYSTEMS, SYS_COLOR, DIFFICULTY, DIFF_COLOR } from '../lib/constants';

export default function Dashboard({ entries }) {
  const stats = useMemo(() => {
    const all = Object.values(entries).flat();
    const bySystem = SYSTEMS.map(s => ({
      name: s, count: (entries[s] || []).length, color: SYS_COLOR[s]
    })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    const byDiff = DIFFICULTY.map(d => ({ d, count: all.filter(e => e.difficulty === d).length }));
    const reviewed = all.filter(e => e.review_count > 0).length;
    const flagged = all.filter(e => e.difficulty === 'Flagged').length;
    const withImages = all.filter(e => e.images?.length > 0).length;
    const mostReviewed = [...all].sort((a, b) => (b.review_count || 0) - (a.review_count || 0)).slice(0, 5);
    return { total: all.length, bySystem, byDiff, reviewed, flagged, withImages, mostReviewed };
  }, [entries]);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 20 }}>Dashboard</div>

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Entries', val: stats.total, color: '#2563eb' },
          { label: 'Reviewed',      val: stats.reviewed, color: '#16a34a' },
          { label: 'Flagged',       val: stats.flagged, color: '#7c3aed' },
          { label: 'With Images',   val: stats.withImages, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#fff', border: '1px solid #e5e7eb',
            borderTop: `3px solid ${s.color}`,
            borderRadius: 10, padding: '16px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
          }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#111827' }}>{s.val}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 16 }}>
        {/* By System */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 0.8,
            fontWeight: 600, textTransform: 'uppercase', marginBottom: 14 }}>Entries by System</div>
          {stats.bySystem.length === 0 ? (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>No entries yet</div>
          ) : stats.bySystem.map(s => (
            <div key={s.name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: '#374151' }}>{s.name}</span>
                <span style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.count}</span>
              </div>
              <div style={{ height: 4, background: '#f3f4f6', borderRadius: 3 }}>
                <div style={{
                  height: '100%', borderRadius: 3, background: s.color,
                  width: `${Math.max(6, (s.count / stats.total) * 100)}%`,
                  transition: 'width .4s'
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* By Difficulty */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 0.8,
            fontWeight: 600, textTransform: 'uppercase', marginBottom: 14 }}>By Difficulty</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stats.byDiff.map(d => (
              <div key={d.d} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: `${DIFF_COLOR[d.d]}08`, borderRadius: 8,
                padding: '10px 14px', border: `1px solid ${DIFF_COLOR[d.d]}20`
              }}>
                <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{d.d}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: DIFF_COLOR[d.d] }}>{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Most reviewed */}
      {stats.mostReviewed.filter(e => e.review_count > 0).length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 0.8,
            fontWeight: 600, textTransform: 'uppercase', marginBottom: 14 }}>Most Reviewed</div>
          {stats.mostReviewed.filter(e => e.review_count > 0).map((e, i) => (
            <div key={e.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: i < 4 ? '1px solid #f3f4f6' : 'none'
            }}>
              <div>
                <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{e.title}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{e.system}</div>
              </div>
              <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>×{e.review_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
