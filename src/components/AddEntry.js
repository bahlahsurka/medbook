import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';
import { HL_COLORS, buildHighlightParts, adjustHighlights } from '../lib/highlights';

const DRAFT_KEY = 'medbook_draft_v1';
function loadDraft(sys) {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')[sys]||null; } catch { return null; }
}
function saveDraft(sys, data) {
  try { const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}'); d[sys]=data; localStorage.setItem(DRAFT_KEY,JSON.stringify(d)); } catch {}
}
function clearDraft(sys) {
  try { const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}'); delete d[sys]; localStorage.setItem(DRAFT_KEY,JSON.stringify(d)); } catch {}
}

// Renders highlighted text on top of textarea
function HighlightOverlay({ text, highlights, fontSize, lineHeight, padding }) {
  const parts = buildHighlightParts(text + '\n', highlights); // trailing \n keeps height
  return (
    <div style={{
      position:'absolute', inset:0, pointerEvents:'none',
      whiteSpace:'pre-wrap', wordBreak:'break-word', overflowWrap:'break-word',
      fontSize, lineHeight, padding, color:'transparent',
      fontFamily:'Inter,sans-serif', boxSizing:'border-box',
      overflowY:'auto'
    }}>
      {parts.map((p, i) =>
        p.hl
          ? <mark key={i} style={{ background:p.hl.bg, color:'transparent',
              borderRadius:2, padding:'0 1px' }}>{p.t}</mark>
          : <span key={i}>{p.t}</span>
      )}
    </div>
  );
}

