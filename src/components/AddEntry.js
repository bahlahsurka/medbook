import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';
import { buildHighlightParts, resolveHL } from '../lib/highlights';
import { useHighlight } from '../lib/useHighlight';
import { useTheme } from '../lib/theme';
import HLToolbar from './HLToolbar';
import AIService from '../services/ai';

const DRAFT_KEY = 'medbook_draft_v2';
const loadDraft = sys => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')[sys]||null; } catch { return null; } };
const saveDraft = (sys,d) => { try { const o=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}'); o[sys]=d; localStorage.setItem(DRAFT_KEY,JSON.stringify(o)); } catch {} };
const clearDraft = sys => { try { const o=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}'); delete o[sys]; localStorage.setItem(DRAFT_KEY,JSON.stringify(o)); } catch {} };

// Overlay that renders highlight colours *behind* the textarea's own (always-opaque) text.
// Stable field-label wrapper. MUST live at module scope — if it were defined
// inside the component it would be a new function every render, remounting the
// inputs on each keystroke and stealing focus.
function F({ label, children }) {
  const { t } = useTheme();
  return (
    <div>
      <div style={{fontSize:10,color:t.text4,letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>{label}</div>
      {children}
    </div>
  );
}

const HighlightOverlay = React.forwardRef(function HighlightOverlay({ text, highlights, isDark }, ref) {
  const parts = buildHighlightParts(text + '\n', highlights);
  return (
    <div ref={ref} aria-hidden="true" style={{
      position:'absolute', inset:0, pointerEvents:'none',
      whiteSpace:'pre-wrap', wordBreak:'normal', overflowWrap:'break-word',
      fontSize:14, lineHeight:'1.7', padding:'10px 12px',
      fontFamily:'Inter,sans-serif', boxSizing:'border-box',
      border:'1px solid transparent',
      color:'transparent', overflow:'hidden'
    }}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}>{p.t}</span>;
        const c = resolveHL(p.hl, isDark);
        // color stays transparent — the real (always-opaque) textarea text shows through.
        return <mark key={i} style={{background:c.bg,color:'transparent',borderRadius:2,padding:'0 1px'}}>{p.t}</mark>;
      })}
    </div>
  );
});

