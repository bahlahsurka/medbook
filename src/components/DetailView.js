import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR, DIFFICULTY } from '../lib/constants';
import { buildHighlightParts, resolveHL } from '../lib/highlights';
import { useHighlight, clearRange } from '../lib/useHighlight';
import { useTheme } from '../lib/theme';
import HLToolbar from './HLToolbar';
import HLPopover from './HLPopover';
import AISections from './AISections';
import AIService, { normalizeSections, isAllEmpty } from '../services/ai';


// --- helpers -------------------------------------------------------------

// Escape text before injecting into the print/PDF window. Without this, a note
// containing "<", ">" or "&" (e.g. "CD4 < 200", "T&C") corrupts the output.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Convert a Supabase public URL back to its storage object path ("<uid>/<file>"),
// so deleted entries don't leave orphaned images in the bucket.
function storagePathFromUrl(url) {
  try {
    const marker = '/entry-images/';
    const i = String(url).indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
  } catch { return null; }
}

function RenderedNotes({ text, highlights }) {
  const { isDark } = useTheme();
  const parts = buildHighlightParts(text, highlights);
  return (
    <span style={{whiteSpace:'pre-wrap'}}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}>{p.t}</span>;
        const c = resolveHL(p.hl, isDark);
        return <mark key={i} style={{background:c.bg,color:c.text,borderRadius:2,padding:'0 2px'}}>{p.t}</mark>;
      })}
    </span>
  );
}

// Same always-opaque-text overlay used in AddEntry, so edit-mode highlighting
// shows clean colour bands in both themes instead of washed-out text.
const EditHighlightOverlay = React.forwardRef(function EditHighlightOverlay({ text, highlights, isDark }, ref) {
  const parts = buildHighlightParts(text + '\n', highlights);
  return (
    <div ref={ref} aria-hidden="true" style={{
      position:'absolute', inset:0, pointerEvents:'none',
      whiteSpace:'pre-wrap', wordBreak:'normal', overflowWrap:'break-word',
      fontSize:14, lineHeight:'1.7', padding:'10px 12px',
      fontFamily:'Inter,sans-serif', boxSizing:'border-box',
      border:'1px solid transparent', color:'transparent', overflow:'hidden'
    }}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}>{p.t}</span>;
        const c = resolveHL(p.hl, isDark);
        return <mark key={i} style={{background:c.bg,color:'transparent',borderRadius:2,padding:'0 1px'}}>{p.t}</mark>;
      })}
    </div>
  );
});

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

