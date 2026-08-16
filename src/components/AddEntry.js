import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';
import { buildHighlightParts, resolveHL, adjustHighlights } from '../lib/highlights';
import { useHighlight } from '../lib/useHighlight';
import { useTheme, SPACE, RADIUS, FONT, MOTION, elevation } from '../lib/theme';
import { IconEdit, IconImages, IconUpload, IconX, IconCheck, IconSparkle } from '../lib/icons';
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
      <div style={{fontSize:FONT.size.micro,color:t.text4,letterSpacing:.8,fontWeight:FONT.weight.semibold,textTransform:'uppercase'}}>{label}</div>
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
      fontSize:FONT.size.md, lineHeight:'1.7', padding:'10px 12px',
      fontFamily:'Inter,sans-serif', fontWeight:400, letterSpacing:'normal',
      boxSizing:'border-box',
      // Android's text-autosizing ("font boosting") can inflate a <textarea>'s
      // effective font size differently than a plain <div>, especially in a
      // long block of text — the two elements drift apart line by line, only
      // becoming visibly misaligned several paragraphs in. Disabling it on
      // both this overlay AND the textarea below is what keeps them in sync
      // on tablets. This must match the textarea's style exactly.
      WebkitTextSizeAdjust:'100%', textSizeAdjust:'100%',
      border:'1px solid transparent',
      color:'transparent', overflow:'hidden'
    }}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}>{p.t}</span>;
        const c = resolveHL(p.hl, isDark);
        // color stays transparent — the real (always-opaque) textarea text shows through.
        return <mark key={i} style={{background:c.bg,color:'transparent',borderRadius:2,padding:'0 1px',
          margin:0, fontWeight:'inherit', lineHeight:'inherit'}}>{p.t}</mark>;
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
    border:`1px solid ${t.borderStrong}`, borderRadius:RADIUS.md, color:t.text,
    padding:'10px 12px', fontSize:FONT.size.md, outline:'none', boxSizing:'border-box',
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
      // Saving trims the notes, which shifts every character offset after the
      // trim point if the raw text had leading/trailing whitespace — common
      // when pasting review text (a stray leading space or blank line from
      // the source page). Highlights were positioned against the UNTRIMMED
      // textarea text, so without this correction every highlight silently
      // drifts by however many characters trim() removed from the front.
      const trimmedNotes = notes.trim();
      const adjustedHighlights = adjustHighlights(notes, trimmedNotes, hl.highlights);
      const rows = systems.map(sys => ({
        user_id:userId, system:sys, title:title.trim(), notes:trimmedNotes,
        difficulty, images:urls, highlights:adjustedHighlights,
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
          const sections = await AIService.analyzeReview(trimmedNotes);
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

  const localCss = `
    .mb-ae-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-ae-btn:hover:not(:disabled) { filter: brightness(0.97); }
    body.medbook-dark .mb-ae-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .mb-ae-btn:active:not(:disabled) { transform: scale(0.96); }
    .mb-ae-drop { transition: border-color ${MOTION.fast} ${MOTION.ease}, background ${MOTION.fast} ${MOTION.ease}; }
    .mb-ae-drop:hover { border-color: ${color}; }
    .mb-ae-chip { transition: filter ${MOTION.fast} ${MOTION.ease}; }
    .mb-ae-chip:hover { filter: brightness(0.96); }
    .mb-ae-fade { animation: medbook-fade-in ${MOTION.normal} ${MOTION.ease}; }
    .mb-ae-thumb-x { transition: transform ${MOTION.fast} ${MOTION.ease}; }
    .mb-ae-thumb-x:hover { transform: scale(1.12); }
  `;

  return (
    <div className="mb-ae-fade" style={{maxWidth:720,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      <style>{localCss}</style>

      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:SPACE.xl}}>
        <div style={{fontSize:FONT.size.xl,fontWeight:FONT.weight.bold,color:t.text}}>New Entry</div>
        {hasDraft && <span style={{fontSize:FONT.size.xs,background:t.hlBtnBg,color:t.hlBtnText,
          borderRadius:RADIUS.sm-1,padding:'2px 9px',fontWeight:FONT.weight.semibold,border:`1px solid ${t.hlBtnBorder}`}}>
          Draft restored</span>}
      </div>

      {/* One lightly-contained card for the whole form — same "reading pane"
          treatment as the entry detail screen, instead of fields floating
          loose on the page background. */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:RADIUS.lg,
        boxShadow:elevation(t,'sm'),padding:SPACE.xl2}}>
        <div style={{display:'flex',flexDirection:'column',gap:SPACE.xl}}>

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
                    <span key={s} className="mb-ae-chip" onClick={()=>!saving&&toggleSys(s)} style={{
                      display:'flex',alignItems:'center',gap:5,fontSize:FONT.size.sm,fontWeight:FONT.weight.semibold,
                      background:`${c}1f`,color:c,border:`1px solid ${c}55`,
                      borderRadius:RADIUS.sm-1,padding:'3px 10px',cursor:saving?'default':'pointer'
                    }}>{s}{!saving&&<IconX size={9} />}</span>
                  );
                })}
                {!saving && <button className="mb-ae-btn" onClick={()=>setSysOpen(p=>!p)} style={{
                  fontSize:FONT.size.sm,background:t.surface3,border:`1px solid ${t.border}`,
                  borderRadius:RADIUS.sm-1,padding:'3px 12px',cursor:'pointer',
                  color:t.text2,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'
                }}>{sysOpen?'▲ Close':'+ Add System'}</button>}
              </div>
              {sysOpen && !saving && (
                <div style={{background:t.surface2,border:`1px solid ${t.border}`,borderRadius:RADIUS.md,
                  padding:SPACE.md,display:'flex',flexWrap:'wrap',gap:6,
                  maxHeight:200,overflowY:'auto',boxShadow:elevation(t,'sm')}}>
                  {(userSystems||[]).map(s => {
                    const sel = systems.includes(s.name); const c = s.color||'#2563eb';
                    return (
                      <button key={s.name} className="mb-ae-btn" onClick={()=>toggleSys(s.name)} style={{
                        fontSize:FONT.size.sm,fontWeight:sel?FONT.weight.semibold:FONT.weight.regular,
                        background:sel?`${c}1f`:t.surface,color:sel?c:t.text2,
                        border:`1px solid ${sel?c+'66':t.border}`,
                        borderRadius:RADIUS.sm-1,padding:'5px 12px',cursor:'pointer',fontFamily:'Inter,sans-serif'
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
                <button key={d} className="mb-ae-btn" onClick={()=>!saving&&setDiff(d)} style={{
                  padding:'7px 16px',borderRadius:RADIUS.sm,
                  border:`1px solid ${difficulty===d?DIFF_COLOR[d]:t.border}`,
                  cursor:saving?'default':'pointer',fontSize:FONT.size.base,fontWeight:FONT.weight.semibold,
                  background:difficulty===d?`${DIFF_COLOR[d]}1f`:t.surface,
                  color:difficulty===d?DIFF_COLOR[d]:t.text3,fontFamily:'Inter,sans-serif'
                }}>{d}</button>
              ))}
            </div>
          </F>

          <F label="REVIEW NOTES">
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
              <button
                className="mb-ae-btn"
                onMouseDown={e=>e.preventDefault()}
                onTouchStart={e=>e.preventDefault()}
                onClick={()=>setHlMode(p=>!p)}
                style={{
                  fontSize:FONT.size.xs,background:hlMode?t.hlBtnBg:t.surface3,
                  border:`1px solid ${hlMode?t.hlBtnBorder:t.border}`,
                  borderRadius:RADIUS.sm-1,padding:'4px 10px',cursor:'pointer',
                  color:hlMode?t.hlBtnText:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif',
                  display:'flex',alignItems:'center',gap:5
                }}><IconEdit size={11} /> {hlMode?'Highlighting on':'Highlight'}</button>
              {hl.highlights.length>0 && (
                <span style={{fontSize:FONT.size.xs,color:t.text4}}>
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
                  fontWeight:400, letterSpacing:'normal',
                  WebkitTextSizeAdjust:'100%', textSizeAdjust:'100%',
                  background: hl.highlights.length > 0 ? 'transparent' : t.surface,
                  caretColor: t.text,
                  color: t.text,
                }}
              />
            </div>
          </F>

          <F label="SCREENSHOTS / IMAGES">
            <div style={{display:'flex',gap:10,marginTop:8,flexWrap:'wrap'}}>
              <div className="mb-ae-drop" onDragOver={e=>{e.preventDefault();setDrag(true);}}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{e.preventDefault();setDrag(false);loadFiles(e.dataTransfer.files);}}
                onClick={()=>!saving&&fileRef.current?.click()}
                style={{flex:1,minWidth:120,border:`2px dashed ${dragOver?color:t.borderStrong}`,
                  borderRadius:RADIUS.md,padding:'20px 14px',textAlign:'center',
                  cursor:saving?'default':'pointer',background:dragOver?`${color}12`:t.surface2}}>
                <IconImages size={20} style={{color:t.text3,marginBottom:6}} />
                <div style={{fontSize:FONT.size.sm,color:t.text3}}>Drag & Drop</div>
              </div>
              <div className="mb-ae-drop" onClick={()=>!saving&&galRef.current?.click()}
                style={{flex:1,minWidth:120,border:`2px dashed ${t.borderStrong}`,borderRadius:RADIUS.md,
                  padding:'20px 14px',textAlign:'center',cursor:saving?'default':'pointer',background:t.surface2}}>
                <IconUpload size={20} style={{color:t.text3,marginBottom:6}} />
                <div style={{fontSize:FONT.size.sm,color:t.text3}}>From Gallery</div>
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
                      borderRadius:RADIUS.sm+1,border:`1px solid ${t.border}`}} />
                    {!saving && <button className="mb-ae-thumb-x" onClick={()=>setImages(p=>p.filter((_,j)=>j!==i))} style={{
                      position:'absolute',top:-7,right:-7,background:t.danger,border:'none',
                      borderRadius:RADIUS.circle,width:20,height:20,color:'#fff',
                      cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <IconX size={10} />
                    </button>}
                  </div>
                ))}
              </div>
            )}
            <div style={{fontSize:FONT.size.xs,color:t.text4,marginTop:8}}>
              Text & highlights auto-saved as draft. Re-add images if you switch apps.
            </div>
          </F>

          {err && (
            <div style={{background:t.dangerBg,border:`1px solid ${t.dangerBorder}`,
              borderRadius:RADIUS.md,padding:'12px 16px',fontSize:FONT.size.base,color:t.danger}}>
              <strong>Error:</strong> {err}
              <div style={{marginTop:6,fontSize:FONT.size.sm,color:t.danger}}>Your text is saved as a draft.</div>
            </div>
          )}

          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            <button className="mb-ae-btn" onClick={()=>save(false)} disabled={saving} style={{
              background:saving?'#93c5fd':color, color:'#fff', border:'none',
              borderRadius:RADIUS.md, padding:'12px 28px', fontSize:FONT.size.md, fontWeight:FONT.weight.semibold,
              cursor:saving?'not-allowed':'pointer', fontFamily:'Inter,sans-serif',
              minWidth:180, display:'flex', alignItems:'center', justifyContent:'center', gap:8
            }}>
              {saving ? <>
                <span style={{display:'inline-block',width:14,height:14,
                  border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',
                  borderRadius:RADIUS.circle,animation:'medbook-spin .7s linear infinite'}} />
                {saveStatus||'Saving…'}
              </> : <><IconCheck size={13} /> Save to {systems.length} system{systems.length!==1?'s':''}</>}
            </button>

            {/* Save + Analyze — only offered when a key is configured and there's
                actually a Review to analyse. Analysis never runs on its own. */}
            {!saving && AIService.isConfigured() && notes.trim().length >= 40 && (
              <button className="mb-ae-btn" onClick={()=>save(true)} title="Save, then have Gemini organise your Review"
                style={{
                  background:t.navActiveBg, color:t.navActiveText,
                  border:`1px solid ${t.navActiveBorder}`,
                  borderRadius:RADIUS.md, padding:'12px 20px', fontSize:FONT.size.md, fontWeight:FONT.weight.semibold,
                  cursor:'pointer', fontFamily:'Inter,sans-serif',
                  display:'flex', alignItems:'center', gap:7
                }}>
                <IconSparkle size={13} /> Save + Analyze
              </button>
            )}

            {!saving && (
              <button className="mb-ae-btn" onClick={()=>{clearDraft(activeSystem);onCancel();}} style={{
                background:t.surface3,color:t.text3,border:`1px solid ${t.border}`,
                borderRadius:RADIUS.md,padding:'12px 20px',fontSize:FONT.size.md,
                cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
