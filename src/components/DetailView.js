import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR, DIFFICULTY } from '../lib/constants';
import { buildHighlightParts, resolveHL, adjustHighlights } from '../lib/highlights';
import { useHighlight, clearRange } from '../lib/useHighlight';
import { useTheme, SPACE, RADIUS, FONT, Z, elevation } from '../lib/theme';
import { IconChevronLeft, IconChevronRight, IconEdit, IconCheck, IconTrash, IconPin,
  IconImages, IconSparkle, IconX, IconDownload, IconChart, IconListBullet } from '../lib/icons';
import HLToolbar from './HLToolbar';
import HLPopover from './HLPopover';
import AISections from './AISections';
import AIService, { normalizeSections, isAllEmpty } from '../services/ai';
import { limitsFor } from '../services/ai/PromptBuilder';
import { handleBulletKeyDown, toggleBulletLines, handleBulletPaste } from '../lib/bulletList';


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

// Small "flash" helper for save-confirmation UI feedback — true for `ms`,
// then auto-clears. The timer is cleaned up on unmount so a fast prev/next
// (which remounts DetailView via its `key`) can't warn about setting state
// after unmount.
function useFlash(ms = 1600) {
  const [on, setOn] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fire = useCallback(() => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, fire];
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
// UNCHANGED from before this batch — its sizing/padding/line-height must
// match the paired textarea's style exactly, character for character, or
// highlight bands drift out of alignment with the text they're supposed to
// sit behind.
const EditHighlightOverlay = React.forwardRef(function EditHighlightOverlay({ text, highlights, isDark }, ref) {
  const parts = buildHighlightParts(text + '\n', highlights);
  return (
    <div ref={ref} aria-hidden="true" style={{
      position:'absolute', inset:0, pointerEvents:'none',
      whiteSpace:'pre-wrap', wordBreak:'normal', overflowWrap:'break-word',
      fontSize:14, lineHeight:'1.7', padding:'10px 12px',
      fontFamily:'Inter,sans-serif', fontWeight:400, letterSpacing:'normal',
      boxSizing:'border-box',
      // Android's text-autosizing ("font boosting") can inflate a <textarea>'s
      // effective font size differently than a plain <div>, especially in a
      // long block of text — the two elements drift apart line by line, only
      // becoming visibly misaligned several paragraphs in. Disabling it here
      // AND on the paired textarea below is what keeps them in sync on
      // tablets. This must match the textarea's style exactly.
      WebkitTextSizeAdjust:'100%', textSizeAdjust:'100%',
      border:'1px solid transparent', color:'transparent', overflow:'hidden'
    }}>
      {parts.map((p,i) => {
        if (!p.hl) return <span key={i}>{p.t}</span>;
        const c = resolveHL(p.hl, isDark);
        return <mark key={i} style={{background:c.bg,color:'transparent',borderRadius:2,padding:'0 1px',
          margin:0, fontWeight:'inherit', lineHeight:'inherit'}}>{p.t}</mark>;
      })}
    </div>
  );
});

// Small circular icon-button used throughout the lightbox chrome.
function LbBtn({ onClick, title, style, children }) {
  return (
    <button className="mb-detailbtn" onClick={onClick} title={title} aria-label={title} style={{
      background:'rgba(255,255,255,.15)', border:'none', color:'#fff',
      cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
      ...style
    }}>{children}</button>
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
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.92)',zIndex:Z.lightbox,
      display:'flex',alignItems:'center',justifyContent:'center',
      animation:'medbook-scrim-in 180ms ease'}}
      onTouchStart={e=>{tx.current=e.touches[0].clientX;}}
      onTouchEnd={e=>{
        if(!tx.current)return;
        const dx=e.changedTouches[0].clientX-tx.current;
        if(dx<-50)next();else if(dx>50)prev();tx.current=null;
      }}>
      <LbBtn onClick={onClose} title="Close" style={{position:'absolute',top:16,right:20,
        fontSize:20,width:40,height:40,borderRadius:RADIUS.circle}}>
        <IconX size={18} />
      </LbBtn>
      <LbBtn onClick={download} title="Download" style={{position:'absolute',top:16,left:20,
        fontSize:12,padding:'8px 14px',borderRadius:RADIUS.md,fontWeight:600,
        fontFamily:'Inter,sans-serif',gap:6}}>
        <IconDownload size={13} /> Download
      </LbBtn>
      {images.length>1 && <>
        <div style={{position:'absolute',top:20,left:'50%',transform:'translateX(-50%)',
          color:'#fff',fontSize:13,background:'rgba(0,0,0,.5)',padding:'4px 14px',borderRadius:RADIUS.pill}}>
          {idx+1}/{images.length}
        </div>
        <LbBtn onClick={prev} title="Previous image" style={{position:'absolute',left:12,
          fontSize:28,width:44,height:44,borderRadius:RADIUS.circle}}>
          <IconChevronLeft size={22} />
        </LbBtn>
        <LbBtn onClick={next} title="Next image" style={{position:'absolute',right:12,
          fontSize:28,width:44,height:44,borderRadius:RADIUS.circle}}>
          <IconChevronRight size={22} />
        </LbBtn>
      </>}
      {/* key={idx} — a fresh element per image means the pop-in animation
          below replays on every prev/next, not just the initial open, so
          navigating between images gets a lightweight transition instead
          of an instant swap. */}
      <img key={idx} src={images[idx]} alt=""
        style={{maxWidth:'90vw',maxHeight:'85vh',borderRadius:RADIUS.md,objectFit:'contain',
          display:'block',animation:'medbook-pop-in 200ms cubic-bezier(0.4,0,0.2,1)'}}
        onClick={e=>e.stopPropagation()} />
      <div onClick={onClose} style={{position:'absolute',inset:0,zIndex:-1}} />
    </div>
  );
}

