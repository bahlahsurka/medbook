import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR, DIFFICULTY } from '../lib/constants';
import { HL_COLORS, HLToolbar, renderHighlighted, adjustHighlights } from '../lib/highlights';

function Lightbox({ images, start, onClose }) {
  const [idx, setIdx] = useState(start);
  const tx = useRef(null);
  const prev = () => setIdx(i=>(i-1+images.length)%images.length);
  const next = () => setIdx(i=>(i+1)%images.length);
  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.9)',
      zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}
      onTouchStart={e=>{tx.current=e.touches[0].clientX;}}
      onTouchEnd={e=>{if(!tx.current)return;const dx=e.changedTouches[0].clientX-tx.current;if(dx<-50)next();else if(dx>50)prev();tx.current=null;}}>
      <div onClick={onClose} style={{position:'absolute',top:16,right:20,color:'#fff',fontSize:26,cursor:'pointer'}}>✕</div>
      {images.length>1&&<><div onClick={e=>{e.stopPropagation();prev();}} style={{position:'absolute',left:12,color:'#fff',fontSize:32,cursor:'pointer',padding:'8px 14px',background:'rgba(0,0,0,.3)',borderRadius:8,userSelect:'none'}}>‹</div>
      <div onClick={e=>{e.stopPropagation();next();}} style={{position:'absolute',right:12,color:'#fff',fontSize:32,cursor:'pointer',padding:'8px 14px',background:'rgba(0,0,0,.3)',borderRadius:8,userSelect:'none'}}>›</div></>}
      {images.length>1&&<div style={{position:'absolute',top:18,left:'50%',transform:'translateX(-50%)',color:'#fff',fontSize:13,background:'rgba(0,0,0,.4)',padding:'4px 12px',borderRadius:20}}>{idx+1}/{images.length}</div>}
      <img src={images[idx]} alt="" onClick={e=>e.stopPropagation()}
        style={{maxWidth:'90vw',maxHeight:'85vh',borderRadius:8,objectFit:'contain'}} />
    </div>
  );
}