export default function AddEntry({ activeSystem, color, userId, onSaved, onCancel, userSystems }) {
  const { t, isDark } = useTheme();
  const draft = loadDraft(activeSystem);
  const [title,     setTitle]   = useState(draft?.title     || '');
  const [notes,     setNotes]   = useState(draft?.notes     || '');
  const [difficulty,setDiff]    = useState(draft?.difficulty|| 'Medium');
  const [systems,   setSystems] = useState(draft?.systems?.length ? draft.systems : [activeSystem]);
  const [images,    setImages]  = useState([]);
  const [saving,    setSaving]  = useState(false);
  const [saveStatus,setSS]      = useState('');
  const [err,       setErr]     = useState('');
  const [sysOpen,   setSysOpen] = useState(false);
  const [dragOver,  setDrag]    = useState(false);
  const [hlMode,    setHlMode]  = useState(false);

  const fileRef = useRef(); const galRef = useRef(); const taRef = useRef(); const overlayRef = useRef();
  // Synchronous duplicate-submit guard (setSaving is async; two fast clicks can race).
  const saveInFlight = useRef(false);
  const hl = useHighlight(taRef, draft?.highlights || []);

  const inp = {
    display:'block', width:'100%', marginTop:8, background:t.surface,
    border:`1px solid ${t.borderStrong}`, borderRadius:8, color:t.text,
    padding:'10px 12px', fontSize:14, outline:'none', boxSizing:'border-box',
    fontFamily:'Inter,sans-serif'
  };

  const syncOverlayScroll = useCallback(() => {
    if (overlayRef.current && taRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop;
      overlayRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  useEffect(() => {
    saveDraft(activeSystem, { title, notes, difficulty, systems, highlights: hl.highlights });
  }, [title, notes, difficulty, systems, hl.highlights, activeSystem]);

  const toggleSys = n => setSystems(p => p.includes(n) ? p.filter(s=>s!==n) : [...p,n]);

  const loadFiles = useCallback(files => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => setImages(p=>[...p,{preview:e.target.result,file:f}]);
      r.readAsDataURL(f);
    });
  }, []);

  const uploadImg = async img => {
    const ext = img.file.name.split('.').pop()||'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const {error} = await supabase.storage.from('entry-images').upload(path,img.file,{contentType:img.file.type});
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return supabase.storage.from('entry-images').getPublicUrl(path).data.publicUrl;
  };

  const save = async (alsoAnalyze = false) => {
    if (saveInFlight.current) return;   // ignore repeat clicks while saving
    setErr('');
    // Validate BEFORE claiming the lock, so a validation bail-out can't leave
    // the button permanently jammed.
    if (!title.trim()) { setErr('Title is required'); return; }
    if (!systems.length) { setErr('Select at least one system'); return; }
    saveInFlight.current = true;
    setSaving(true);
    try {
      let urls = [];
      if (images.length > 0) { setSS('Uploading images…'); urls = await Promise.all(images.map(uploadImg)); }
      setSS('Saving…');
      const rows = systems.map(sys => ({
        user_id:userId, system:sys, title:title.trim(), notes:notes.trim(),
        difficulty, images:urls, highlights:hl.highlights,
        pinned:false, review_count:0, last_reviewed:null
      }));
      const {data,error} = await supabase.from('entries').insert(rows).select();
      if (error) throw new Error(`Save failed: ${error.message}`);

      let saved = data;
      if (alsoAnalyze) {
        // Entry is already safely saved. If analysis fails we keep the entry and
        // simply report it — notes are never at risk.
        setSS('Analyzing…');
        try {
          const sections = await AIService.analyzeReview(notes.trim());
          const payload = {
            ai_sections: sections,
            ai_generated_at: new Date().toISOString(),
            ai_model: AIService.activeModel(),
          };
          const ids = data.map(d => d.id);
          const { error: aiErr } = await supabase.from('entries').update(payload).in('id', ids);
          if (aiErr) throw new Error(aiErr.message);
          saved = data.map(d => ({ ...d, ...payload }));
        } catch (e) {
          setSS('');
          setErr(`Entry saved, but analysis failed: ${e.message}`);
          setSaving(false);
          setTimeout(() => onSaved(data), 1200);   // still hand back the saved entry
          return;
        }
      }

      setSS('Saved ✓');
      clearDraft(activeSystem);
      onSaved(saved);
    } catch(e) { setErr(e.message); setSaving(false); setSS(''); }
    finally { saveInFlight.current = false; }
  };

  const hasDraft = !!(draft?.title||draft?.notes);

  return (
    <div style={{maxWidth:680,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:700,color:t.text}}>New Entry</div>
        {hasDraft && <span style={{fontSize:11,background:t.hlBtnBg,color:t.hlBtnText,
          borderRadius:5,padding:'2px 8px',fontWeight:600,border:`1px solid ${t.hlBtnBorder}`}}>
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
              {systems.map(s => {
                const sys = (userSystems||[]).find(u=>u.name===s);
                const c = sys?.color||'#2563eb';
                return (
                  <span key={s} onClick={()=>!saving&&toggleSys(s)} style={{
                    display:'flex',alignItems:'center',gap:5,fontSize:12,fontWeight:600,
                    background:`${c}1f`,color:c,border:`1px solid ${c}55`,
                    borderRadius:5,padding:'3px 10px',cursor:saving?'default':'pointer'
                  }}>{s}{!saving&&<span style={{fontSize:10}}>✕</span>}</span>
                );
              })}
              {!saving && <button onClick={()=>setSysOpen(p=>!p)} style={{
                fontSize:12,background:t.surface3,border:`1px solid ${t.border}`,
                borderRadius:5,padding:'3px 12px',cursor:'pointer',
                color:t.text2,fontWeight:600,fontFamily:'Inter,sans-serif'
              }}>{sysOpen?'▲ Close':'+ Add System'}</button>}
            </div>
            {sysOpen && !saving && (
              <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,
                padding:12,display:'flex',flexWrap:'wrap',gap:6,
                maxHeight:200,overflowY:'auto',boxShadow:`0 4px 12px ${t.shadow}`}}>
                {(userSystems||[]).map(s => {
                  const sel = systems.includes(s.name); const c = s.color||'#2563eb';
                  return (
                    <button key={s.name} onClick={()=>toggleSys(s.name)} style={{
                      fontSize:12,fontWeight:sel?600:400,
                      background:sel?`${c}1f`:t.surface2,color:sel?c:t.text2,
                      border:`1px solid ${sel?c+'66':t.border}`,
                      borderRadius:5,padding:'5px 12px',cursor:'pointer',fontFamily:'Inter,sans-serif'
                    }}>{s.name}</button>
                  );
                })}
              </div>
            )}
          </div>
        </F>

        <F label="DIFFICULTY">
          <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={()=>!saving&&setDiff(d)} style={{
                padding:'7px 16px',borderRadius:6,
                border:`1px solid ${difficulty===d?DIFF_COLOR[d]:t.border}`,
                cursor:saving?'default':'pointer',fontSize:13,fontWeight:600,
                background:difficulty===d?`${DIFF_COLOR[d]}1f`:t.surface,
                color:difficulty===d?DIFF_COLOR[d]:t.text3,fontFamily:'Inter,sans-serif'
              }}>{d}</button>
            ))}
          </div>
        </F>

        <F label="REVIEW NOTES">
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
            <button
              onMouseDown={e=>e.preventDefault()}
              onTouchStart={e=>e.preventDefault()}
              onClick={()=>setHlMode(p=>!p)}
              style={{
                fontSize:11,background:hlMode?t.hlBtnBg:t.surface3,
                border:`1px solid ${hlMode?t.hlBtnBorder:t.border}`,
                borderRadius:5,padding:'4px 10px',cursor:'pointer',
                color:hlMode?t.hlBtnText:t.text3,fontWeight:600,fontFamily:'Inter,sans-serif'
              }}>🖊 {hlMode?'Highlighting on':'Highlight'}</button>
            {hl.highlights.length>0 && (
              <span style={{fontSize:11,color:t.text4}}>
                {hl.highlights.length} highlight{hl.highlights.length!==1?'s':''}
              </span>
            )}
          </div>

          {hlMode && (
            <HLToolbar
              onApply={hl.applyHL}
              onRemove={hl.removeHL}
              onClearAll={hl.clearAllHL}
              hasSelection={hl.hasSel}
            />
          )}

          <div style={{position:'relative', marginTop:8}}>
            {hl.highlights.length > 0 && (
              <HighlightOverlay ref={overlayRef} text={notes} highlights={hl.highlights} isDark={isDark} />
            )}
            <textarea
              ref={taRef}
              value={notes}
              onChange={e => { hl.handleTextChange(notes, e.target.value); setNotes(e.target.value); }}
              onSelect={hl.onSelChange}
              onMouseUp={hl.onSelChange}
              onKeyUp={hl.onSelChange}
              onTouchEnd={hl.onSelChange}
              onScroll={syncOverlayScroll}
              placeholder="Key concepts, mnemonics, clinical pearls…"
              rows={8}
              disabled={saving}
              style={{
                ...inp, resize:'vertical', lineHeight:'1.7', marginTop:0,
                position:'relative', zIndex:1,
                background: hl.highlights.length > 0 ? 'transparent' : t.surface,
                caretColor: t.text,
                color: t.text,
              }}
            />
          </div>
        </F>

        <F label="SCREENSHOTS / IMAGES">
          <div style={{display:'flex',gap:10,marginTop:8,flexWrap:'wrap'}}>
            <div onDragOver={e=>{e.preventDefault();setDrag(true);}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);loadFiles(e.dataTransfer.files);}}
              onClick={()=>!saving&&fileRef.current?.click()}
              style={{flex:1,minWidth:120,border:`2px dashed ${dragOver?color:t.borderStrong}`,
                borderRadius:8,padding:'20px 14px',textAlign:'center',
                cursor:saving?'default':'pointer',background:dragOver?`${color}12`:t.surface2}}>
              <div style={{fontSize:22,marginBottom:4}}>🖼️</div>
              <div style={{fontSize:12,color:t.text3}}>Drag & Drop</div>
            </div>
            <div onClick={()=>!saving&&galRef.current?.click()}
              style={{flex:1,minWidth:120,border:`2px dashed ${t.borderStrong}`,borderRadius:8,
                padding:'20px 14px',textAlign:'center',cursor:saving?'default':'pointer',background:t.surface2}}>
              <div style={{fontSize:22,marginBottom:4}}>📷</div>
              <div style={{fontSize:12,color:t.text3}}>From Gallery</div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e=>loadFiles(e.target.files)} />
          <input ref={galRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e=>loadFiles(e.target.files)} />
          {images.length > 0 && (
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:12}}>
              {images.map((img,i) => (
                <div key={i} style={{position:'relative'}}>
                  <img src={img.preview} alt="" style={{width:100,height:76,objectFit:'cover',
                    borderRadius:7,border:`1px solid ${t.border}`}} />
                  {!saving && <button onClick={()=>setImages(p=>p.filter((_,j)=>j!==i))} style={{
                    position:'absolute',top:-7,right:-7,background:'#dc2626',border:'none',
                    borderRadius:'50%',width:20,height:20,fontSize:10,color:'#fff',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>}
                </div>
              ))}
            </div>
          )}
          <div style={{fontSize:11,color:t.text4,marginTop:8}}>
            ℹ️ Text & highlights auto-saved as draft. Re-add images if you switch apps.
          </div>
        </F>

        {err && (
          <div style={{background:t.dangerBg,border:`1px solid ${t.dangerBorder}`,
            borderRadius:8,padding:'12px 16px',fontSize:13,color:t.danger}}>
            <strong>Error:</strong> {err}
            <div style={{marginTop:6,fontSize:12,color:t.danger}}>Your text is saved as a draft.</div>
          </div>
        )}

        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>save(false)} disabled={saving} style={{
            background:saving?'#93c5fd':color, color:'#fff', border:'none',
            borderRadius:8, padding:'12px 28px', fontSize:14, fontWeight:600,
            cursor:saving?'not-allowed':'pointer', fontFamily:'Inter,sans-serif',
            minWidth:180, display:'flex', alignItems:'center', justifyContent:'center', gap:8
          }}>
            {saving ? <>
              <span style={{display:'inline-block',width:14,height:14,
                border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',
                borderRadius:'50%',animation:'spin .7s linear infinite'}} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              {saveStatus||'Saving…'}
            </> : `✓ Save to ${systems.length} system${systems.length!==1?'s':''}`}
          </button>

          {/* Save + Analyze — only offered when a key is configured and there's
              actually a Review to analyse. Analysis never runs on its own. */}
          {!saving && AIService.isConfigured() && notes.trim().length >= 40 && (
            <button onClick={()=>save(true)} title="Save, then have Gemini organise your Review"
              style={{
                background:t.navActiveBg, color:t.navActiveText,
                border:`1px solid ${t.navActiveBorder}`,
                borderRadius:8, padding:'12px 20px', fontSize:14, fontWeight:600,
                cursor:'pointer', fontFamily:'Inter,sans-serif'
              }}>
              ✨ Save + Analyze
            </button>
          )}

          {!saving && (
            <button onClick={()=>{clearDraft(activeSystem);onCancel();}} style={{
              background:t.surface3,color:t.text3,border:`1px solid ${t.border}`,
              borderRadius:8,padding:'12px 20px',fontSize:14,
              cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}
