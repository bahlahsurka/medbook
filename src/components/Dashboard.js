import { useMemo } from 'react';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';
import { useTheme } from '../lib/theme';

export default function Dashboard({ entries, userSystems }) {
  const { t } = useTheme();
  const stats = useMemo(() => {
    const all = Object.values(entries).flat();
    const bySystem = (userSystems||[]).map(s => ({
      name:s.name, count:(entries[s.name]||[]).length, color:s.color||'#2563eb'
    })).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
    const byDiff = DIFFICULTY.map(d=>({d, count:all.filter(e=>e.difficulty===d).length}));
    const reviewed = all.filter(e=>e.review_count>0).length;
    const flagged  = all.filter(e=>e.difficulty==='Flagged').length;
    const pinned   = all.filter(e=>e.pinned).length;
    const withImgs = all.filter(e=>e.images?.length>0).length;
    const mostReviewed = [...all].sort((a,b)=>(b.review_count||0)-(a.review_count||0)).slice(0,5);
    return { total:all.length, bySystem, byDiff, reviewed, flagged, pinned, withImgs, mostReviewed };
  }, [entries, userSystems]);

  const card = { background:t.surface, border:`1px solid ${t.border}`, borderRadius:10,
    padding:18, boxShadow:`0 1px 2px ${t.shadow}` };
  const capLabel = { fontSize:11, color:t.text4, letterSpacing:.8, fontWeight:600,
    textTransform:'uppercase', marginBottom:14 };

  return (
    <div style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:16, fontWeight:700, color:t.text, marginBottom:20 }}>Dashboard</div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',
        gap:12, marginBottom:20 }}>
        {[
          { label:'Total Entries', val:stats.total,    color:'#2563eb' },
          { label:'Reviewed',      val:stats.reviewed,  color:'#16a34a' },
          { label:'Pinned',        val:stats.pinned,    color:'#d97706' },
          { label:'Flagged',       val:stats.flagged,   color:'#7c3aed' },
        ].map(s=>(
          <div key={s.label} style={{ background:t.surface, border:`1px solid ${t.border}`,
            borderTop:`3px solid ${s.color}`, borderRadius:10, padding:'16px',
            boxShadow:`0 1px 2px ${t.shadow}` }}>
            <div style={{ fontSize:26, fontWeight:700, color:t.text }}>{s.val}</div>
            <div style={{ fontSize:11, color:t.text4, marginTop:2, fontWeight:500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',
        gap:14, marginBottom:16 }}>
        <div style={card}>
          <div style={capLabel}>Entries by System</div>
          {stats.bySystem.length===0
            ? <div style={{fontSize:13,color:t.text4}}>No entries yet</div>
            : stats.bySystem.map(s=>(
              <div key={s.name} style={{ marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:12, color:t.text2 }}>{s.name}</span>
                  <span style={{ fontSize:12, color:s.color, fontWeight:600 }}>{s.count}</span>
                </div>
                <div style={{ height:4, background:t.surface3, borderRadius:3 }}>
                  <div style={{ height:'100%', borderRadius:3, background:s.color,
                    width:`${Math.max(6,(s.count/stats.total)*100)}%`, transition:'width .4s' }} />
                </div>
              </div>
            ))
          }
        </div>

        <div style={card}>
          <div style={capLabel}>By Difficulty</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {stats.byDiff.map(d=>(
              <div key={d.d} style={{ display:'flex', alignItems:'center',
                justifyContent:'space-between', background:`${DIFF_COLOR[d.d]}14`,
                borderRadius:8, padding:'10px 14px', border:`1px solid ${DIFF_COLOR[d.d]}30` }}>
                <span style={{ fontSize:13, color:t.text2, fontWeight:500 }}>{d.d}</span>
                <span style={{ fontSize:18, fontWeight:700, color:DIFF_COLOR[d.d] }}>{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {stats.mostReviewed.filter(e=>e.review_count>0).length>0 && (
        <div style={card}>
          <div style={capLabel}>Most Reviewed</div>
          {stats.mostReviewed.filter(e=>e.review_count>0).map((e,i)=>(
            <div key={e.id} style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', padding:'10px 0',
              borderBottom:i<4?`1px solid ${t.border}`:'none' }}>
              <div>
                <div style={{ fontSize:13, color:t.text, fontWeight:500 }}>{e.title}</div>
                <div style={{ fontSize:11, color:t.text4 }}>{e.system}</div>
              </div>
              <span style={{ fontSize:13, color:t.ok, fontWeight:600 }}>×{e.review_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