// A small "✓ Saved" chip used as save-confirmation feedback wherever an
// async save just completed. Purely visual — always driven by a useFlash().
function SavedChip({ t, children='Saved' }) {
  return (
    <span style={{display:'flex',alignItems:'center',gap:4,fontSize:FONT.size.xs,
      fontWeight:FONT.weight.semibold,color:t.ok,background:t.okBg,
      border:`1px solid ${t.okBorder}`,borderRadius:RADIUS.pill,padding:'2px 9px',
      animation:'medbook-fade-in 200ms ease'}}>
      <IconCheck size={11} /> {children}
    </span>
  );
}

// Quiet icon-only entry-toolbar button. Colour comes entirely from the
// theme's semantic tokens (t.ok/t.accent/t.warn/t.danger/t.text3 +
// t.surface2/t.border), so dark mode is correct by construction rather
// than an ad hoc `${color}22` approximation. No visible label — the
// tooltip/aria-label carries it, deliberately: a row of five bold
// coloured pills reads as loud "dashboard" chrome, working against the
// reading-workspace direction this polish pass asked for. Sized to match
// the Prev/Next nav buttons elsewhere on this screen. The same shape can
// take future actions (bookmark, AI Analyze, …) later without a redesign.
function ActionButton({ t, icon, label, onClick, tone='neutral', disabled, pulse }) {
  const map = {
    ok:      { color:t.ok,     bg:t.surface2, border:t.border },
    accent:  { color:t.accent, bg:t.surface2, border:t.border },
    warn:    { color:t.warn,   bg:t.warnBg,   border:t.warnBorder },
    danger:  { color:t.danger, bg:t.surface2, border:t.border },
    neutral: { color:t.text3,  bg:t.surface2, border:t.border },
  };
  const c = map[tone] || map.neutral;
  return (
    <button className="mb-detailbtn" onClick={onClick} disabled={disabled}
      title={label} aria-label={label} style={{
      width:34, height:34, flexShrink:0,
      display:'flex', alignItems:'center', justifyContent:'center',
      background:c.bg, border:`1px solid ${c.border}`, color:c.color,
      borderRadius:RADIUS.sm+2, cursor:disabled?'not-allowed':'pointer',
      opacity:disabled?.5:1,
      animation:pulse?'medbook-pulse-once 320ms ease':'none'}}>
      {icon}
    </button>
  );
}

// Gallery thumbnail — fades in once its (lazily-loaded) image actually
// loads, rather than popping in abruptly or showing a broken/blank box.
// No skeleton box behind it: on the mobile horizontal strip each image's
// natural aspect ratio gives it a different width, so a same-sized
// placeholder can't stand in for it without either guessing wrong or
// causing a reflow once the real size is known — a plain opacity fade
// avoids that without adding layout complexity.
function GalleryThumb({ t, src, onClick }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img src={src} alt="" className="mb-detailimg" onClick={onClick}
      loading="lazy" onLoad={()=>setLoaded(true)}
      style={{borderRadius:RADIUS.md,border:`1px solid ${t.border}`,cursor:'pointer',
        objectFit:'contain',background:t.surface2,
        opacity:loaded?1:0,transition:'opacity 200ms ease'}} />
  );
}

// The "Highlight" toggle in the Review Notes section header.
function HighlightToggle({ t, on, onClick }) {
  return (
    <button className="mb-detailbtn"
      onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
      onClick={onClick}
      style={{fontSize:FONT.size.xs,background:on?t.hlBtnBg:t.surface3,
        border:`1px solid ${on?t.hlBtnBorder:t.border}`,
        borderRadius:RADIUS.sm-1,padding:'3px 10px',cursor:'pointer',
        display:'flex',alignItems:'center',gap:5,flexShrink:0,
        color:on?t.hlBtnText:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif',
        transition:'background 150ms ease, border-color 150ms ease, color 150ms ease'}}>
      <IconEdit size={11} /> {on?'Done':'Highlight'}
    </button>
  );
}