export default function DetailView({ entry, onBack, onDeleted, onUpdated, userId, color: colorProp }) {
  const { t, isDark } = useTheme();
  const inp={display:'block',width:'100%',marginTop:8,background:t.surface,
    border:`1px solid ${t.borderStrong}`,borderRadius:8,color:t.text,padding:'10px 12px',
    fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'Inter,sans-serif'};
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

  // ---- AI (Sprint 2) --------------------------------------------------------
  // AI output lives entirely apart from `notes` (the Review). No AI code path
  // ever writes `notes`, so the Review cannot be clobbered.
  const [ai, setAi]           = useState(() => normalizeSections(entry.ai_sections));
  const [aiBusy, setAiBusy]   = useState(false);
  const [aiErr, setAiErr]     = useState('');
  const [aiDirty, setAiDirty] = useState(false);
  const [aiNote, setAiNote]   = useState('');
  const [deckAdded, setDeckAdded] = useState({});
  const [hlViewOn, setHVOn]  = useState(false);

  const editTaRef = useRef();
  const editOverlayRef = useRef();
  const notesRef  = useRef();

  const syncEditOverlay = useCallback(() => {
    if (editOverlayRef.current && editTaRef.current) {
      editOverlayRef.current.scrollTop = editTaRef.current.scrollTop;
      editOverlayRef.current.scrollLeft = editTaRef.current.scrollLeft;
    }
  }, []);

  // --- Selection tracking for the floating highlight bar ---------------------
  // We need three things: whether a valid selection exists, its character offsets
  // (for the highlight math) and its on-screen rect (to place the popover).
  const [selRect, setSelRect] = useState(null);
  const [selRange, setSelRange] = useState(null); // { start, end }
  const pointerDown = useRef(false);

  // Read the current selection, but only if it lies inside the notes element.
  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !notesRef.current) return null;
    const range = sel.getRangeAt(0);
    if (!notesRef.current.contains(range.commonAncestorContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(notesRef.current);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end   = start + range.toString().length;
    if (start >= end) return null;
    const r = range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return { start, end, rect: r, text: range.toString() };
  }, []);

  const clearSelState = useCallback(() => {
    setSelRect(null); setSelRange(null);
  }, []);

  useEffect(() => {
    if (!hlViewOn) { clearSelState(); return; }

    const sync = () => {
      // While the user is still dragging, don't pop the bar up under their finger.
      if (pointerDown.current) return;
      const s = readSelection();
      if (!s) { clearSelState(); return; }
      setSelRange({ start: s.start, end: s.end });
      setSelRect(s.rect);
    };

    const onDown = () => { pointerDown.current = true; };
    const onUp   = () => { pointerDown.current = false; sync(); };
    // The notes live in a scrolling container, so a fixed-position popover must
    // be repositioned as the page moves. `true` = capture, to catch inner scrolls.
    const onScrollOrResize = () => {
      const s = readSelection();
      setSelRect(s ? s.rect : null);
    };

    document.addEventListener('selectionchange', sync);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('touchend', onUp);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    sync();

    return () => {
      document.removeEventListener('selectionchange', sync);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('touchend', onUp);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [hlViewOn, readSelection, clearSelState]);

  // Does the current selection overlap any existing highlight?
  const selHasHighlight = !!selRange && viewHL.some(h => h.start < selRange.end && h.end > selRange.start);
  // The static toolbar needs to know whether a usable selection exists.
  const viewHasSel = !!selRange;

  const copySelection = async () => {
    const s = readSelection();
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s.text);
    } catch {
      // Clipboard API needs a secure context; fall back to the legacy path.
      const ta = document.createElement('textarea');
      ta.value = s.text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    window.getSelection()?.removeAllRanges();
    clearSelState();
  };


  const aiHasContent = !isAllEmpty(ai);

  // ---- AI handlers ----------------------------------------------------------
  // Runs ONLY when the user clicks. Never automatic (spec).
  const runAnalyze = async () => {
    setAiErr(''); setAiNote(''); setAiBusy(true);
    try {
      // Only the Review text is sent — no question, images, system or metadata.
      const sections = await AIService.analyzeReview(entry.notes);

      const payload = {
        ai_sections: sections,
        ai_generated_at: new Date().toISOString(),
        ai_model: AIService.activeModel(),
      };
      // NOTE: `notes` is deliberately absent from this update.
      const { error } = await supabase.from('entries').update(payload).eq('id', entry.id);
      if (error) throw new Error(error.message);

      setAi(sections);
      setAiDirty(false);
      onUpdated({ ...entry, ...payload });
      if (isAllEmpty(sections)) {
        setAiNote('Gemini found nothing it could support from this Review. Try adding more detail, then Re-analyze.');
      }
    } catch (e) {
      // Entry is untouched on any failure.
      setAiErr(e.message || 'Analysis failed.');
    }
    setAiBusy(false);
  };

  const saveAiEdits = async () => {
    setAiErr(''); setAiBusy(true);
    const payload = { ai_sections: ai };   // again: never `notes`
    const { error } = await supabase.from('entries').update(payload).eq('id', entry.id);
    if (error) { setAiErr(`Couldn't save: ${error.message}`); setAiBusy(false); return; }
    setAiDirty(false);
    onUpdated({ ...entry, ...payload });
    setAiBusy(false);
  };

  // Copy one AI flashcard into the permanent, user-owned Flashcards deck.
  // Once copied it is the user's — Re-analyze can never touch it.
  const addCardToDeck = async (cardObj, i) => {
    const key = `${i}:${cardObj.front}`;
    setAiErr('');
    const { error } = await supabase.from('flashcards').insert({
      user_id: userId,
      question: cardObj.front.trim(),
      answer: cardObj.back.trim(),
    });
    if (error) { setAiErr(`Couldn't add to deck: ${error.message}`); return; }
    setDeckAdded(p => ({ ...p, [key]: true }));
  };

  // Remove every highlight in view mode — explicit and confirmed.
  const clearAllViewHL = () => {
    if (viewHL.length === 0) return;
    if (!window.confirm(`Remove all ${viewHL.length} highlight${viewHL.length!==1?'s':''}?`)) return;
    setVHL([]);
    supabase.from('entries').update({highlights:[]}).eq('id',entry.id).then(()=>{});
    onUpdated({...entry,highlights:[]});
  };

  // Highlight hooks
  const editHl = useHighlight(editTaRef, entry.highlights||[]);

  // colorProp comes from App (knows user's custom systems); SYS_COLOR is only a fallback.
  const color = colorProp || SYS_COLOR[entry.system] || '#2563eb';
  const dc    = DIFF_COLOR[entry.difficulty]||'#6b7280';
  const fmt   = iso => new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  const updateDB = async fields => {
    const {data,error} = await supabase.from('entries').update(fields).eq('id',entry.id).select().single();
    if (!error) onUpdated(data);
    return !error;
  };

  // Marking reviewed must also advance the SM-2 schedule, otherwise the entry
  // stays permanently "due" and the review queue never lets it go.
  const markReviewed = () => {
    const interval = Math.max(1, Math.round((entry.review_interval || 1) * (entry.ease_factor || 2.5)));
    const next = new Date();
    next.setDate(next.getDate() + interval);
    return updateDB({
      review_count:(entry.review_count||0)+1,
      last_reviewed:new Date().toISOString(),
      review_interval: interval,
      ease_factor: entry.ease_factor || 2.5,
      next_review: next.toISOString(),
    });
  };
  const togglePin = () => updateDB({ pinned:!entry.pinned });

  const deleteEntry = async () => {
    if (!window.confirm('Delete this entry?')) return;
    setDel(true);
    const { error } = await supabase.from('entries').delete().eq('id',entry.id);
    if (error) { setDel(false); setErr(`Delete failed: ${error.message}`); return; }
    // Clean up the entry's images so they don't linger in Storage forever.
    const paths = (entry.images||[]).map(storagePathFromUrl).filter(Boolean);
    if (paths.length) await supabase.storage.from('entry-images').remove(paths);
    onDeleted(entry.id,entry.system);
  };

  const exportPDF = () => {
    const win = window.open('','_blank');
    if (!win) { setErr('Pop-up blocked — allow pop-ups to export a PDF.'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(entry.title)}</title>
    <style>body{font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#1f2937}
    h1{font-size:20px;margin-bottom:8px}.meta{font-size:12px;color:#6b7280;margin-bottom:16px}
    .notes{font-size:14px;line-height:1.8;white-space:pre-wrap;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px}
    img{max-width:100%;margin:10px 0;border-radius:6px;display:block}
    .back{display:inline-block;margin-bottom:20px;padding:8px 16px;background:#f3f4f6;
    border:1px solid #e5e7eb;border-radius:8px;font-size:13px;cursor:pointer;color:#374151;font-weight:600}
    @media print{.back{display:none}body{padding:0}}</style></head><body>
    <a class="back" onclick="window.close()">← Close & Go Back</a>
    <div class="meta">${esc(entry.system)} · ${esc(entry.difficulty)} · ${esc(fmt(entry.created_at))}</div>
    <h1>${esc(entry.title)}</h1><div class="notes">${esc(entry.notes||'')}</div>
    ${(entry.images||[]).map(u=>`<img src="${esc(u)}"/>`).join('')}
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
    const s = readSelection();
    if (!s) return;
    const newHl = [...clearRange(viewHL, s.start, s.end), { start: s.start, end: s.end, color: c }]
      .sort((a, b) => a.start - b.start);
    setVHL(newHl);
    window.getSelection()?.removeAllRanges();
    clearSelState();
    supabase.from('entries').update({highlights:newHl}).eq('id',entry.id).then(()=>{});
    onUpdated({...entry,highlights:newHl});
  };

  const removeViewHL = () => {
    // Requires a real selection inside the notes. Previously, clicking Remove with
    // nothing selected silently deleted EVERY highlight and saved that to the DB.
    const s = readSelection();
    if (!s) return;
    const newHl = clearRange(viewHL, s.start, s.end);
    setVHL(newHl);
    window.getSelection()?.removeAllRanges();
    clearSelState();
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
      <div style={{fontSize:15,fontWeight:700,color:t.text,marginBottom:20}}>
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
                border:`1px solid ${editDiff===d?DIFF_COLOR[d]:t.border}`,
                cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'Inter,sans-serif',
                background:editDiff===d?`${DIFF_COLOR[d]}1f`:t.surface,
                color:editDiff===d?DIFF_COLOR[d]:t.text3}}>{d}</button>
            ))}
          </div>
        </F>
        <F label="REVIEW NOTES">
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
            <button
              onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
              onClick={()=>setHEOn(p=>!p)}
              style={{fontSize:11,background:hlEditOn?t.hlBtnBg:t.surface3,
                border:`1px solid ${hlEditOn?t.hlBtnBorder:t.border}`,
                borderRadius:5,padding:'4px 10px',cursor:'pointer',
                color:hlEditOn?t.hlBtnText:t.text3,fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              🖊 {hlEditOn?'On':'Highlight'}
            </button>
            {editHl.highlights.length>0 && <span style={{fontSize:11,color:t.text4}}>{editHl.highlights.length} highlights</span>}
          </div>
          {hlEditOn && <HLToolbar onApply={editHl.applyHL} onRemove={editHl.removeHL} onClearAll={editHl.clearAllHL} hasSelection={editHl.hasSel} />}
          {/* marginTop lives on the WRAPPER, not the textarea — otherwise the
              textarea's own margin pushes its text 8px below the overlay bands. */}
          <div style={{position:'relative', marginTop:8}}>
            {editHl.highlights.length>0 && (
              <EditHighlightOverlay ref={editOverlayRef} text={editNotes}
                highlights={editHl.highlights} isDark={isDark} />
            )}
            <textarea ref={editTaRef} value={editNotes}
              onChange={e=>{ editHl.handleTextChange(editNotes,e.target.value); setEN(e.target.value); }}
              onSelect={editHl.onSelChange} onMouseUp={editHl.onSelChange}
              onKeyUp={editHl.onSelChange} onTouchEnd={editHl.onSelChange}
              onScroll={syncEditOverlay}
              rows={8} style={{...inp,resize:'vertical',lineHeight:'1.7',
                marginTop:0,
                position:'relative',zIndex:1,
                background: editHl.highlights.length>0 ? 'transparent' : t.surface,
                caretColor:t.text, color:t.text}} />
          </div>
        </F>
        {editImgs.length>0 && (
          <F label="EXISTING IMAGES">
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:8}}>
              {editImgs.map((url,i)=>(
                <div key={i} style={{position:'relative'}}>
                  <img src={url} alt="" style={{width:100,height:76,objectFit:'cover',borderRadius:7,border:`1px solid ${t.border}`}} />
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
          <label style={{display:'inline-block',marginTop:8,background:t.surface3,
            border:`1px solid ${t.border}`,borderRadius:7,padding:'8px 16px',
            fontSize:13,cursor:'pointer',fontWeight:500,color:t.text2,fontFamily:'Inter,sans-serif'}}>
            📷 Choose images
            <input type="file" accept="image/*" multiple style={{display:'none'}}
              onChange={e=>loadNewImgs(e.target.files)} />
          </label>
          {newImgs.length>0 && (
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:10}}>
              {newImgs.map((img,i)=>(
                <div key={i} style={{position:'relative'}}>
                  <img src={img.preview} alt="" style={{width:100,height:76,objectFit:'cover',borderRadius:7,border:`1px solid ${t.border}`}} />
                  <button onClick={()=>setNI(p=>p.filter((_,j)=>j!==i))} style={{
                    position:'absolute',top:-7,right:-7,background:'#dc2626',border:'none',
                    borderRadius:'50%',width:20,height:20,fontSize:10,color:'#fff',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </F>
        {err && <div style={{background:t.dangerBg,border:`1px solid ${t.dangerBorder}`,borderRadius:8,padding:'10px 14px',fontSize:13,color:t.danger}}>{err}</div>}
        <div style={{display:'flex',gap:10}}>
          <button onClick={saveEdit} disabled={saving} style={{
            background:color,color:'#fff',border:'none',borderRadius:8,padding:'11px 24px',
            fontSize:14,fontWeight:600,cursor:saving?'not-allowed':'pointer',
            opacity:saving?.7:1,fontFamily:'Inter,sans-serif'}}>
            {saving?'Saving…':'✓ Save Changes'}
          </button>
          <button onClick={cancelEdit} style={{background:t.surface3,color:t.text3,
            border:`1px solid ${t.border}`,borderRadius:8,padding:'11px 20px',
            fontSize:14,cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── VIEW MODE ──────────────────────────────────────────────────────────
  return (
    <div style={{maxWidth:680,margin:'0 auto',fontFamily:'Inter,sans-serif'}}>
      {lb!==null && <Lightbox images={entry.images} start={lb} onClose={()=>setLb(null)} />}

      {/* Floating highlight bar — only in view mode, only while Highlight is on,
          and never on top of the fullscreen lightbox. */}
      {hlViewOn && lb===null && selRect && (
        <HLPopover
          rect={selRect}
          onApply={applyViewHL}
          onRemove={removeViewHL}
          onCopy={copySelection}
          hasHighlightInSelection={selHasHighlight}
        />
      )}

      <button onClick={onBack} style={{background:'none',border:'none',color:t.text3,
        cursor:'pointer',fontSize:13,padding:0,marginBottom:16,
        display:'flex',alignItems:'center',gap:4,fontWeight:500,fontFamily:'Inter,sans-serif'}}>
        ← Back to {entry.system}
      </button>

      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,
        padding:20,marginBottom:14,borderTop:`3px solid ${color}`,
        boxShadow:`0 1px 3px ${t.shadow}`}}>
        <div style={{fontSize:18,fontWeight:700,color:t.text,lineHeight:1.4,marginBottom:12}}>
          {entry.title}{entry.pinned&&' 📌'}
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:11,fontWeight:500,background:`${dc}1f`,color:dc,
            borderRadius:4,padding:'2px 8px',border:`1px solid ${dc}44`}}>{entry.difficulty}</span>
          <span style={{fontSize:12,color:t.text4}}>{fmt(entry.created_at)}</span>
          {entry.review_count>0 && (
            <span style={{fontSize:12,color:'#16a34a',fontWeight:600}}>
              ✓ Reviewed {entry.review_count}×{entry.last_reviewed&&` · Last: ${fmt(entry.last_reviewed)}`}
            </span>
          )}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <AB color="#16a34a" bg="#f0fdf4" border="#bbf7d0" onClick={markReviewed}>✓ Reviewed</AB>
          <AB color="#2563eb" bg="#eff6ff" border="#bfdbfe" onClick={()=>setEditing(true)}>✎ Edit</AB>
          <AB color={entry.pinned?'#d97706':t.text2} bg={entry.pinned?'#fffbeb':t.surface2}
            border={entry.pinned?'#fde68a':t.border} onClick={togglePin}>
            {entry.pinned?'📌 Unpin':'📌 Pin'}
          </AB>
          <AB color={t.text2} bg={t.surface2} border={t.border} onClick={exportPDF}>⬇ PDF</AB>
          <AB color="#dc2626" bg="#fef2f2" border="#fecaca" onClick={deleteEntry} disabled={deleting}>
            {deleting?'…':'Delete'}
          </AB>
        </div>
      </div>

      {entry.notes && (
        <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,
          padding:'18px 20px',marginBottom:14,boxShadow:`0 1px 3px ${t.shadow}`}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
            marginBottom:12,flexWrap:'wrap',gap:8}}>
            <div style={{fontSize:10,color:t.text4,letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>
              Review Notes
            </div>
            <button
              onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
              onClick={()=>setHVOn(p=>!p)}
              style={{fontSize:11,background:hlViewOn?t.hlBtnBg:t.surface3,
                border:`1px solid ${hlViewOn?t.hlBtnBorder:t.border}`,
                borderRadius:5,padding:'3px 10px',cursor:'pointer',
                color:hlViewOn?t.hlBtnText:t.text3,fontWeight:600,fontFamily:'Inter,sans-serif'}}>
              🖊 {hlViewOn?'Done':'Highlight'}
            </button>
          </div>
          {hlViewOn && (
            <>
              {/* Static toolbar — always available, and the reliable path on mobile
                  where the OS selection bubble can crowd the floating bar. */}
              <HLToolbar
                onApply={applyViewHL}
                onRemove={removeViewHL}
                onClearAll={clearAllViewHL}
                hasSelection={viewHasSel}
              />
              <div style={{fontSize:11,color:t.text4,marginBottom:8}}>
                Select text, then tap a colour here — or use the bar that pops up above your selection.
              </div>
            </>
          )}
          <div ref={notesRef}
            data-selectable={hlViewOn ? 'true' : 'false'}
            style={{lineHeight:1.85,fontSize:14,color:t.text2,
            userSelect:hlViewOn?'text':'auto'}}>
            <RenderedNotes text={entry.notes} highlights={viewHL} />
          </div>
        </div>
      )}

      {/* ---- AI analysis (Sprint 2) ------------------------------------------
          Sits BELOW the Review so your own notes always read first.
          Nothing here can modify the Review. */}
      {entry.notes && AIService.isConfigured() && (
        <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,
          padding:'18px 20px',marginBottom:14,boxShadow:`0 1px 3px ${t.shadow}`}}>

          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            <div style={{fontSize:10,color:t.text4,letterSpacing:.8,fontWeight:600,
              textTransform:'uppercase',flex:1}}>
              AI Analysis
            </div>
            {aiDirty && (
              <button onClick={saveAiEdits} disabled={aiBusy} style={{
                fontSize:11,fontWeight:600,fontFamily:'Inter,sans-serif',
                background:t.okBg,border:`1px solid ${t.okBorder}`,color:t.ok,
                borderRadius:6,padding:'5px 12px',cursor:aiBusy?'default':'pointer'}}>
                Save changes
              </button>
            )}
            <button onClick={runAnalyze} disabled={aiBusy} style={{
              fontSize:11,fontWeight:600,fontFamily:'Inter,sans-serif',
              background:aiBusy?t.surface3:t.navActiveBg,
              border:`1px solid ${aiBusy?t.border:t.navActiveBorder}`,
              color:aiBusy?t.text4:t.navActiveText,
              borderRadius:6,padding:'5px 12px',
              cursor:aiBusy?'default':'pointer',
              display:'flex',alignItems:'center',gap:6}}>
              {aiBusy ? <>
                <span style={{display:'inline-block',width:10,height:10,
                  border:`2px solid ${t.border}`,borderTop:`2px solid ${t.text3}`,
                  borderRadius:'50%',animation:'aispin .7s linear infinite'}} />
                <style>{`@keyframes aispin{to{transform:rotate(360deg)}}`}</style>
                Analyzing…
              </> : (aiHasContent ? '✨ Re-analyze' : '✨ Analyze')}
            </button>
          </div>

          {aiErr && (
            <div style={{background:t.dangerBg,border:`1px solid ${t.dangerBorder}`,
              borderRadius:8,padding:'10px 14px',fontSize:12.5,color:t.danger,marginBottom:12}}>
              {aiErr}
              <div style={{marginTop:6,fontSize:11}}>
                Your Review and notes are untouched. You can retry.
              </div>
            </div>
          )}
          {aiNote && (
            <div style={{background:t.warnBg,border:`1px solid ${t.warnBorder}`,
              borderRadius:8,padding:'10px 14px',fontSize:12.5,color:t.warn,marginBottom:12}}>
              {aiNote}
            </div>
          )}

          {aiHasContent ? (
            <AISections
              sections={ai}
              onChange={next => { setAi(next); setAiDirty(true); }}
              onAddToDeck={addCardToDeck}
              deckAdded={deckAdded}
              generatedAt={entry.ai_generated_at}
              model={entry.ai_model}
              busy={aiBusy}
            />
          ) : !aiBusy && !aiErr && (
            <div style={{fontSize:12.5,color:t.text4,lineHeight:1.6}}>
              Click <strong>Analyze</strong> to have Gemini organise this Review into
              Key Learning Points, High Yield, Clinical Pearls, Red Flags, Related
              Topics and Flashcards. Your Review itself is never changed.
            </div>
          )}
        </div>
      )}

      {entry.images?.length>0 && (
        <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:10,
          padding:'18px 20px',boxShadow:`0 1px 3px ${t.shadow}`}}>
          <div style={{fontSize:10,color:t.text4,letterSpacing:.8,fontWeight:600,
            textTransform:'uppercase',marginBottom:14}}>
            Images ({entry.images.length}) — scroll · tap to expand
          </div>
          <div style={{display:'flex',gap:10,overflowX:'auto',
            WebkitOverflowScrolling:'touch',paddingBottom:8,scrollSnapType:'x mandatory'}}>
            {entry.images.map((url,i)=>(
              <img key={i} src={url} alt="" onClick={()=>setLb(i)}
                style={{height:180,width:'auto',maxWidth:'80vw',flexShrink:0,
                  borderRadius:8,border:`1px solid ${t.border}`,cursor:'pointer',
                  objectFit:'contain',background:t.surface2,scrollSnapAlign:'start'}} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AB({onClick,children,color,bg,border,disabled}) {
  const { isDark } = useTheme();
  const b  = isDark ? `${color}22` : bg;
  const bd = isDark ? `${color}55` : border;
  return <button onClick={onClick} disabled={disabled} style={{background:b,
    border:`1px solid ${bd}`,color,borderRadius:7,padding:'8px 16px',fontSize:13,
    cursor:disabled?'not-allowed':'pointer',fontWeight:600,fontFamily:'Inter,sans-serif',
    opacity:disabled?.6:1}}>{children}</button>;
}
function F({label,children}) {
  const { t } = useTheme();
  return <div>
    <div style={{fontSize:10,color:t.text4,letterSpacing:.8,fontWeight:600,textTransform:'uppercase'}}>{label}</div>
    {children}
  </div>;
}

