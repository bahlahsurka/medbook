import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR, DIFFICULTY } from '../lib/constants';
import { buildHighlightParts } from '../lib/highlights';
import { useHighlight } from '../lib/useHighlight';
import HLToolbar from './HLToolbar';

function RenderedNotes({ text, highlights }) {
  const parts = buildHighlightParts(text, highlights);
  return (
    <span style={{whiteSpace:'pre-wrap'}}>
      {parts.map((p,i) => p.hl
        ? <mark key={i} style={{background:p.hl.bg,color:p.hl.text,borderRadius:2,padding:'0 2px'}}>{p.t}</mark>
        : <span key={i}>{p.t}</span>
      )}
    </span>
  );
}

function Lightbox({ images, start, onClose }) {
  const [idx, setIdx] = useState(start);
  const tx = useRef(null);
  const prev = () => setIdx(i=>(i-1+images.length)%images.length);
  const next = () => setIdx(i=>(i+1)%images.length);

  const download = async () => {
    try {
      const res  = await fetch(images[idx]);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `medbook_image_${idx+1}.jpg`; a.click();
      URL.revokeObjectURL(url);
    } catch { window.open(images[idx],'_blank'); }
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.92)',zIndex:1000,
      display:'flex',alignItems:'center',justifyContent:'center'}}
      onTouchStart={e=>{tx.current=e.touches[0].clientX;}}
      onTouchEnd={e=>{
        if(!tx.current)return;
        const dx=e.changedTouches[0].clientX-tx.current;
        if(dx<-50)next();else if(dx>50)prev();tx.current=null;
      }}>
      <button onClick={onClose} style={{position:'absolute',top:16,right:20,
        background:'rgba(255,255,255,.15)',border:'none',color:'#fff',fontSize:20,
        cursor:'pointer',width:40,height:40,borderRadius:'50%',
        display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      <button onClick={download} style={{position:'absolute',top:16,left:20,
        background:'rgba(255,255,255,.15)',border:'none',color:'#fff',fontSize:12,
        cursor:'pointer',padding:'8px 14px',borderRadius:8,fontWeight:600,fontFamily:'Inter,sans-serif'}}>
        ⬇ Download
      </button>
      {images.length>1 && <>
        <div style={{position:'absolute',top:20,left:'50%',transform:'translateX(-50%)',
          color:'#fff',fontSize:13,background:'rgba(0,0,0,.5)',padding:'4px 14px',borderRadius:20}}>
          {idx+1}/{images.length}
        </div>
        <button onClick={prev} style={{position:'absolute',left:12,background:'rgba(255,255,255,.15)',
          border:'none',color:'#fff',fontSize:28,cursor:'pointer',width:44,height:44,
          borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center'}}>‹</button>
        <button onClick={next} style={{position:'absolute',right:12,background:'rgba(255,255,255,.15)',
          border:'none',color:'#fff',fontSize:28,cursor:'pointer',width:44,height:44,
          borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center'}}>›</button>
      </>}
      <img src={images[idx]} alt=""
        style={{maxWidth:'90vw',maxHeight:'85vh',borderRadius:8,objectFit:'contain',display:'block'}}
        onClick={e=>e.stopPropagation()} />
      <div onClick={onClose} style={{position:'absolute',inset:0,zIndex:-1}} />
    </div>
  );
}

export default function DetailView({ entry, onBack, onDeleted, onUpdated, userId }) {
  const [lb,      setLb]      = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting,setDel]     = useState(false);

  // Edit state
  const [editTitle, setET]  = useState(entry.title);
  const [editNotes, setEN]  = useState(entry.notes||'');
  const [editDiff,  setED]  = useState(entry.difficulty||'Medium');
  const [editImgs,  setEI]  = useState(entry.images||[]);
  const [newImgs,   setNI]  = useState([]);
  const [saving,    setSaving] = useState(false);
  const [err,       setErr]   = useState('');
  const [hlEditOn,  setHEOn]  = useState(false);

  // View highlight state
  const [viewHL,   setVHL]   = useState(entry.highlights||[]);
  const [hlViewOn, setHVOn]  = useState(false);

  const editTaRef = useRef();
  const notesRef  = useRef();

  // Highlight hooks
  const editHl = useHighlight(editTaRef, entry.highlights||[]);

  const color = SYS_COLOR[entry.system]||'#2563eb';
  const dc    = DIFF_COLOR[entry.difficulty]||'#6b7280';
  const fmt   = iso => new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  const updateDB = async fields => {
    const {data,error} = await supabase.from('entries').update(fields).eq('id',entry.id).select().single();
    if (!error) onUpdated(data);
    return !error;
  };

  const markReviewed = () => updateDB({
    review_count:(entry.review_count||0)+1,
    last_reviewed:new Date().toISOString()
  });
  const togglePin = () => updateDB({ pinned:!entry.pinned });

  const deleteEntry = async () => {
    if (!window.confirm('Delete this entry?')) return;
    setDel(true);
    await supabase.from('entries').delete().eq('id',entry.id);
    onDeleted(entry.id,entry.system);
  };

  const exportPDF = () => {
    const win = window.open('','_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${entry.title}</title>
    <style>body{font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#1f2937}
    h1{font-size:20px;margin-bottom:8px}.meta{font-size:12px;color:#6b7280;margin-bottom:16px}
    .notes{font-size:14px;line-height:1.8;white-space:pre-wrap;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px}
    img{max-width:100%;margin:10px 0;border-radius:6px;display:block}
    .back{display:inline-block;margin-bottom:20px;padding:8px 16px;background:#f3f4f6;
    border:1px solid #e5e7eb;border-radius:8px;font-size:13px;cursor:pointer;color:#374151;font-weight:600}
    @media print{.back{display:none}body{padding:0}}</style></head><body>
    <a class="back" onclick="window.close()">← Close & Go Back</a>
    <div class="meta">${entry.system} · ${entry.difficulty} · ${fmt(entry.created_at)}</div>
    <h1>${entry.title}</h1><div class="notes">${entry.notes||''}</div>
    ${(entry.images||[]).map(u=>`<img src="${u}"/>`).join('')}
    </body></html>`);
    win.document.close(); win.focus();
    setTimeout(()=>{ win.print(); win.onafterprint=()=>win.close(); },600);
  };

  const loadNewImgs = files => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => setNI(p=>[...p,{preview:e.target.result,file:f}]);
      r.readAsDataURL(f);
    });
  };

  const uploadImg = async img => {
    const ext = img.file.name.split('.').pop()||'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const {error} = await supabase.storage.from('entry-images').upload(path,img.file,{contentType:img.file.type});
    if (error) throw error;
    return supabase.storage.from('entry-images').getPublicUrl(path).data.publicUrl;
  };

  // View-mode DOM-based highlight
  const applyViewHL = c => {
    const sel = window.getSelection();
    if (!sel||sel.isCollapsed||!notesRef.current) return;
    const range = sel.getRangeAt(0);
    if (!notesRef.current.contains(range.commonAncestorContainer)) return;
    const pre = document.createRange();
    pre.selectNodeContents(notesRef.current);
    pre.setEnd(range.startContainer,range.startOffset);
    const start=pre.toString().length, end=start+range.toString().length;
    if (start>=end) return;
    const newHl = [...viewHL,{start,end,color:c}];
    setVHL(newHl); sel.removeAllRanges();
    supabase.from('entries').update({highlights:newHl}).eq('id',entry.id).then(()=>{});
    onUpdated({...entry,highlights:newHl});
  };

  const removeViewHL = () => {
    const sel = window.getSelection(); let newHl = [];
    if (sel&&!sel.isCollapsed&&notesRef.current) {
      const range=sel.getRangeAt(0);
      if (notesRef.current.contains(range.commonAncestorContainer)) {
        const pre=document.createRange();
        pre.selectNodeContents(notesRef.current);
        pre.setEnd(range.startContainer,range.startOffset);
        const start=pre.toString().length,end=start+range.toString().length;
        newHl=viewHL.filter(h=>!(h.start<end&&h.end>start));
      }
    }
    setVHL(newHl);
    supabase.from('entries').update({highlights:newHl}).eq('id',entry.id).then(()=>{});
    onUpdated({...entry,highlights:newHl});
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) { setErr('Title required'); return; }
    setSaving(true); setErr('');
    try {
      const newUrls = await Promise.all(newImgs.map(uploadImg));
      const allImgs = [...editImgs,...newUrls];
      const ok = await updateDB({
        title:editTitle.trim(), notes:editNotes.trim(),
        difficulty:editDiff, images:allImgs, highlights:editHl.highlights
      });
      if (ok) { setVHL(editHl.highlights); setEditing(false); setNI([]); }
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const cancelEdit = () => {
    setEditing(false); setET(entry.title); setEN(entry.notes||'');
    setED(entry.difficulty||'Medium'); setEI(entry.images||[]);
    editHl.setHighlights(entry.highlights||[]);
    setNI([]); setErr(''); setHEOn(false);
  };

  // ── EDIT MODE ──────────────────────────────────────────────────────────
  if (editing) return (
    <div style={{maxWidth:680,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      <div style={{fontSize:15,fontWeight:700,color:'#111827',marginBottom:20}}>
        Editing — <span style={{color}}>{entry.system}</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        <F label="TITLE *">
          <input value={editTitle} onChange={e=>setET(e.target.value)} style={inp} autoFocus />
        </F>
        <F label="DIFFICULTY">
          <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
            {DIFFICULTY.map(d=>(
              <button key={d} onClick={()=>setED(d)} style={{
                padding:'7px 16px',borderRadius:6,
                border:`1px solid ${editDiff===d?DIFF_COLOR[d]:'#e5e7eb'}`,
                cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'Inter,sans-serif',
                background:editDiff===d?`${DIFF_COLOR[d]}12`:'#fff',
                color:editDiff===d?DIFF_COLOR[d]:'#6b7280'}}>{d}</button>
            ))}
          </div>
        </F>
        <F label="REVIEW NOTES">
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
            <button
              onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
              onClick={()=>setHEOn(p=>!p)}
              style={{fontSize:11,background:hlEditOn?'#fef9c3':'#f3f4f6',
                border:`1px solid ${hlEditOn?'#fde68a':'#e5e7eb'}`,
                borderRadius:5,padding:'4px 10px',cursor:'pointer',
                color:hlEditOn?'#92400e':'#6b7280',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              🖊 {hlEditOn?'On':'Highlight'}
            </button>
            {editHl.highlights.length>0 && <span style={{fontSize:11,color:'#9ca3af'}}>{editHl.highlights.length} highlights</span>}
          </div>
          {hlEditOn && <HLToolbar onApply={editHl.applyHL} onRemove={editHl.removeHL} hasSelection={editHl.hasSel} />}
          <textarea ref={editTaRef} value={editNotes}
            onChange={e=>{ editHl.handleTextChange(editNotes,e.target.value); setEN(e.target.value); }}
            onSelect={editHl.onSelChange} onMouseUp={editHl.onSelChange}
            onKeyUp={editHl.onSelChange} onTouchEnd={editHl.onSelChange}
            rows={8} style={{...inp,resize:'vertical',lineHeight:1.7}} />
        </F>
        {editImgs.length>0 && (
          <F label="EXISTING IMAGES">
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:8}}>
              {editImgs.map((url,i)=>(
                <div key={i} style={{position:'relative'}}>
                  <img src={url} alt="" style={{width:100,height:76,objectFit:'cover',borderRadius:7,border:'1px solid #e5e7eb'}} />
                  <button onClick={()=>setEI(p=>p.filter((_,j)=>j!==i))} style={{
                    position:'absolute',top:-7,right:-7,background:'#dc2626',border:'none',
                    borderRadius:'50%',width:20,height:20,fontSize:10,color:'#fff',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                </div>
              ))}
            </div>
          </F>
        )}
        <F label="ADD MORE IMAGES">
          <label style={{display:'inline-block',marginTop:8,background:'#f3f4f6',
            border:'1px solid #e5e7eb',borderRadius:7,padding:'8px 16px',
            fontSize:13,cursor:'pointer',fontWeight:500,color:'#374151',fontFamily:'Inter,sans-serif'}}>
            📷 Choose images
            <input type="file" accept="image/*" multiple style={{display:'none'}}
              onChange={e=>loadNewImgs(e.target.files)} />
          </label>
          {newImgs.length>0 && (
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:10}}>
              {newImgs.map((img,i)=>(
                <div key={i} style={{position:'relative'}}>
                  <img src={img.preview} alt="" style={{width:100,height:76,objectFit:'cover',borderRadius:7,border:'1px solid #e5e7eb'}} />
                  <button onClick={()=>setNI(p=>p.filter((_,j)=>j!==i))} style={{
                    position:'absolute',top:-7,right:-7,background:'#dc2626',border:'none',
                    borderRadius:'50%',width:20,height:20,fontSize:10,color:'#fff',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </F>
        {err && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'10px 14px',fontSize:13,color:'#dc2626'}}>{err}</div>}
        <div style={{display:'flex',gap:10}}>
          <button onClick={saveEdit} disabled={saving} style={{
            background:color,color:'#fff',border:'none',borderRadius:8,padding:'11px 24px',
            fontSize:14,fontWeight:600,cursor:saving?'not-allowed':'pointer',
            opacity:saving?.7:1,fontFamily:'Inter,sans-serif'}}>
            {saving?'Saving…':'✓ Save Changes'}
          </button>
          <button onClick={cancelEdit} style={{background:'#f3f4f6',color:'#6b7280',
            border:'1px solid #e5e7eb',borderRadius:8,padding:'11px 20px',
            fontSize:14,cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── VIEW MODE ──────────────────────────────────────────────────────────
  return (
    <div style={{maxWidth:680,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      {lb!==null && <Lightbox images={entry.images} start={lb} onClose={()=>setLb(null)} />}

      <button onClick={onBack} style={{background:'none',border:'none',color:'#6b7280',
        cursor:'pointer',fontSize:13,padding:0,marginBottom:16,
        display:'flex',alignItems:'center',gap:4,fontWeight:500,fontFamily:'Inter,sans-serif'}}>
        ← Back to {entry.system}
      </button>

      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
        padding:20,marginBottom:14,borderTop:`3px solid ${color}`,
        boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
        <div style={{fontSize:18,fontWeight:700,color:'#111827',lineHeight:1.4,marginBottom:12}}>
          {entry.title}{entry.pinned&&' 📌'}
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:11,fontWeight:500,background:`${dc}12`,color:dc,
            borderRadius:4,padding:'2px 8px',border:`1px solid ${dc}25`}}>{entry.difficulty}</span>
          <span style={{fontSize:12,color:'#9ca3af'}}>{fmt(entry.created_at)}</span>
          {entry.review_count>0 && (
            <span style={{fontSize:12,color:'#16a34a',fontWeight:600}}>
              ✓ Reviewed {entry.review_count}×{entry.last_reviewed&&` · Last: ${fmt(entry.last_reviewed)}`}
            </span>
          )}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <AB color="#16a34a" bg="#f0fdf4" border="#bbf7d0" onClick={markReviewed}>✓ Reviewed</AB>
          <AB color="#2563eb" bg="#eff6ff" border="#bfdbfe" onClick={()=>setEditing(true)}>✎ Edit</AB>
          <AB color={entry.pinned?'#d97706':'#374151'} bg={entry.pinned?'#fffbeb':'#f9fafb'}
            border={entry.pinned?'#fde68a':'#e5e7eb'} onClick={togglePin}>
            {entry.pinned?'📌 Unpin':'📌 Pin'}
          </AB>
          <AB color="#374151" bg="#f9fafb" border="#e5e7eb" onClick={exportPDF}>⬇ PDF</AB>
          <AB color="#dc2626" bg="#fef2f2" border="#fecaca" onClick={deleteEntry} disabled={deleting}>
            {deleting?'…':'Delete'}
          </AB>
        </div>
      </div>

      {entry.notes && (
        <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
          padding:'18px 20px',marginBottom:14,boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
            marginBottom:12,flexWrap:'wrap',gap:8}}>
            <div style={{fontSize:10,color:'#9ca3af',letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>
              Review Notes
            </div>
            <button
              onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
              onClick={()=>setHVOn(p=>!p)}
              style={{fontSize:11,background:hlViewOn?'#fef9c3':'#f3f4f6',
                border:`1px solid ${hlViewOn?'#fde68a':'#e5e7eb'}`,
                borderRadius:5,padding:'3px 10px',cursor:'pointer',
                color:hlViewOn?'#92400e':'#6b7280',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              🖊 {hlViewOn?'Done':'Highlight'}
            </button>
          </div>
          {hlViewOn && (
            <>
              <HLToolbar onApply={applyViewHL} onRemove={removeViewHL} hasSelection={true} />
              <div style={{fontSize:11,color:'#9ca3af',marginBottom:8}}>
                Select text then tap a colour. Saves automatically.
              </div>
            </>
          )}
          <div ref={notesRef} style={{lineHeight:1.85,fontSize:14,color:'#1f2937',
            userSelect:hlViewOn?'text':'auto'}}>
            <RenderedNotes text={entry.notes} highlights={viewHL} />
          </div>
        </div>
      )}

      {entry.images?.length>0 && (
        <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
          padding:'18px 20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{fontSize:10,color:'#9ca3af',letterSpacing:.8,fontWeight:600,
            textTransform:'uppercase',marginBottom:14}}>
            Images ({entry.images.length}) — scroll · tap to expand
          </div>
          <div style={{display:'flex',gap:10,overflowX:'auto',
            WebkitOverflowScrolling:'touch',paddingBottom:8,scrollSnapType:'x mandatory'}}>
            {entry.images.map((url,i)=>(
              <img key={i} src={url} alt="" onClick={()=>setLb(i)}
                style={{height:180,width:'auto',maxWidth:'80vw',flexShrink:0,
                  borderRadius:8,border:'1px solid #e5e7eb',cursor:'pointer',
                  objectFit:'contain',background:'#f9fafb',scrollSnapAlign:'start'}} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AB({onClick,children,color,bg,border,disabled}) {
  return <button onClick={onClick} disabled={disabled} style={{background:bg,
    border:`1px solid ${border}`,color,borderRadius:7,padding:'8px 16px',fontSize:13,
    cursor:disabled?'not-allowed':'pointer',fontWeight:600,fontFamily:'Inter,sans-serif',
    opacity:disabled?.6:1}}>{children}</button>;
}
function F({label,children}) {
  return <div>
    <div style={{fontSize:10,color:'#9ca3af',letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>{label}</div>
    {children}
  </div>;
}
const inp={display:'block',width:'100%',marginTop:8,background:'#fff',
  border:'1px solid #d1d5db',borderRadius:8,color:'#111827',padding:'10px 12px',
  fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'Inter,sans-serif'};
