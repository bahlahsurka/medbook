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
    <div style={{ maxWidth: 700, margin: '0 auto', fontFamily: "'Syne', sans-serif" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 22 }}>Dashboard</div>

      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Entries', val: stats.total, icon: '📋', color: '#3498db' },
          { label: 'Reviewed',      val: stats.reviewed, icon: '✓', color: '#27ae60' },
          { label: 'Flagged',       val: stats.flagged, icon: '⚑', color: '#9b59b6' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#10121a', border: '1px solid #1c1f2e',
            borderTop: `3px solid ${s.color}`,
            borderRadius: 12, padding: '16px 18px'
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{s.val}</div>
            <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        {/* By System */}
        <div style={{ background: '#10121a', border: '1px solid #1c1f2e', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1.5, fontWeight: 800, marginBottom: 14 }}>
            ENTRIES BY SYSTEM
          </div>
          {stats.bySystem.length === 0 ? (
            <div style={{ fontSize: 12, color: '#3a4060' }}>No entries yet</div>
          ) : stats.bySystem.map(s => (
            <div key={s.name} style={{ marginBottom: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: '#8890b0' }}>{s.name}</span>
                <span style={{ fontSize: 11, color: s.color, fontWeight: 700 }}>{s.count}</span>
              </div>
              <div style={{ height: 4, background: '#1c1f2e', borderRadius: 3 }}>
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
        <div style={{ background: '#10121a', border: '1px solid #1c1f2e', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1.5, fontWeight: 800, marginBottom: 14 }}>
            BY DIFFICULTY
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats.byDiff.map(d => (
              <div key={d.d} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#0c0e14', borderRadius: 8, padding: '10px 14px',
                borderLeft: `3px solid ${DIFF_COLOR[d.d]}`
              }}>
                <span style={{ fontSize: 12, color: '#8890b0' }}>{d.d}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: DIFF_COLOR[d.d] }}>{d.count}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, padding: '10px 14px', background: '#0c0e14', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1 }}>WITH IMAGES</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f39c12', marginTop: 2 }}>{stats.withImages}</div>
          </div>
        </div>
      </div>

      {/* Most reviewed */}
      {stats.mostReviewed.filter(e => e.review_count > 0).length > 0 && (
        <div style={{ background: '#10121a', border: '1px solid #1c1f2e', borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1.5, fontWeight: 800, marginBottom: 14 }}>
            MOST REVIEWED
          </div>
          {stats.mostReviewed.filter(e => e.review_count > 0).map(e => (
            <div key={e.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '1px solid #1c1f2e'
            }}>
              <div>
                <div style={{ fontSize: 13, color: '#c0c8e0', fontWeight: 600 }}>{e.title}</div>
                <div style={{ fontSize: 10, color: '#4a5070' }}>{e.system}</div>
              </div>
              <span style={{ fontSize: 12, color: '#27ae60', fontWeight: 700 }}>×{e.review_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