function F({label,children}) {
  const { t } = useTheme();
  return <div>
    <div style={{fontSize:FONT.size.micro,color:t.text4,letterSpacing:.8,
      fontWeight:FONT.weight.semibold,textTransform:'uppercase'}}>{label}</div>
    {children}
  </div>;
}

export default function DetailView({ entry, onBack, onDeleted, onUpdated, userId, color: colorProp,
  onPrev, onNext, hasPrev, hasNext }) {
  const { t, isDark } = useTheme();

  const inp={display:'block',width:'100%',marginTop:8,background:t.surface,
    border:`1px solid ${t.borderStrong}`,borderRadius:RADIUS.md,color:t.text,padding:'10px 12px',
    fontSize:FONT.size.md,outline:'none',boxSizing:'border-box',fontFamily:'Inter,sans-serif'};
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

  // Save-confirmation feedback (batch 6) — purely additive UI state, doesn't
  // change what's persisted or when. See useFlash() above.
  const [savedFlash,    fireSavedFlash]    = useFlash();
  const [aiSavedFlash,  fireAiSavedFlash]  = useFlash();
  const [reviewedFlash, fireReviewedFlash] = useFlash(1400);

  // ---- AI (Sprint 2) --------------------------------------------------------
  // AI output lives entirely apart from `notes` (the Review). No AI code path
  // ever writes `notes`, so the Review cannot be clobbered.
  const [ai, setAi]           = useState(() => normalizeSections(entry.ai_sections));
  const [aiBusy, setAiBusy]   = useState(false);
  const [aiErr, setAiErr]     = useState('');
  const [aiDirty, setAiDirty] = useState(false);
  const [aiNote, setAiNote]   = useState('');
  const [deckAdded, setDeckAdded] = useState({});

  // Session usage bar — intentionally the ONLY piece of AI state that is not
  // saved anywhere. Plain in-memory useState: it appears after an Analyze
  // click and is gone the moment this component unmounts (i.e. when the user
  // leaves this entry). Nothing else on this screen behaves this way.
  const [usageInfo, setUsageInfo] = useState(null);
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

  // Left/Right arrow keys — same navigation as the on-screen prev/next
  // buttons. Disabled while editing (arrows must move the text cursor
  // instead), while the image lightbox is open, and while any input/
  // textarea/contentEditable has focus generally.
  useEffect(() => {
    if (editing) return;
    const isTypingTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (lb !== null) return; // lightbox open — let it own the keyboard
      if (isTypingTarget(document.activeElement)) return;
      if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); onNext(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editing, lb, hasPrev, hasNext, onPrev, onNext]);

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

  // Hard guard against duplicate in-flight requests. `disabled={aiBusy}` alone
  // isn't enough: setAiBusy(true) is async, so two fast clicks can both pass
  // the check before React re-renders and disables the button. A ref is
  // synchronous, so the second click is dropped immediately.
  const analyzeInFlight = useRef(false);

  // ---- AI handlers ----------------------------------------------------------
  // Runs ONLY when the user clicks. Never automatic (spec).
  const runAnalyze = async () => {
    if (analyzeInFlight.current) return;   // ignore clicks while one is running
    analyzeInFlight.current = true;
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

      // Update the temporary usage estimate. This is OUR count of requests
      // sent this page session against Google's PUBLISHED limits — not a
      // live number from Google (the free tier doesn't reliably expose one
      // to a browser) — so it's labelled as an estimate, not a fact.
      const usedModel = AIService.activeModel();
      setUsageInfo({ model: usedModel, count: AIService.getRequestCount(), limits: limitsFor(usedModel) });

      if (isAllEmpty(sections)) {
        setAiNote('Gemini found nothing it could support from this Review. Try adding more detail, then Re-analyze.');
      }
    } catch (e) {
      // Entry is untouched on any failure.
      setAiErr(e.message || 'Analysis failed.');
      // Refresh the usage estimate on failure too, not just success — a 429
      // still burned a real request against the quota, and this is the only
      // on-screen way to confirm exactly how many requests one click sent
      // (previously this only updated after a successful Analyze, so a
      // rate-limited click left the counter looking stale/untouched).
      const usedModel = AIService.activeModel();
      setUsageInfo({ model: usedModel, count: AIService.getRequestCount(), limits: limitsFor(usedModel) });
    } finally {
      setAiBusy(false);
      analyzeInFlight.current = false;
    }
  };

  const saveAiEdits = async () => {
    setAiErr(''); setAiBusy(true);
    const payload = { ai_sections: ai };   // again: never `notes`
    const { error } = await supabase.from('entries').update(payload).eq('id', entry.id);
    if (error) { setAiErr(`Couldn't save: ${error.message}`); setAiBusy(false); return; }
    setAiDirty(false);
    onUpdated({ ...entry, ...payload });
    setAiBusy(false);
    fireAiSavedFlash();
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
      // File it under the system the source entry belongs to — this is what
      // makes AI-generated cards land in the right folder automatically
      // instead of a flat, undifferentiated pile.
      system: entry.system,
    });
    if (error) { setAiErr(`Couldn't add to deck: ${error.message}`); return; }
    setDeckAdded(p => ({ ...p, [key]: true }));
  };

  // "Add all to deck" — one insert for every not-yet-added card, in a single
  // request rather than looping addCardToDeck (avoids N round-trips and the
  // risk of a partial batch if one insert lands and the rest lag).
  const addAllCardsToDeck = async (cardsWithIndex) => {
    const pending = cardsWithIndex.filter(({ i, c }) =>
      !deckAdded[`${i}:${c.front}`] && c.front?.trim() && c.back?.trim());
    if (pending.length === 0) return;

    setAiErr('');
    const { error } = await supabase.from('flashcards').insert(
      pending.map(({ c }) => ({
        user_id: userId,
        question: c.front.trim(),
        answer: c.back.trim(),
        system: entry.system,
      }))
    );
    if (error) { setAiErr(`Couldn't add cards to deck: ${error.message}`); return; }
    setDeckAdded(p => {
      const next = { ...p };
      pending.forEach(({ i, c }) => { next[`${i}:${c.front}`] = true; });
      return next;
    });
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
  const fmt   = iso => new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const hasImages = entry.images?.length > 0;

  const updateDB = async fields => {
    const {data,error} = await supabase.from('entries').update(fields).eq('id',entry.id).select().single();
    if (!error) onUpdated(data);
    return !error;
  };

  // Marking reviewed must also advance the SM-2 schedule, otherwise the entry
  // stays permanently "due" and the review queue never lets it go.
  const markReviewed = async () => {
    const interval = Math.max(1, Math.round((entry.review_interval || 1) * (entry.ease_factor || 2.5)));
    const next = new Date();
    next.setDate(next.getDate() + interval);
    const ok = await updateDB({
      review_count:(entry.review_count||0)+1,
      last_reviewed:new Date().toISOString(),
      review_interval: interval,
      ease_factor: entry.ease_factor || 2.5,
      next_review: next.toISOString(),
    });
    if (ok) fireReviewedFlash();
    return ok;
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
      // Saving trims the notes, which shifts every character offset after the
      // trim point if the raw text had leading/trailing whitespace — very
      // common when pasting review text (a stray leading space or blank line
      // from the source page). Highlights were positioned against the
      // UNTRIMMED textarea text, so without this correction every highlight
      // silently drifts by however many characters trim() removed from the
      // front. Reuse the same tested diff logic used for ordinary edits —
      // a trim is just an edit that removes a prefix/suffix.
      const trimmedNotes = editNotes.trim();
      const adjustedHighlights = adjustHighlights(editNotes, trimmedNotes, editHl.highlights);
      const ok = await updateDB({
        title:editTitle.trim(), notes:trimmedNotes,
        difficulty:editDiff, images:allImgs, highlights:adjustedHighlights
      });
      if (ok) { setVHL(adjustedHighlights); setEditing(false); setNI([]); fireSavedFlash(); }
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const cancelEdit = () => {
    setEditing(false); setET(entry.title); setEN(entry.notes||'');
    setED(entry.difficulty||'Medium'); setEI(entry.images||[]);
    editHl.setHighlights(entry.highlights||[]);
    setNI([]); setErr(''); setHEOn(false);
  };

  // All the edit-mode fields (including editHl's highlights) are seeded
  // from `entry` only ONCE, at mount — useState ignores its initial-value
  // argument on every render after the first. Highlighting in VIEW mode
  // (applyViewHL/removeViewHL) updates `entry.highlights` via onUpdated
  // WITHOUT remounting this component, so editHl's highlights silently
  // went stale (still whatever they were at mount, often empty) the very
  // first time someone opened Edit after highlighting. Saving from there
  // then persisted that stale (often empty) set, wiping the highlight
  // that was just added — the "highlights vanish after edit" bug. Re-sync
  // every edit field from the current `entry` right before entering edit
  // mode (same fields cancelEdit already resets on the way OUT) so edit
  // mode always starts from what's actually saved, not what existed when
  // this DetailView instance first mounted.
  const openEdit = () => {
    setET(entry.title); setEN(entry.notes||'');
    setED(entry.difficulty||'Medium'); setEI(entry.images||[]);
    editHl.setHighlights(entry.highlights||[]);
    setNI([]); setErr(''); setHEOn(false);
    setEditing(true);
  };

  // ── EDIT MODE ──────────────────────────────────────────────────────────
  // A narrower cap than view mode even on desktop — a form of stacked
  // fields reads worse stretched to full width than a moderate column does.
  if (editing) return (
    <div className="mb-detail-shell-narrow" style={{fontFamily:'Inter,sans-serif'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:SPACE.lg+2}}>
        <IconEdit size={15} style={{color:t.text3,flexShrink:0}} />
        <div style={{fontSize:FONT.size.md,fontWeight:FONT.weight.bold,color:t.text}}>
          Editing — <span style={{color}}>{entry.system}</span>
        </div>
      </div>

      {/* Same card treatment as view mode below — editing reads as a
          workspace panel rather than bare fields floating on the page. */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:RADIUS.lg,
        padding:SPACE.xl,boxShadow:elevation(t,'sm')}}>
        <div style={{display:'flex',flexDirection:'column',gap:SPACE.lg+2}}>
          <F label="TITLE *">
            <input value={editTitle} onChange={e=>setET(e.target.value)} style={inp} autoFocus />
          </F>
          <F label="DIFFICULTY">
            <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
              {DIFFICULTY.map(d=>(
                <button key={d} className="mb-detailbtn" onClick={()=>setED(d)} style={{
                  padding:'7px 16px',borderRadius:RADIUS.sm,
                  border:`1px solid ${editDiff===d?DIFF_COLOR[d]:t.border}`,
                  cursor:'pointer',fontSize:FONT.size.base,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif',
                  background:editDiff===d?`${DIFF_COLOR[d]}1f`:t.surface,
                  color:editDiff===d?DIFF_COLOR[d]:t.text3}}>{d}</button>
              ))}
            </div>
          </F>
          <F label="REVIEW NOTES">
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
              <button className="mb-detailbtn"
                onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                onClick={()=>setHEOn(p=>!p)}
                style={{fontSize:FONT.size.xs,background:hlEditOn?t.hlBtnBg:t.surface3,
                  border:`1px solid ${hlEditOn?t.hlBtnBorder:t.border}`,
                  borderRadius:RADIUS.sm-1,padding:'4px 10px',cursor:'pointer',display:'flex',
                  alignItems:'center',gap:5,
                  color:hlEditOn?t.hlBtnText:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'}}>
                <IconEdit size={11} /> {hlEditOn?'On':'Highlight'}
              </button>
              <button className="mb-detailbtn"
                onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                onClick={()=>toggleBulletLines(editTaRef.current)}
                title="Turn the current line (or selected lines) into bullet points"
                style={{fontSize:FONT.size.xs,background:t.surface3,border:`1px solid ${t.border}`,
                  borderRadius:RADIUS.sm-1,padding:'4px 10px',cursor:'pointer',display:'flex',
                  alignItems:'center',gap:5,
                  color:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'}}>
                <IconListBullet size={11} /> Bullets
              </button>
              {editHl.highlights.length>0 && <span style={{fontSize:FONT.size.xs,color:t.text4}}>{editHl.highlights.length} highlights</span>}
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
                onKeyDown={handleBulletKeyDown}
                onPaste={handleBulletPaste}
                onScroll={syncEditOverlay}
                rows={8} style={{...inp,resize:'vertical',lineHeight:'1.7',
                  marginTop:0,
                  position:'relative',zIndex:1,
                  fontWeight:400, letterSpacing:'normal',
                  WebkitTextSizeAdjust:'100%', textSizeAdjust:'100%',
                  background: editHl.highlights.length>0 ? 'transparent' : t.surface,
                  caretColor:t.text, color:t.text}} />
            </div>
          </F>
          {editImgs.length>0 && (
            <F label="EXISTING IMAGES">
              <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:8}}>
                {editImgs.map((url,i)=>(
                  <div key={i} style={{position:'relative'}}>
                    <img src={url} alt="" className="mb-detailimg"
                      style={{width:100,height:76,objectFit:'cover',borderRadius:RADIUS.sm+1,border:`1px solid ${t.border}`}} />
                    <button className="mb-detailbtn" onClick={()=>setEI(p=>p.filter((_,j)=>j!==i))} style={{
                      position:'absolute',top:-7,right:-7,background:t.danger,border:'none',
                      borderRadius:RADIUS.circle,width:20,height:20,fontSize:10,color:'#fff',
                      cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <IconX size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </F>
          )}
          <F label="ADD MORE IMAGES">
            <label style={{display:'inline-block',marginTop:8,background:t.surface3,
              border:`1px solid ${t.border}`,borderRadius:RADIUS.sm+1,padding:'8px 16px',
              fontSize:FONT.size.base,cursor:'pointer',fontWeight:FONT.weight.medium,color:t.text2,fontFamily:'Inter,sans-serif',
              display:'inline-flex',alignItems:'center',gap:7}}>
              <IconImages size={13} /> Choose images
              <input type="file" accept="image/*" multiple style={{display:'none'}}
                onChange={e=>loadNewImgs(e.target.files)} />
            </label>
            {newImgs.length>0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:10}}>
                {newImgs.map((img,i)=>(
                  <div key={i} style={{position:'relative'}}>
                    <img src={img.preview} alt="" className="mb-detailimg"
                      style={{width:100,height:76,objectFit:'cover',borderRadius:RADIUS.sm+1,border:`1px solid ${t.border}`}} />
                    <button className="mb-detailbtn" onClick={()=>setNI(p=>p.filter((_,j)=>j!==i))} style={{
                      position:'absolute',top:-7,right:-7,background:t.danger,border:'none',
                      borderRadius:RADIUS.circle,width:20,height:20,fontSize:10,color:'#fff',
                      cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <IconX size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </F>
          {err && <div style={{background:t.dangerBg,border:`1px solid ${t.dangerBorder}`,borderRadius:RADIUS.md,padding:'10px 14px',fontSize:FONT.size.base,color:t.danger}}>{err}</div>}
          <div style={{display:'flex',gap:10}}>
            <button className="mb-detailbtn" onClick={saveEdit} disabled={saving} style={{
              background:color,color:'#fff',border:'none',borderRadius:RADIUS.md,padding:'11px 24px',
              fontSize:FONT.size.md,fontWeight:FONT.weight.semibold,cursor:saving?'not-allowed':'pointer',
              opacity:saving?.7:1,fontFamily:'Inter,sans-serif',
              display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {saving ? <>
                <span style={{display:'inline-block',width:14,height:14,
                  border:'2px solid rgba(255,255,255,.4)',borderTop:'2px solid #fff',
                  borderRadius:RADIUS.circle,animation:'medbook-spin .7s linear infinite'}} />
                Saving…
              </> : <><IconCheck size={14} /> Save Changes</>}
            </button>
            <button className="mb-detailbtn" onClick={cancelEdit} style={{background:t.surface3,color:t.text3,
              border:`1px solid ${t.border}`,borderRadius:RADIUS.md,padding:'11px 20px',
              fontSize:FONT.size.md,cursor:'pointer',fontFamily:'Inter,sans-serif'}}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── VIEW MODE ──────────────────────────────────────────────────────────
  // Width/columns are driven by the .mb-detail-shell/.mb-detail-grid CSS
  // classes (public/index.html) rather than inline styles, specifically so
  // they can respond to viewport size — mobile stays a single column;
  // tablet/laptop (≥768px) get a wider shell and, once there are images, a
  // two-column layout with a sticky image rail. A quick fade-in on mount
  // smooths switching between entries via prev/next, since this component
  // remounts (`key`) each time.
  //
  // The System/Title/meta/toolbar header and the Review Notes section are
  // ONE merged, lightly-contained "reading pane" (was two separate bordered+
  // shadowed cards) — see its own comment below for why.
  return (
    <div className="mb-detail-shell" style={{fontFamily:'Inter,sans-serif',animation:'medbook-fade-in 200ms ease'}}>
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

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        marginBottom:SPACE.lg,gap:SPACE.sm,flexWrap:'wrap'}}>
        <button className="mb-detailbtn" onClick={onBack} style={{background:'none',border:'none',color:t.text3,
          cursor:'pointer',fontSize:FONT.size.sm,padding:'4px 2px',
          display:'flex',alignItems:'center',gap:4,fontWeight:FONT.weight.medium,fontFamily:'Inter,sans-serif'}}>
          <IconChevronLeft size={15} /> Back to {entry.system}
        </button>

        {/* Prev/Next — walks the same ordered list you'd see on the system
            page, so this is a shortcut for "go back and open the next one",
            not a separate ordering. Hidden entirely when there's nowhere to
            go (e.g. only one entry, or search was narrowing the list). */}
        {(hasPrev || hasNext) && (
          <div style={{display:'flex',gap:6}}>
            <button className="mb-detailbtn" onClick={onPrev} disabled={!hasPrev} title="Previous entry (←)"
              style={{background:t.surface2,border:`1px solid ${t.border}`,
                color:hasPrev?t.text2:t.text4,borderRadius:RADIUS.sm+1,
                width:34,height:34,fontFamily:'Inter,sans-serif',
                cursor:hasPrev?'pointer':'default',opacity:hasPrev?1:.4,
                display:'flex',alignItems:'center',justifyContent:'center'}}>
              <IconChevronLeft size={16} />
            </button>
            <button className="mb-detailbtn" onClick={onNext} disabled={!hasNext} title="Next entry (→)"
              style={{background:t.surface2,border:`1px solid ${t.border}`,
                color:hasNext?t.text2:t.text4,borderRadius:RADIUS.sm+1,
                width:34,height:34,fontFamily:'Inter,sans-serif',
                cursor:hasNext?'pointer':'default',opacity:hasNext?1:.4,
                display:'flex',alignItems:'center',justifyContent:'center'}}>
              <IconChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      <div className={`mb-detail-grid${hasImages ? '' : ' mb-detail-grid--single'}`}>
      <div className="mb-detail-main" style={{display:'flex',flexDirection:'column',gap:SPACE.md+2,minWidth:0}}>

      {/* ---- Reading pane: System / Title / meta+toolbar / Review Notes ----
          Merged into ONE lightly-contained block (previously two separate
          bordered+shadowed cards) so the entry reads as a single continuous
          page rather than stacked dashboard slabs. Softer border, no
          shadow, and a smaller radius than the AI/Images cards below it
          keep this the visually lightest element on the screen, on
          purpose — the medical content should carry the weight, not the
          container around it. */}
      <div className="mb-detail-card" style={{background:t.surface,
        border:`1px solid ${t.border}`,borderRadius:RADIUS.md}}>

        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
          <span style={{fontSize:FONT.size.sm,fontWeight:FONT.weight.semibold,color}}>{entry.system}</span>
          {savedFlash && <SavedChip t={t} />}
        </div>

        <div style={{fontSize:FONT.size.xl3,fontWeight:FONT.weight.bold,color:t.text,
          lineHeight:FONT.leading.tight,marginBottom:SPACE.md}}>
          {entry.title}
          {entry.pinned && <IconPin size={16} style={{marginLeft:8,color:t.warn,verticalAlign:-2}} />}
        </div>

        {/* Difficulty is intentionally not shown here — see the same note
            in EntryCard.js. It's still fully editable in Edit mode. Meta
            and the entry toolbar share a row: compact, and it keeps the
            header short enough to start reading without much scrolling. */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
          <span style={{fontSize:FONT.size.xs,color:t.text4}}>
            {fmt(entry.created_at)}
            {entry.review_count>0 && (
              <> · <span style={{color:t.ok,fontWeight:FONT.weight.semibold}}>
                Reviewed {entry.review_count}×{entry.last_reviewed&&` · Last: ${fmt(entry.last_reviewed)}`}
              </span></>
            )}
          </span>

          <div style={{display:'flex',gap:6,flexShrink:0}}>
            <ActionButton t={t} tone="ok" icon={<IconCheck size={14} />} label="Mark reviewed"
              onClick={markReviewed} pulse={reviewedFlash} />
            <ActionButton t={t} tone="accent" icon={<IconEdit size={14} />} label="Edit entry"
              onClick={openEdit} />
            <ActionButton t={t} tone={entry.pinned?'warn':'neutral'} icon={<IconPin size={14} />}
              label={entry.pinned?'Unpin entry':'Pin entry'} onClick={togglePin} />
            <ActionButton t={t} tone="neutral" icon={<IconDownload size={14} />} label="Export as PDF"
              onClick={exportPDF} />
            <ActionButton t={t} tone="danger" label={deleting?'Deleting…':'Delete entry'}
              onClick={deleteEntry} disabled={deleting}
              icon={deleting
                ? <span style={{display:'inline-block',width:12,height:12,border:`2px solid ${t.border}`,
                    borderTop:`2px solid ${t.danger}`,borderRadius:RADIUS.circle,
                    animation:'medbook-spin .7s linear infinite'}} />
                : <IconTrash size={14} />} />
          </div>
        </div>

        {entry.notes && (
          <>
            <div style={{height:1,background:t.border,margin:`${SPACE.lg}px 0`}} />

            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              marginBottom:SPACE.md,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:FONT.size.micro,color:t.text4,letterSpacing:.8,fontWeight:FONT.weight.semibold,textTransform:'uppercase'}}>
                Review Notes
              </div>
              <HighlightToggle t={t} on={hlViewOn} onClick={()=>setHVOn(p=>!p)} />
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
                <div style={{fontSize:FONT.size.xs,color:t.text4,marginBottom:SPACE.sm}}>
                  Select text, then tap a colour here — or use the bar that pops up above your selection.
                </div>
              </>
            )}
            {/* maxWidth keeps line length comfortable rather than running the
                full width of a wide tablet/laptop column, without touching
                notesRef's structure — readSelection()'s character-offset
                math walks notesRef's text content, which this doesn't
                change. On mobile the card is already narrower than this,
                so it has no effect there. */}
            <div ref={notesRef}
              data-selectable={hlViewOn ? 'true' : 'false'}
              style={{lineHeight:1.9,fontSize:FONT.size.md,color:t.text2,maxWidth:640,
              userSelect:hlViewOn?'text':'auto'}}>
              <RenderedNotes text={entry.notes} highlights={viewHL} />
            </div>
          </>
        )}
      </div>

      {/* ---- AI analysis (Sprint 2) ------------------------------------------
          Sits BELOW the Review so your own notes always read first.
          Nothing here can modify the Review. */}
      {entry.notes && AIService.isConfigured() && (
        <div className="mb-detail-card" style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:RADIUS.lg,
          boxShadow:elevation(t,'sm')}}>

          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:SPACE.lg,flexWrap:'wrap'}}>
            <div style={{fontSize:FONT.size.micro,color:t.text4,letterSpacing:.8,fontWeight:FONT.weight.semibold,
              textTransform:'uppercase',flex:1,display:'flex',alignItems:'center',gap:6}}>
              <IconSparkle size={11} style={{color:t.text4,flexShrink:0}} /> AI Analysis
            </div>
            {aiSavedFlash && <SavedChip t={t} />}
            {aiDirty && (
              <button className="mb-detailbtn" onClick={saveAiEdits} disabled={aiBusy} style={{
                fontSize:FONT.size.xs,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif',
                background:t.okBg,border:`1px solid ${t.okBorder}`,color:t.ok,
                borderRadius:RADIUS.sm-1,padding:'5px 12px',cursor:aiBusy?'default':'pointer'}}>
                Save changes
              </button>
            )}
            <button className="mb-detailbtn" onClick={runAnalyze} disabled={aiBusy} style={{
              fontSize:FONT.size.xs,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif',
              background:aiBusy?t.surface3:t.navActiveBg,
              border:`1px solid ${aiBusy?t.border:t.navActiveBorder}`,
              color:aiBusy?t.text4:t.navActiveText,
              borderRadius:RADIUS.sm-1,padding:'5px 12px',
              cursor:aiBusy?'default':'pointer',
              display:'flex',alignItems:'center',gap:6}}>
              {aiBusy ? <>
                <span style={{display:'inline-block',width:10,height:10,
                  border:`2px solid ${t.border}`,borderTop:`2px solid ${t.text3}`,
                  borderRadius:RADIUS.circle,animation:'medbook-spin .7s linear infinite'}} />
                Analyzing…
              </> : <><IconSparkle size={12} /> {aiHasContent ? 'Re-analyze' : 'Analyze'}</>}
            </button>
          </div>

          {/* Temporary usage estimate — appears after Analyze, gone the moment
              you leave this entry (plain component state, not saved anywhere).
              Numbers are OUR count of requests this session vs Google's
              PUBLISHED limits, not a live figure from Google. */}
          {usageInfo && (
            <div style={{display:'flex',alignItems:'center',gap:8,
              background:t.surface2,border:`1px solid ${t.border}`,borderRadius:RADIUS.sm+1,
              padding:'6px 12px',marginBottom:SPACE.md,fontSize:FONT.size.xs,color:t.text4}}>
              <IconChart size={12} style={{color:t.text4,flexShrink:0}} />
              <span>
                ~{usageInfo.count} request{usageInfo.count!==1?'s':''} this session on{' '}
                <strong style={{color:t.text3}}>{usageInfo.model}</strong>
                {usageInfo.limits.rpd && (
                  <> · free tier is usually ~{usageInfo.limits.rpm}/min, ~{usageInfo.limits.rpd}/day</>
                )}
              </span>
              <span style={{marginLeft:'auto',fontSize:FONT.size.micro,fontStyle:'italic',opacity:.7}}>
                estimate, not from Google
              </span>
            </div>
          )}

          {aiErr && (
            <div style={{background:t.dangerBg,border:`1px solid ${t.dangerBorder}`,
              borderRadius:RADIUS.md,padding:'10px 14px',fontSize:12.5,color:t.danger,marginBottom:SPACE.md}}>
              {aiErr}
              <div style={{marginTop:6,fontSize:FONT.size.xs}}>
                Your Review and notes are untouched. You can retry.
              </div>
            </div>
          )}
          {aiNote && (
            <div style={{background:t.warnBg,border:`1px solid ${t.warnBorder}`,
              borderRadius:RADIUS.md,padding:'10px 14px',fontSize:12.5,color:t.warn,marginBottom:SPACE.md}}>
              {aiNote}
            </div>
          )}

          {aiHasContent ? (
            <AISections
              sections={ai}
              onChange={next => { setAi(next); setAiDirty(true); }}
              onAddToDeck={addCardToDeck}
              onAddAllToDeck={addAllCardsToDeck}
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

      </div>{/* /.mb-detail-main */}

      {hasImages && (
        <div className="mb-detail-side">
          <div className="mb-detail-card" style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:RADIUS.lg,
            boxShadow:elevation(t,'sm')}}>
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:FONT.size.micro,color:t.text4,
              letterSpacing:.8,fontWeight:FONT.weight.semibold,textTransform:'uppercase',marginBottom:SPACE.lg}}>
              <IconImages size={11} style={{flexShrink:0}} /> Images ({entry.images.length}) — tap to expand
            </div>
            <div className="mb-detail-images">
              {entry.images.map((url,i)=>(
                <GalleryThumb key={i} t={t} src={url} onClick={()=>setLb(i)} />
              ))}
            </div>
          </div>
        </div>
      )}

      </div>{/* /.mb-detail-grid */}
    </div>
  );
}
