import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

const PRESET_COLORS = [
  '#2563eb','#dc2626','#16a34a','#d97706','#7c3aed',
  '#db2777','#0891b2','#ea580c','#15803d','#be123c',
  '#0369a1','#92400e','#4338ca','#0f766e','#374151','#6d28d9'
];

export default function ManageSystems({ systems, onSave, onClose, userId }) {
  const { t } = useTheme();
  const [list, setList]         = useState(systems.map(s => ({ ...s })));
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#2563eb');
  const [editIdx, setEditIdx]   = useState(null);
  const [editName, setEditName] = useState('');
  const [err, setErr]           = useState('');
  const [saving, setSaving]     = useState(false);

  const addSystem = () => {
    const name = newName.trim();
    if (!name) { setErr('Enter a system name'); return; }
    if (list.find(s => s.name.toLowerCase() === name.toLowerCase())) {
      setErr('System already exists'); return;
    }
    setList(p => [...p, { name, color: newColor, custom: true }]);
    setNewName(''); setNewColor('#2563eb'); setErr('');
  };

  const removeSystem = (idx) => {
    if (!window.confirm(`Remove "${list[idx].name}"? Entries in this system are NOT deleted.`)) return;
    setList(p => p.filter((_, i) => i !== idx));
  };

  const startEdit = (idx) => {
    setEditIdx(idx); setEditName(list[idx].name); setErr('');
  };

  const saveEditName = (idx) => {
    const name = editName.trim();
    if (!name) { setErr('Name cannot be empty'); return; }
    if (list.find((s, i) => i !== idx && s.name.toLowerCase() === name.toLowerCase())) {
      setErr('Name already taken'); return;
    }
    setList(p => p.map((s, i) => i === idx
      ? { ...s, name, _oldName: s._oldName || s.name }
      : s
    ));
    setEditIdx(null); setErr('');
  };

  const changeColor = (idx, color) =>
    setList(p => p.map((s, i) => i === idx ? { ...s, color } : s));

  const moveUp = (idx) => {
    if (idx === 0) return;
    setList(p => { const a=[...p]; [a[idx-1],a[idx]]=[a[idx],a[idx-1]]; return a; });
  };
  const moveDown = (idx) => {
    if (idx === list.length-1) return;
    setList(p => { const a=[...p]; [a[idx],a[idx+1]]=[a[idx+1],a[idx]]; return a; });
  };

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      const renamed = list.filter(s => s._oldName && s._oldName !== s.name);
      for (const sys of renamed) {
        const { error } = await supabase.from('entries')
          .update({ system: sys.name })
          .eq('system', sys._oldName)
          .eq('user_id', userId);
        if (error) throw new Error(`Failed updating entries for "${sys._oldName}": ${error.message}`);
      }
      const clean = list.map(({ _oldName, ...rest }) => rest);
      await onSave(clean);
    } catch(e) {
      setErr(e.message); setSaving(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:t.overlay, zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
      fontFamily:'Inter,sans-serif' }}>
      <div style={{ background:t.surface, borderRadius:14, width:'100%', maxWidth:520,
        maxHeight:'88vh', display:'flex', flexDirection:'column',
        boxShadow:`0 8px 32px ${t.shadowStrong}` }}>

        <div style={{ padding:'18px 20px 14px', borderBottom:`1px solid ${t.border}`,
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:t.text }}>Manage Systems</div>
            <div style={{ fontSize:11, color:t.text4, marginTop:2 }}>
              Syncs across all your devices automatically
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none',
            fontSize:20, color:t.text4, cursor:'pointer' }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'10px 16px' }}>
          {list.map((sys, idx) => (
            <div key={idx} style={{ display:'flex', alignItems:'center', gap:8,
              padding:'8px 10px', borderRadius:8, marginBottom:4,
              background:t.surface2, border:`1px solid ${t.border}` }}>
              <div style={{ position:'relative', flexShrink:0 }}>
                <div style={{ width:16, height:16, borderRadius:'50%',
                  background:sys.color, cursor:'pointer', border:`1px solid ${t.border}` }} />
                <input type="color" value={sys.color} onChange={e=>changeColor(idx,e.target.value)}
                  style={{ position:'absolute', opacity:0, inset:0, width:'100%', height:'100%', cursor:'pointer' }} />
              </div>

              {editIdx === idx ? (
                <input value={editName} onChange={e=>setEditName(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter')saveEditName(idx); if(e.key==='Escape')setEditIdx(null); }}
                  autoFocus
                  style={{ flex:1, border:`1px solid ${t.accent}`, borderRadius:6,
                    padding:'4px 8px', fontSize:13, outline:'none', color:t.text,
                    background:t.surface, fontFamily:'Inter,sans-serif' }} />
              ) : (
                <span style={{ flex:1, fontSize:13, color:t.text, fontWeight:500 }}>
                  {sys.name}
                  {sys._oldName && sys._oldName !== sys.name && (
                    <span style={{ fontSize:10, color:t.warn, marginLeft:6,
                      background:t.warnBg, borderRadius:4, padding:'1px 6px',
                      border:`1px solid ${t.warnBorder}` }}>renamed — will update entries</span>
                  )}
                  {sys.custom && !sys._oldName && (
                    <span style={{ fontSize:10, color:t.text4, marginLeft:6,
                      background:t.surface3, borderRadius:4, padding:'1px 5px' }}>custom</span>
                  )}
                </span>
              )}

              <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                {editIdx === idx ? (
                  <>
                    <IBtn onClick={()=>saveEditName(idx)} color="#16a34a">✓</IBtn>
                    <IBtn onClick={()=>setEditIdx(null)} color={t.text3}>✕</IBtn>
                  </>
                ) : (
                  <>
                    <IBtn onClick={()=>moveUp(idx)} color={t.text3} disabled={idx===0}>↑</IBtn>
                    <IBtn onClick={()=>moveDown(idx)} color={t.text3} disabled={idx===list.length-1}>↓</IBtn>
                    <IBtn onClick={()=>startEdit(idx)} color="#2563eb">✎</IBtn>
                    <IBtn onClick={()=>removeSystem(idx)} color="#dc2626">🗑</IBtn>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding:'12px 16px', borderTop:`1px solid ${t.border}`, flexShrink:0 }}>
          {err && <div style={{ fontSize:12, color:t.danger, marginBottom:8 }}>{err}</div>}
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ position:'relative', flexShrink:0 }}>
              <div style={{ width:32, height:32, borderRadius:8, background:newColor,
                border:`1px solid ${t.border}`, cursor:'pointer' }} />
              <input type="color" value={newColor} onChange={e=>setNewColor(e.target.value)}
                style={{ position:'absolute', opacity:0, inset:0, cursor:'pointer' }} />
            </div>
            <input value={newName} onChange={e=>{ setNewName(e.target.value); setErr(''); }}
              onKeyDown={e=>e.key==='Enter'&&addSystem()}
              placeholder="New system name…"
              style={{ flex:1, border:`1px solid ${t.borderStrong}`, borderRadius:8,
                padding:'8px 12px', fontSize:13, outline:'none', color:t.text,
                background:t.surface2, fontFamily:'Inter,sans-serif' }} />
            <button onClick={addSystem} style={{ background:t.accent, color:'#fff',
              border:'none', borderRadius:8, padding:'8px 16px', fontSize:13,
              fontWeight:600, cursor:'pointer', flexShrink:0, fontFamily:'Inter,sans-serif' }}>
              + Add
            </button>
          </div>
          <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
            {PRESET_COLORS.map(c => (
              <div key={c} onClick={()=>setNewColor(c)} style={{
                width:18, height:18, borderRadius:'50%', background:c, cursor:'pointer',
                flexShrink:0, border:newColor===c?`2px solid ${t.text}`:`1px solid ${t.border}`
              }} />
            ))}
          </div>
        </div>

        <div style={{ padding:'12px 16px 16px', borderTop:`1px solid ${t.border}`,
          display:'flex', gap:10, flexShrink:0 }}>
          <button onClick={handleSave} disabled={saving} style={{
            flex:1, background:saving?'#93c5fd':t.accent, color:'#fff', border:'none',
            borderRadius:8, padding:11, fontSize:14, fontWeight:600,
            cursor:saving?'not-allowed':'pointer', fontFamily:'Inter,sans-serif' }}>
            {saving?'Saving…':'Save Changes'}
          </button>
          <button onClick={onClose} style={{ background:t.surface3, color:t.text3,
            border:`1px solid ${t.border}`, borderRadius:8, padding:'11px 20px',
            fontSize:14, cursor:'pointer', fontFamily:'Inter,sans-serif' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function IBtn({ onClick, color, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:`${color}18`, color, border:`1px solid ${color}40`,
      borderRadius:6, padding:'4px 8px', fontSize:12,
      cursor:disabled?'not-allowed':'pointer', opacity:disabled?.4:1,
      fontWeight:600, fontFamily:'Inter,sans-serif'
    }}>{children}</button>
  );
}
