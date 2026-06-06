import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';

export default function QuickAdd({ userId, activeSystem, userSystems, color, onSaved, onClose }) {
  const [title, setTitle]   = useState('');
  const [notes, setNotes]   = useState('');
  const [system, setSystem] = useState(activeSystem);
  const [diff, setDiff]     = useState('Medium');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr('');
    const { data, error } = await supabase.from('entries').insert({
      user_id: userId, system, title: title.trim(),
      notes: notes.trim(), difficulty: diff,
      images: [], highlights: [], pinned: false,
      review_count: 0, last_reviewed: null
    }).select().single();
    if (error) { setErr(error.message); setSaving(false); return; }
    onSaved([data]);
    onClose();
  };

  const sys = userSystems.find(s => s.name === system);
  const sysColor = sys?.color || color;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200,
      display:'flex', flexDirection:'column', justifyContent:'flex-end',
      background:'rgba(0,0,0,0.4)', fontFamily:'Inter,sans-serif' }}
      onClick={e => { if(e.target===e.currentTarget) onClose(); }}>

      <div style={{ background:'#fff', borderRadius:'16px 16px 0 0',
        padding:'20px 16px 32px', maxHeight:'85vh', overflowY:'auto' }}>

        {/* Handle */}
        <div style={{ width:40, height:4, background:'#e5e7eb', borderRadius:4,
          margin:'0 auto 20px' }} />

        <div style={{ fontSize:15, fontWeight:700, color:'#111827', marginBottom:16 }}>
          Quick Add
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <input value={title} onChange={e=>setTitle(e.target.value)}
            placeholder="Title *" autoFocus
            style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:8,
              padding:'12px', fontSize:15, outline:'none', boxSizing:'border-box',
              fontFamily:'Inter,sans-serif', color:'#111827' }} />

          {/* System picker */}
          <select value={system} onChange={e=>setSystem(e.target.value)}
            style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:8,
              padding:'11px 12px', fontSize:14, outline:'none', background:'#fff',
              color:'#111827', fontFamily:'Inter,sans-serif', boxSizing:'border-box' }}>
            {userSystems.map(s => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>

          {/* Difficulty */}
          <div style={{ display:'flex', gap:8 }}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={()=>setDiff(d)} style={{
                flex:1, padding:'9px 4px', borderRadius:6, border:`1px solid ${diff===d?DIFF_COLOR[d]:'#e5e7eb'}`,
                background:diff===d?`${DIFF_COLOR[d]}12`:'#fff',
                color:diff===d?DIFF_COLOR[d]:'#6b7280',
                fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif'
              }}>{d}</button>
            ))}
          </div>

          <textarea value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={4}
            style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:8,
              padding:'12px', fontSize:14, outline:'none', resize:'none',
              boxSizing:'border-box', fontFamily:'Inter,sans-serif', color:'#111827', lineHeight:1.6 }} />

          {err && <div style={{ fontSize:13, color:'#dc2626' }}>{err}</div>}

          <button onClick={save} disabled={saving} style={{
            background:saving?'#93c5fd':sysColor, color:'#fff', border:'none',
            borderRadius:10, padding:'14px', fontSize:15, fontWeight:600,
            cursor:saving?'not-allowed':'pointer', fontFamily:'Inter,sans-serif'
          }}>
            {saving ? 'Saving…' : '✓ Save Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