export default function AddEntry({ activeSystem, color, userId, onSaved, onCancel, userSystems }) {
  const draft = loadDraft(activeSystem);
  const [title, setTitle]     = useState(draft?.title || '');
  const [notes, setNotes]     = useState(draft?.notes || '');
  const [difficulty, setDiff] = useState(draft?.difficulty || 'Medium');
  const [systems, setSystems] = useState(draft?.systems?.length ? draft.systems : [activeSystem]);
  const [highlights, setHL]   = useState(draft?.highlights || []);
  const [images, setImages]   = useState([]);
  const [saving, setSaving]   = useState(false);
  const [saveStatus, setSS]   = useState('');
  const [err, setErr]         = useState('');
  const [sysOpen, setSysOpen] = useState(false);
  const [dragOver, setDrag]   = useState(false);
  const [hlMode, setHlMode]   = useState(false);

  const fileRef = useRef(); const galRef = useRef(); const taRef = useRef();
  const savedSel = useRef({ start:0, end:0 }); // saves selection before focus lost on mobile

  useEffect(() => {
    saveDraft(activeSystem, { title, notes, difficulty, systems, highlights });
  }, [title, notes, difficulty, systems, highlights, activeSystem]);

  const toggleSys = n => setSystems(p => p.includes(n) ? p.filter(s=>s!==n) : [...p,n]);

  const loadFiles = useCallback((files) => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => setImages(p=>[...p,{preview:e.target.result,file:f}]);
      r.readAsDataURL(f);
    });
  }, []);

  const uploadImg = async (img) => {
    const ext = img.file.name.split('.').pop()||'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const {error} = await supabase.storage.from('entry-images')
      .upload(path,img.file,{contentType:img.file.type});
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return supabase.storage.from('entry-images').getPublicUrl(path).data.publicUrl;
  };

  const [selLocked, setSelLocked] = useState(false); // true when selection is locked in

  // Called on every selection change in textarea
  const onTASelect = () => {
    const ta = taRef.current; if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) {
      savedSel.current = { start: ta.selectionStart, end: ta.selectionEnd };
      setSelLocked(false);
    }
  };

  // Lock the selection in (user taps this before tapping colour on mobile)
  const lockSelection = () => {
    const ta = taRef.current;
    // Try live selection first
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      savedSel.current = { start: ta.selectionStart, end: ta.selectionEnd };
    }
    if (savedSel.current.start === savedSel.current.end) {
      alert('Select some text first.');
      return;
    }
    setSelLocked(true);
  };

  const applyHL = (c) => {
    // On desktop, try live selection first
    const ta = taRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      savedSel.current = { start: ta.selectionStart, end: ta.selectionEnd };
    }
    const { start, end } = savedSel.current;
    if (start === end) { alert('Select text first, then tap Mark, then choose a colour.'); return; }
    setHL(p => [...p, { start, end, color: c }]);
    savedSel.current = { start:0, end:0 };
    setSelLocked(false);
  };

  const removeHL = () => {
    const ta = taRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      savedSel.current = { start: ta.selectionStart, end: ta.selectionEnd };
    }
    const { start, end } = savedSel.current;
    if (start === end) { setHL([]); return; }
    setHL(p => p.filter(h => !(h.start < end && h.end > start)));
    savedSel.current = { start:0, end:0 };
    setSelLocked(false);
  };

  const handleNotesChange = (val) => {
    setHL(prev => adjustHighlights(notes, val, prev));
    setNotes(val);
  };

  const save = async () => {
    setErr('');
    if (!title.trim()) { setErr('Title is required'); return; }
    if (!systems.length) { setErr('Select at least one system'); return; }
    setSaving(true);
    try {
      let urls = [];
      if (images.length > 0) { setSS('Uploading images…'); urls = await Promise.all(images.map(uploadImg)); }
      setSS('Saving entry…');
      const rows = systems.map(sys => ({
        user_id:userId, system:sys, title:title.trim(), notes:notes.trim(),
        difficulty, images:urls, highlights, pinned:false, review_count:0, last_reviewed:null
      }));
      const {data,error} = await supabase.from('entries').insert(rows).select();
      if (error) throw new Error(`Save failed: ${error.message}`);
      setSS('Saved ✓');
      clearDraft(activeSystem);
      setTimeout(()=>onSaved(data), 350);
    } catch(e) { setErr(e.message); setSaving(false); setSS(''); }
  };

  const hasDraft = !!(draft?.title||draft?.notes);
  const TA_FONT = 14, TA_LH = '1.7', TA_PAD = '10px 12px';

  return (
    <div style={{maxWidth:680,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:700,color:'#111827'}}>New Entry</div>
        {hasDraft&&<span style={{fontSize:11,background:'#fef9c3',color:'#92400e',
          borderRadius:5,padding:'2px 8px',fontWeight:600,border:'1px solid #fde68a'}}>
          Draft restored</span>}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:16}}>

        <F label="TITLE *">
          <input value={title} onChange={e=>setTitle(e.target.value)}
            placeholder="e.g. Digoxin toxicity — ECG changes"
            style={inp} autoFocus disabled={saving} />
        </F>

        <F label="SYSTEMS">
          <div style={{marginTop:8}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
              {systems.map(s=>{
                const sys=(userSystems||[]).find(u=>u.name===s);
                const c=sys?.color||'#2563eb';
                return <span key={s} onClick={()=>!saving&&toggleSys(s)} style={{
                  display:'flex',alignItems:'center',gap:5,fontSize:12,fontWeight:600,
                  background:`${c}15`,color:c,border:`1px solid ${c}40`,
                  borderRadius:5,padding:'3px 10px',cursor:saving?'default':'pointer'
                }}>{s}{!saving&&<span style={{fontSize:10}}>✕</span>}</span>;
              })}
              {!saving&&<button onClick={()=>setSysOpen(p=>!p)} style={{
                fontSize:12,background:'#f3f4f6',border:'1px solid #e5e7eb',
                borderRadius:5,padding:'3px 12px',cursor:'pointer',
                color:'#374151',fontWeight:600,fontFamily:'Inter,sans-serif'
              }}>{sysOpen?'▲ Close':'+ Add System'}</button>}
            </div>
            {sysOpen&&!saving&&(
              <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
                padding:12,display:'flex',flexWrap:'wrap',gap:6,
                maxHeight:200,overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}>
                {(userSystems||[]).map(s=>{
                  const sel=systems.includes(s.name); const c=s.color||'#2563eb';
                  return <button key={s.name} onClick={()=>toggleSys(s.name)} style={{
                    fontSize:12,fontWeight:sel?600:400,
                    background:sel?`${c}15`:'#f9fafb',color:sel?c:'#374151',
                    border:`1px solid ${sel?c+'50':'#e5e7eb'}`,
                    borderRadius:5,padding:'5px 12px',cursor:'pointer',fontFamily:'Inter,sans-serif'
                  }}>{s.name}</button>;
                })}
              </div>
            )}
          </div>
        </F>

        <F label="DIFFICULTY">
          <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
            {DIFFICULTY.map(d=>(
              <button key={d} onClick={()=>!saving&&setDiff(d)} style={{
                padding:'7px 16px',borderRadius:6,
                border:`1px solid ${difficulty===d?DIFF_COLOR[d]:'#e5e7eb'}`,
                cursor:saving?'default':'pointer',fontSize:13,fontWeight:600,
                background:difficulty===d?`${DIFF_COLOR[d]}12`:'#fff',
                color:difficulty===d?DIFF_COLOR[d]:'#6b7280',fontFamily:'Inter,sans-serif'
              }}>{d}</button>
            ))}
          </div>
        </F>

        <F label="REVIEW NOTES">
          {/* Highlight toolbar */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
            <button onClick={()=>{setHlMode(p=>!p);setSelLocked(false);savedSel.current={start:0,end:0};}} style={{
              fontSize:11,background:hlMode?'#fef9c3':'#f3f4f6',
              border:`1px solid ${hlMode?'#fde68a':'#e5e7eb'}`,
              borderRadius:5,padding:'4px 10px',cursor:'pointer',
              color:hlMode?'#92400e':'#6b7280',fontWeight:600,fontFamily:'Inter,sans-serif'
            }}>🖊 {hlMode?'Highlighting on':'Highlight'}</button>

            {hlMode && !selLocked && (
              <button onClick={lockSelection} style={{
                fontSize:11,background:'#2563eb',color:'#fff',
                border:'none',borderRadius:5,padding:'4px 12px',
                cursor:'pointer',fontWeight:600,fontFamily:'Inter,sans-serif'
              }}>✓ Mark Selection</button>
            )}

            {hlMode && selLocked && (
              <span style={{fontSize:11,color:'#16a34a',fontWeight:600,
                background:'#f0fdf4',border:'1px solid #bbf7d0',
                borderRadius:5,padding:'3px 10px'}}>
                ✓ Selected — now tap a colour:
              </span>
            )}

            {hlMode && HL_COLORS.map((c,i)=>(
              <button key={i} onClick={()=>applyHL(c)} title={c.label}
                style={{width:24,height:24,borderRadius:5,
                  border:`2px solid ${selLocked?'#2563eb':'#e5e7eb'}`,
                  background:c.bg,cursor:'pointer',flexShrink:0,
                  opacity:selLocked?1:0.5}} />
            ))}

            {hlMode && <button onClick={removeHL} style={{fontSize:11,background:'#f3f4f6',
              border:'1px solid #e5e7eb',borderRadius:5,padding:'3px 10px',
              cursor:'pointer',color:'#6b7280',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              Remove</button>}

            {highlights.length>0&&<span style={{fontSize:11,color:'#9ca3af'}}>
              {highlights.length} highlight{highlights.length!==1?'s':''}</span>}
          </div>
          {hlMode && !selLocked && (
            <div style={{fontSize:11,color:'#9ca3af',marginBottom:6}}>
              1. Select text in the box below &nbsp;2. Tap <strong>✓ Mark Selection</strong> &nbsp;3. Tap a colour
            </div>
          )}

          {/* Textarea with highlight overlay */}
          <div style={{position:'relative'}}>
            <HighlightOverlay text={notes} highlights={highlights}
              fontSize={TA_FONT} lineHeight={TA_LH} padding={TA_PAD} />
            <textarea
              ref={taRef}
              value={notes}
              onChange={e=>handleNotesChange(e.target.value)}
              onSelect={onTASelect}
              onMouseUp={onTASelect}
              onTouchEnd={onTASelect}
              onKeyUp={onTASelect}
              placeholder="Key concepts, mnemonics, clinical pearls…"
              rows={8}
              disabled={saving}
              style={{
                ...inp, resize:'vertical', lineHeight:TA_LH,
                background:'transparent', position:'relative', zIndex:1,
                caretColor:'#111827', color: highlights.length>0?'rgba(0,0,0,0.01)':'#111827'
              }}
            />
          </div>
          {highlights.length>0&&<div style={{fontSize:11,color:'#6b7280',marginTop:4}}>
            Note: highlighted text appears in colour after saving.
          </div>}
        </F>

        <F label="SCREENSHOTS / IMAGES">
          <div style={{display:'flex',gap:10,marginTop:8,flexWrap:'wrap'}}>
            <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);loadFiles(e.dataTransfer.files);}}
              onClick={()=>!saving&&fileRef.current?.click()}
              style={{flex:1,minWidth:120,border:`2px dashed ${dragOver?color:'#d1d5db'}`,
                borderRadius:8,padding:'20px 14px',textAlign:'center',
                cursor:saving?'default':'pointer',background:dragOver?`${color}08`:'#f9fafb'}}>
              <div style={{fontSize:22,marginBottom:4}}>🖼️</div>
              <div style={{fontSize:12,color:'#6b7280'}}>Drag & Drop</div>
            </div>
            <div onClick={()=>!saving&&galRef.current?.click()}
              style={{flex:1,minWidth:120,border:'2px dashed #d1d5db',borderRadius:8,
                padding:'20px 14px',textAlign:'center',cursor:saving?'default':'pointer',background:'#f9fafb'}}>
              <div style={{fontSize:22,marginBottom:4}}>📷</div>
              <div style={{fontSize:12,color:'#6b7280'}}>From Gallery</div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e=>loadFiles(e.target.files)} />
          <input ref={galRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e=>loadFiles(e.target.files)} />
          {images.length>0&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:12}}>
              {images.map((img,i)=>(
                <div key={i} style={{position:'relative'}}>
                  <img src={img.preview} alt="" style={{width:100,height:76,objectFit:'cover',
                    borderRadius:7,border:'1px solid #e5e7eb'}} />
                  {!saving&&<button onClick={()=>setImages(p=>p.filter((_,j)=>j!==i))} style={{
                    position:'absolute',top:-7,right:-7,background:'#dc2626',border:'none',
                    borderRadius:'50%',width:20,height:20,fontSize:10,color:'#fff',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>}
                </div>
              ))}
            </div>
          )}
          <div style={{fontSize:11,color:'#9ca3af',marginTop:8}}>
            ℹ️ Text & highlights auto-saved as draft. Re-add images if you switch apps.
          </div>
        </F>

        {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',
          borderRadius:8,padding:'12px 16px',fontSize:13,color:'#dc2626'}}>
          <strong>Error:</strong> {err}
          <div style={{marginTop:6,fontSize:12,color:'#b91c1c'}}>Your text is saved as a draft.</div>
        </div>}

        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={save} disabled={saving} style={{
            background:saving?'#93c5fd':color,color:'#fff',border:'none',
            borderRadius:8,padding:'12px 28px',fontSize:14,fontWeight:600,
            cursor:saving?'not-allowed':'pointer',fontFamily:'Inter,sans-serif',
            minWidth:180,display:'flex',alignItems:'center',justifyContent:'center',gap:8
          }}>
            {saving?<>
              <span style={{display:'inline-block',width:14,height:14,
                border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',
                borderRadius:'50%',animation:'spin .7s linear infinite'}} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              {saveStatus||'Saving…'}
            </>:`✓ Save to ${systems.length} system${systems.length!==1?'s':''}`}
          </button>
          {!saving&&<button onClick={()=>{clearDraft(activeSystem);onCancel();}} style={{
            background:'#f3f4f6',color:'#6b7280',border:'1px solid #e5e7eb',
            borderRadius:8,padding:'12px 20px',fontSize:14,
            cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

function F({label,children}) {
  return <div>
    <div style={{fontSize:10,color:'#9ca3af',letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>{label}</div>
    {children}
  </div>;
}

const inp = {
  display:'block',width:'100%',marginTop:8,background:'#fff',
  border:'1px solid #d1d5db',borderRadius:8,color:'#111827',
  padding:'10px 12px',fontSize:14,outline:'none',boxSizing:'border-box',
  fontFamily:'Inter,sans-serif'
};