export default function DetailView({ entry, onBack, onDeleted, onUpdated, userId }) {
  const [lb, setLb]           = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDel]    = useState(false);

  // Edit state — initialise from entry, highlights preserved
  const [editTitle, setET]  = useState(entry.title);
  const [editNotes, setEN]  = useState(entry.notes||'');
  const [editDiff, setED]   = useState(entry.difficulty||'Medium');
  const [editImgs, setEI]   = useState(entry.images||[]);
  const [editHL, setEHL]    = useState(entry.highlights||[]); // KEY: starts from existing
  const [newImgs, setNI]    = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [hlEditMode, setHEM]= useState(false);

  // View highlight state
  const [viewHL, setVHL]    = useState(entry.highlights||[]);
  const [hlMode, setHlMode] = useState(false);
  const notesRef = useRef();
  const editTaRef = useRef();

  const color = SYS_COLOR[entry.system]||'#2563eb';
  const dc    = DIFF_COLOR[entry.difficulty]||'#6b7280';
  const fmt   = iso => new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  const updateDB = async (fields) => {
    const { data, error } = await supabase.from('entries').update(fields)
      .eq('id',entry.id).select().single();
    if (!error) onUpdated(data);
    return !error;
  };

  const markReviewed = () => updateDB({
    review_count:(entry.review_count||0)+1,
    last_reviewed:new Date().toISOString()
  });

  const togglePin = () => updateDB({ pinned: !entry.pinned });

  const deleteEntry = async () => {
    if (!window.confirm('Delete this entry?')) return;
    setDel(true);
    await supabase.from('entries').delete().eq('id',entry.id);
    onDeleted(entry.id, entry.system);
  };

  const exportPDF = () => {
    const win = window.open('','_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${entry.title}</title>
    <style>body{font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#1f2937}
    h1{font-size:20px;margin-bottom:8px}.meta{font-size:12px;color:#6b7280;margin-bottom:16px}
    .notes{font-size:14px;line-height:1.8;white-space:pre-wrap;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px}
    img{max-width:100%;margin:10px 0;border-radius:6px;display:block}
    @media print{body{padding:0}}</style></head><body>
    <div class="meta">${entry.system} · ${entry.difficulty} · ${fmt(entry.created_at)}</div>
    <h1>${entry.title}</h1>
    <div class="notes">${entry.notes||''}</div>
    ${(entry.images||[]).map(u=>`<img src="${u}" />`).join('')}
    </body></html>`);
    win.document.close(); win.focus();
    setTimeout(()=>win.print(), 600);
  };

  const loadNewImgs = (files) => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => setNI(p=>[...p,{preview:e.target.result,file:f}]);
      r.readAsDataURL(f);
    });
  };

  const uploadImg = async (img) => {
    const ext = img.file.name.split('.').pop()||'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const {error} = await supabase.storage.from('entry-images')
      .upload(path,img.file,{contentType:img.file.type});
    if (error) throw error;
    return supabase.storage.from('entry-images').getPublicUrl(path).data.publicUrl;
  };

  // Highlight in edit mode via textarea selection
  const applyEditHL = (c) => {
    const ta = editTaRef.current;
    if (!ta) return;
    const s=ta.selectionStart, e=ta.selectionEnd;
    if (s===e) return;
    setEHL(p=>[...p,{start:s,end:e,color:c}]);
  };
  const removeEditHL = () => {
    const ta = editTaRef.current;
    if (!ta) return;
    const s=ta.selectionStart, e=ta.selectionEnd;
    if (s===e) { setEHL([]); return; }
    setEHL(p=>p.filter(h=>!(h.start<e&&h.end>s)));
  };

  // When notes text changes in edit, preserve valid highlights
  const handleEditNotesChange = (val) => {
    setEHL(prev => adjustHighlights(editNotes, val, prev));
    setEN(val);
  };

  // Highlight in view mode via DOM selection
  const applyViewHL = (c) => {
    const sel = window.getSelection();
    if (!sel||sel.isCollapsed||!notesRef.current) return;
    const range = sel.getRangeAt(0);
    if (!notesRef.current.contains(range.commonAncestorContainer)) return;
    const pre = document.createRange();
    pre.selectNodeContents(notesRef.current);
    pre.setEnd(range.startContainer,range.startOffset);
    const start = pre.toString().length;
    const end   = start + range.toString().length;
    const newHl = [...viewHL,{start,end,color:c}];
    setVHL(newHl); sel.removeAllRanges();
    supabase.from('entries').update({highlights:newHl}).eq('id',entry.id).then(()=>{});
    onUpdated({...entry,highlights:newHl});
  };
  const removeViewHL = () => {
    const sel = window.getSelection();
    let newHl = [];
    if (sel&&!sel.isCollapsed&&notesRef.current) {
      const range = sel.getRangeAt(0);
      if (notesRef.current.contains(range.commonAncestorContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(notesRef.current);
        pre.setEnd(range.startContainer,range.startOffset);
        const start = pre.toString().length;
        const end   = start + range.toString().length;
        newHl = viewHL.filter(h=>!(h.start<end&&h.end>start));
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
      // IMPORTANT: save editHL which preserves existing highlights
      const ok = await updateDB({
        title: editTitle.trim(),
        notes: editNotes.trim(),
        difficulty: editDiff,
        images: allImgs,
        highlights: editHL,   // highlights preserved through edit
      });
      if (ok) {
        setVHL(editHL);       // sync view highlights
        setEditing(false);
        setNI([]);
      }
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const cancelEdit = () => {
    // Reset edit state back to current entry values
    setEditing(false);
    setET(entry.title);
    setEN(entry.notes||'');
    setED(entry.difficulty||'Medium');
    setEI(entry.images||[]);
    setEHL(entry.highlights||[]);
    setNI([]);
    setErr('');
    setHEM(false);
  };

  // ── EDIT MODE ────────────────────────────────────────────────────────────
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
            <button onClick={()=>setHEM(p=>!p)} style={{
              fontSize:11, background:hlEditMode?'#fef9c3':'#f3f4f6',
              border:`1px solid ${hlEditMode?'#fde68a':'#e5e7eb'}`,
              borderRadius:5,padding:'4px 10px',cursor:'pointer',
              color:hlEditMode?'#92400e':'#6b7280',fontWeight:600,fontFamily:'Inter,sans-serif'
            }}>🖊 {hlEditMode?'Highlighting on':'Highlight text'}</button>
            {hlEditMode && <HLToolbar onApply={applyEditHL} onRemove={removeEditHL} compact />}
            {editHL.length>0&&<span style={{fontSize:11,color:'#9ca3af'}}>{editHL.length} highlight{editHL.length!==1?'s':''}</span>}
          </div>
          {hlEditMode&&<div style={{fontSize:11,color:'#9ca3af',marginBottom:6}}>Select text below then tap a colour.</div>}
          <textarea
            ref={editTaRef}
            value={editNotes}
            onChange={e=>handleEditNotesChange(e.target.value)}
            rows={8}
            style={{...inp,resize:'vertical',lineHeight:1.7}}
          />
        </F>

        {editImgs.length>0 && (
          <F label="EXISTING IMAGES — tap ✕ to remove">
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
          {newImgs.length>0&&(
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

        {err&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'10px 14px',fontSize:13,color:'#dc2626'}}>{err}</div>}

        <div style={{display:'flex',gap:10}}>
          <button onClick={saveEdit} disabled={saving} style={{
            background:color,color:'#fff',border:'none',borderRadius:8,
            padding:'11px 24px',fontSize:14,fontWeight:600,
            cursor:saving?'not-allowed':'pointer',opacity:saving?.7:1,fontFamily:'Inter,sans-serif'}}>
            {saving?'Saving…':'✓ Save Changes'}
          </button>
          <button onClick={cancelEdit} style={{background:'#f3f4f6',color:'#6b7280',
            border:'1px solid #e5e7eb',borderRadius:8,padding:'11px 20px',
            fontSize:14,cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── VIEW MODE ────────────────────────────────────────────────────────────
  return (
    <div style={{maxWidth:680,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      {lb!==null&&<Lightbox images={entry.images} start={lb} onClose={()=>setLb(null)} />}

      <button onClick={onBack} style={{background:'none',border:'none',color:'#6b7280',
        cursor:'pointer',fontSize:13,padding:0,marginBottom:16,
        display:'flex',alignItems:'center',gap:4,fontWeight:500,fontFamily:'Inter,sans-serif'}}>
        ← Back to {entry.system}
      </button>

      {/* Title card */}
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
        padding:20,marginBottom:14,borderTop:`3px solid ${color}`,
        boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
        <div style={{fontSize:18,fontWeight:700,color:'#111827',lineHeight:1.4,marginBottom:12}}>
          {entry.title} {entry.pinned&&'📌'}
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:11,fontWeight:500,background:`${dc}12`,color:dc,
            borderRadius:4,padding:'2px 8px',border:`1px solid ${dc}25`}}>{entry.difficulty}</span>
          <span style={{fontSize:12,color:'#9ca3af'}}>{fmt(entry.created_at)}</span>
          {entry.review_count>0&&(
            <span style={{fontSize:12,color:'#16a34a',fontWeight:600}}>
              ✓ Reviewed {entry.review_count}×{entry.last_reviewed&&` · Last: ${fmt(entry.last_reviewed)}`}
            </span>
          )}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <ActionBtn color="#16a34a" bg="#f0fdf4" border="#bbf7d0" onClick={markReviewed}>✓ Reviewed</ActionBtn>
          <ActionBtn color="#2563eb" bg="#eff6ff" border="#bfdbfe" onClick={()=>{setEditing(true);setEHL(entry.highlights||[]);}}>✎ Edit</ActionBtn>
          <ActionBtn color={entry.pinned?'#d97706':'#374151'} bg={entry.pinned?'#fffbeb':'#f9fafb'}
            border={entry.pinned?'#fde68a':'#e5e7eb'} onClick={togglePin}>
            {entry.pinned?'📌 Unpin':'📌 Pin'}
          </ActionBtn>
          <ActionBtn color="#374151" bg="#f9fafb" border="#e5e7eb" onClick={exportPDF}>⬇ PDF</ActionBtn>
          <ActionBtn color="#dc2626" bg="#fef2f2" border="#fecaca" onClick={deleteEntry} disabled={deleting}>
            {deleting?'…':'Delete'}
          </ActionBtn>
        </div>
      </div>

      {/* Notes */}
      {entry.notes&&(
        <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
          padding:'18px 20px',marginBottom:14,boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
            marginBottom:12,flexWrap:'wrap',gap:8}}>
            <div style={{fontSize:10,color:'#9ca3af',letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>
              Review Notes
            </div>
            <button onClick={()=>setHlMode(p=>!p)} style={{
              fontSize:11,background:hlMode?'#fef9c3':'#f3f4f6',
              border:`1px solid ${hlMode?'#fde68a':'#e5e7eb'}`,
              borderRadius:5,padding:'3px 10px',cursor:'pointer',
              color:hlMode?'#92400e':'#6b7280',fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              🖊 {hlMode?'Done':'Highlight'}
            </button>
          </div>
          {hlMode&&<><HLToolbar onApply={applyViewHL} onRemove={removeViewHL} />
            <div style={{fontSize:11,color:'#9ca3af',marginBottom:8}}>Select text then tap a colour. Saves automatically.</div></>}
          <div ref={notesRef} style={{lineHeight:1.85,fontSize:14,color:'#1f2937',userSelect:hlMode?'text':'auto'}}>
            {renderHighlighted(entry.notes, viewHL)}
          </div>
        </div>
      )}

      {/* Images */}
      {entry.images?.length>0&&(
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

function ActionBtn({onClick,children,color,bg,border,disabled}) {
  return <button onClick={onClick} disabled={disabled} style={{background:bg,border:`1px solid ${border}`,
    color,borderRadius:7,padding:'8px 16px',fontSize:13,cursor:disabled?'not-allowed':'pointer',
    fontWeight:600,fontFamily:'Inter,sans-serif',opacity:disabled?.6:1}}>{children}</button>;
}
function F({label,children}) {
  return <div>
    <div style={{fontSize:10,color:'#9ca3af',letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>{label}</div>
    {children}
  </div>;
}
const inp={display:'block',width:'100%',marginTop:8,background:'#fff',border:'1px solid #d1d5db',
  borderRadius:8,color:'#111827',padding:'10px 12px',fontSize:14,outline:'none',
  boxSizing:'border-box',fontFamily:'Inter,sans-serif'};
