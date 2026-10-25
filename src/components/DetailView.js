import React, { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR, DIFF_COLOR, DIFFICULTY } from '../lib/constants';
import { toTitleCase } from '../lib/titleCase';
import { adjustHighlights, matchHighlightShortcutView, richMarkersToHtml, markedTextToHtml } from '../lib/highlights';
import RichRuns from '../lib/RichRuns';
import { useHighlight, clearRange } from '../lib/useHighlight';
import { useTheme, SPACE, RADIUS, FONT, Z, MOTION, elevation } from '../lib/theme';
import { IconChevronLeft, IconChevronRight, IconEdit, IconCheck, IconTrash, IconPin,
  IconImages, IconSparkle, IconX, IconDownload, IconChart, IconListBullet } from '../lib/icons';
import HLToolbar from './HLToolbar';
import HLPopover from './HLPopover';
import AISections from './AISections';
import AIService, { normalizeSections, isAllEmpty } from '../services/ai';
import { limitsFor } from '../services/ai/PromptBuilder';
import { handleBulletKeyDown, toggleBulletLines, handleRichPaste, handlePlainPaste,
  sanitizeForStorage, inlineTextWithMarks } from '../lib/bulletList';
import { STUDY_SCOPE_CLASS, suppressContextMenu } from '../lib/studyInteraction';


// --- helpers -------------------------------------------------------------

// Escape text before injecting into the print/PDF window. Without this, a note
// containing "<", ">" or "&" (e.g. "CD4 < 200", "T&C") corrupts the output.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Turns the rich-paste markers (bold/italic/size — see lib/bulletList.js)
// into real HTML tags for the exported PDF, so a note that reads formatted
// on screen doesn't lose that the moment it's printed. richMarkersToHtml
// does its own escaping first (same as esc() above) — the markers it
// converts afterward can only ever be ones this app itself wrote, never
// something pasted in from the note's own text. No explicit textColor
// (null): print output is plain black text, not theme-coloured.
function escWithBold(str) {
  return richMarkersToHtml(str, null);
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

// Shared by the arrow-key nav effect and the view-mode highlight-letter
// effect below — both need "is the keyboard currently being used to type
// somewhere" as a guard, not just "here".
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

// Maps a Range boundary (container, offset) to its position in the RAW
// stored string, via the nearest ancestor BoldRuns leaf's data-raw-start
// (see BoldRuns above) plus the in-run character count up to that boundary.
// Every leaf BoldRuns renders carries this annotation, so any boundary a
// real text selection can land on is inside one. Returns null only for a
// boundary outside any annotated run (shouldn't happen for a selection
// readSelection has already confirmed is inside notesRef, but checked
// rather than assumed).
//
// A Range boundary isn't always inside a text node — dragging a selection
// past the very last character of the notes (there's nothing after it to
// "attach" the endpoint to) commonly lands the browser's endContainer on a
// common ANCESTOR element instead, with offset === that element's
// childNodes.length. `container` there is never itself inside an annotated
// run — it's an ancestor of every run — so `closest('[data-raw-start]')`
// found nothing and this returned null, which readSelection treats as "no
// selection": selecting to the end of an entry's last line silently failed
// to highlight anything. Resolving the boundary down through childNodes
// first (same rule the DOM itself uses: the boundary sits between
// childNodes[offset-1] and childNodes[offset]) until it reaches an actual
// leaf fixes that, while leaving every already-working in-text-node
// boundary untouched (the loop never runs for those).
export function rawOffsetAt(container, offset) {
  let node = container, off = offset;
  while (node.nodeType !== Node.TEXT_NODE && node.childNodes.length > 0) {
    if (off >= node.childNodes.length) {
      node = node.childNodes[node.childNodes.length - 1];
      off = node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length;
    } else {
      node = node.childNodes[off];
      off = 0;
    }
  }
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const runEl = el && el.closest('[data-raw-start]');
  if (!runEl) return null;
  const rawStart = parseInt(runEl.getAttribute('data-raw-start'), 10);
  const pre = document.createRange();
  pre.selectNodeContents(runEl);
  pre.setEnd(node, off);
  return rawStart + pre.toString().length;
}

// readSelection() below reads each run's data-raw-start (written by the
// shared RichRuns component — see lib/RichRuns.js) to translate a
// selection made in this RENDERED (marker-stripped) view into the same
// raw-string coordinates everything else (storage, buildFormattedParts,
// edit-mode's own capture) already uses. Without it, a highlight created
// by selecting text here lands at the wrong offset the moment it's
// replayed against the raw string — every marker before the selection
// (a **bold** pair, a {{lg}}…{{/lg}}) shifts it further out.
//
// Formatting and highlight colour are composed in ONE pass inside RichRuns
// (buildFormattedParts) — never by slicing `text` at highlight boundaries
// before handing it to RichRuns, which is what used to corrupt a **bold**
// run (lost styling, or styling leaking onto adjacent text) whenever a
// highlight landed partway through it.
export function RenderedNotes({ text, highlights }) {
  const { isDark } = useTheme();
  return (
    <span style={{whiteSpace:'pre-wrap'}}>
      <RichRuns text={text} highlights={highlights} isDark={isDark} />
    </span>
  );
}

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
    <img src={src} alt="" className="mb-detailimg mb-gallerythumb" onClick={onClick}
      loading="lazy" onLoad={()=>setLoaded(true)}
      style={{borderRadius:RADIUS.md,border:`1px solid ${t.border}`,cursor:'pointer',
        objectFit:'contain',background:t.surface2,position:'relative',
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

  const inp={display:'block',width:'100%',marginTop:8,background:t.surface2,
    border:'1px solid transparent',borderRadius:RADIUS.md,color:t.text,padding:'10px 12px',
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
  const [plainPaste,setPP]    = useState(false);
  // The edit-mode contentEditable's initial content — set explicitly by
  // openEdit() (below) each time a NEW edit session starts, never derived
  // live from editNotes on every render. dangerouslySetInnerHTML re-applies
  // itself whenever the __html value it's given actually changes, so if
  // this were computed inline from editNotes, React would stomp the live,
  // actively-being-typed-into DOM back to this string on every keystroke —
  // this state is the one piece of edit-mode state that's deliberately NOT
  // kept live-synced with typing, specifically so that can't happen.
  const [editInitialHtml, setEditInitialHtml] = useState('');

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

  // Fallback dedup check: `deckAdded` is plain in-memory state, so it's
  // lost the moment this screen unmounts (navigating away and back,
  // reloading the page) or a card list is regenerated by Re-analyze —
  // without this, revisiting an entry and clicking "Add to my deck" again
  // on a card already copied in a PRIOR visit would silently insert a
  // second, identical row, since nothing local remembered it was already
  // there. Rather than trusting only local state, this checks the real
  // `flashcards` table (the actual source of truth) for a matching
  // question already filed under this entry's system, and marks it added
  // locally without re-inserting. Called once on mount (against whatever
  // flashcards the entry was already loaded with) and again after a fresh
  // Re-analyze, so the "✓ In my deck" state is correct up front rather
  // than only discovered the next time each card is clicked.
  const syncDeckAddedFromDB = useCallback(async (cardsList) => {
    const fronts = (cardsList || []).map(c => c.front?.trim()).filter(Boolean);
    if (!fronts.length || !userId) return;
    const { data, error } = await supabase.from('flashcards')
      .select('question').eq('user_id', userId).eq('system', entry.system)
      .in('question', fronts);
    if (error || !data) return;
    const existing = new Set(data.map(r => r.question));
    setDeckAdded(prev => {
      const next = { ...prev };
      cardsList.forEach((c, i) => {
        const front = c.front?.trim();
        if (front && existing.has(front)) next[`${i}:${c.front}`] = true;
      });
      return next;
    });
  }, [userId, entry.system]);

  // Snapshot of the entry's flashcards as first loaded — read once, not
  // live-tracked, so the mount-sync effect below only ever runs against
  // what the entry ALREADY had (never retriggered by `entry` changing
  // identity on every edit/save elsewhere on this screen).
  const initialAiFlashcardsRef = useRef(normalizeSections(entry.ai_sections).flashcards);
  const didSyncOnMount = useRef(false);
  useEffect(() => {
    if (didSyncOnMount.current || !userId) return;
    didSyncOnMount.current = true;
    syncDeckAddedFromDB(initialAiFlashcardsRef.current);
  }, [userId, syncDeckAddedFromDB]);

  // Session usage bar — intentionally the ONLY piece of AI state that is not
  // saved anywhere. Plain in-memory useState: it appears after an Analyze
  // click and is gone the moment this component unmounts (i.e. when the user
  // leaves this entry). Nothing else on this screen behaves this way.
  const [usageInfo, setUsageInfo] = useState(null);
  const [hlViewOn, setHVOn]  = useState(false);

  const editTaRef = useRef();
  const notesRef  = useRef();

  // --- Selection tracking for the floating highlight bar ---------------------
  // We need three things: whether a valid selection exists, its character offsets
  // (for the highlight math) and its on-screen rect (to place the popover).
  const [selRect, setSelRect] = useState(null);
  const [selRange, setSelRange] = useState(null); // { start, end }
  const pointerDown = useRef(false);

  // Read the current selection, but only if it lies inside the notes element.
  // start/end are positions in the RAW stored string (entry.notes, markers
  // included) — rawOffsetAt maps each Range boundary there via the
  // data-raw-start BoldRuns annotated, rather than counting characters in
  // the rendered (marker-stripped) DOM text directly. The rendered text is
  // shorter than the raw string by however many marker characters precede
  // a given point — e.g. a **bold** pair, a {{lg}}…{{/lg}} heading — so
  // counting in rendered coordinates and using that as a raw-string offset
  // (the previous approach) silently drifted the highlight forward into
  // the wrong word by exactly that many characters once replayed against
  // entry.notes, which is the one and only string buildFormattedParts (and
  // every other render of this entry) ever slices against.
  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !notesRef.current) return null;
    const range = sel.getRangeAt(0);
    if (!notesRef.current.contains(range.commonAncestorContainer)) return null;
    const start = rawOffsetAt(range.startContainer, range.startOffset);
    const end   = rawOffsetAt(range.endContainer, range.endOffset);
    if (start == null || end == null || start >= end) return null;
    const text = range.toString();
    // "Meaningful text" — reject a selection that's whitespace-only (a stray
    // drag across a line break/paragraph gap, common on mobile) so the
    // toolbar doesn't pop up over nothing worth acting on. A short but real
    // token (an abbreviation like "CD4" or "PR") still counts — there's no
    // arbitrary length minimum beyond "isn't just blank space".
    if (!text.trim()) return null;
    const r = range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return { start, end, rect: r, text };
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
        ai_provider: AIService.activeProvider(),
      };
      // NOTE: `notes` is deliberately absent from this update.
      const { error } = await supabase.from('entries').update(payload).eq('id', entry.id);
      if (error) throw new Error(error.message);

      setAi(sections);
      setAiDirty(false);
      onUpdated({ ...entry, ...payload });
      syncDeckAddedFromDB(sections.flashcards); // a freshly-generated card may already be in the deck

      // Update the usage readout. The count now comes straight from the
      // server (see api/analyze.mjs's ai_usage_daily) — Groq's and
      // Gemini's free tiers are shared across every signed-in MedBook user
      // via one API key each, so a per-browser-session count couldn't mean
      // anything against that shared quota the way it could when this was
      // a single-user, client-side-only integration.
      const usedModel = AIService.activeModel();
      setUsageInfo({
        provider: AIService.activeProvider(), model: usedModel, fallback: AIService.wasFallback(),
        count: AIService.getRequestCount(), limits: limitsFor(usedModel),
      });

      if (isAllEmpty(sections)) {
        setAiNote('The AI found nothing it could support from this Review. Try adding more detail, then Re-analyze.');
      }
    } catch (e) {
      // Entry is untouched on any failure.
      setAiErr(e.message || 'Analysis failed.');
      // Refresh the usage readout on failure too, not just success — a 429
      // still burned a real request against the quota, and this is the only
      // on-screen way to confirm exactly how many requests one click sent
      // (previously this only updated after a successful Analyze, so a
      // rate-limited click left the counter looking stale/untouched).
      const usedModel = AIService.activeModel();
      setUsageInfo({
        provider: AIService.activeProvider(), model: usedModel, fallback: AIService.wasFallback(),
        count: AIService.getRequestCount(), limits: limitsFor(usedModel),
      });
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
    const front = cardObj.front.trim();
    const back = cardObj.back.trim();
    setAiErr('');

    // Fallback dedup check — `deckAdded` is only in-memory, so a reload, a
    // revisit, or a Re-analyze that regenerates the list under new indices
    // can all lose track of what was already copied. Checking the real
    // table (not just local state) right before inserting is what actually
    // stops a duplicate row from being created, regardless of why local
    // state lost track — see syncDeckAddedFromDB above for the matching
    // "show the correct state up front" half of this fix.
    const { data: existing, error: checkErr } = await supabase.from('flashcards')
      .select('id').eq('user_id', userId).eq('system', entry.system)
      .eq('question', front).limit(1);
    if (checkErr) { setAiErr(`Couldn't add to deck: ${checkErr.message}`); return; }
    if (existing && existing.length > 0) { setDeckAdded(p => ({ ...p, [key]: true })); return; }

    const { error } = await supabase.from('flashcards').insert({
      user_id: userId,
      question: front,
      answer: back,
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

    // Same fallback as addCardToDeck — check the real table for any of
    // these fronts already filed under this system before inserting, so a
    // stale/reset local deckAdded (reload, revisit, Re-analyze) can't
    // produce duplicate rows for cards that are already in the deck.
    const fronts = pending.map(({ c }) => c.front.trim());
    const { data: existingRows, error: checkErr } = await supabase.from('flashcards')
      .select('question').eq('user_id', userId).eq('system', entry.system)
      .in('question', fronts);
    if (checkErr) { setAiErr(`Couldn't add cards to deck: ${checkErr.message}`); return; }
    const existingSet = new Set((existingRows || []).map(r => r.question));

    const toInsert = pending.filter(({ c }) => !existingSet.has(c.front.trim()));
    const alreadyThere = pending.filter(({ c }) => existingSet.has(c.front.trim()));

    if (toInsert.length > 0) {
      const { error } = await supabase.from('flashcards').insert(
        toInsert.map(({ c }) => ({
          user_id: userId,
          question: c.front.trim(),
          answer: c.back.trim(),
          system: entry.system,
        }))
      );
      if (error) { setAiErr(`Couldn't add cards to deck: ${error.message}`); return; }
    }

    setDeckAdded(p => {
      const next = { ...p };
      [...toInsert, ...alreadyThere].forEach(({ i, c }) => { next[`${i}:${c.front}`] = true; });
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
  const editHl = useHighlight(editTaRef, entry.highlights||[], { textColor: t.text, isDark });

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
    if (ok) {
      fireReviewedFlash();
      // Same fire-and-forget review_log write ReviewQueue.js/SystemReview.js
      // make on a rating — "Mark reviewed" has no rating UI, so it's logged
      // as 'good', keeping review_log complete across every path an entry
      // can be marked reviewed from.
      if (userId) {
        supabase.from('review_log').insert({
          user_id: userId, entry_id: entry.id, system: entry.system, rating: 'good',
        }).then(({ error: logError }) => {
          if (logError && process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn('[DetailView] review_log insert failed — has SUPABASE_MIGRATION_INSIGHTS.sql been run?', logError.message);
          }
        });
      }
    }
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
    if (!win) { setErr('Pop-up blocked. Allow pop-ups to export a PDF.'); return; }
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
    <h1>${esc(entry.title)}</h1><div class="notes">${escWithBold(entry.notes||'')}</div>
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

  // View-mode DOM-based highlight. useCallback (not a plain function like
  // the rest of this file's handlers) so the keyboard-shortcut effect below
  // can list them as real dependencies instead of either going stale or
  // re-subscribing its document listeners on every render.
  const applyViewHL = useCallback((c) => {
    const s = readSelection();
    if (!s) return;
    const newHl = [...clearRange(viewHL, s.start, s.end), { start: s.start, end: s.end, color: c }]
      .sort((a, b) => a.start - b.start);
    setVHL(newHl);
    window.getSelection()?.removeAllRanges();
    clearSelState();
    supabase.from('entries').update({highlights:newHl}).eq('id',entry.id).then(()=>{});
    onUpdated({...entry,highlights:newHl});
  }, [readSelection, viewHL, clearSelState, entry, onUpdated]);

  const removeViewHL = useCallback(() => {
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
  }, [readSelection, viewHL, clearSelState, entry, onUpdated]);

  // Keyboard shortcut for the floating highlight bar in view mode — bare
  // mnemonic letters (y/g/b/p/o, r to remove) rather than a chord, since
  // the notes aren't editable here: pressing a letter can only ever mean
  // "I selected some text, now highlight it," never "type this letter."
  // Works whether or not Highlight mode has been toggled on first —
  // selecting text and pressing a letter is already unambiguous intent on
  // its own. Still requires a real, live selection inside the notes
  // (readSelection enforces that) and bails out entirely while some other
  // input/textarea has focus, so it can never interfere with typing
  // anywhere else on the page.
  useEffect(() => {
    if (editing) return;
    const onKeyDown = (e) => {
      if (isTypingTarget(document.activeElement)) return;
      const m = matchHighlightShortcutView(e);
      if (!m || !readSelection()) return;
      e.preventDefault();
      if (m.remove) removeViewHL(); else applyViewHL(m.color);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editing, readSelection, applyViewHL, removeViewHL]);

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
      // A literal NUL character or an unpaired UTF-16 surrogate (both real
      // fallout from pasting out of some PDFs) makes Supabase/PostgREST
      // reject the whole update with "unsupported Unicode escape sequence"
      // — sanitize right before the payload is built, after highlight
      // offsets are already computed against the untouched text, so this
      // can't shift any highlight position.
      // Belt-and-suspenders alongside the title field's own onBlur: guarantees
      // the SAVED title is title-cased even if Save is clicked in the same
      // tick the field blurs (its state update should already have landed by
      // then, but this makes correctness independent of that timing).
      const ok = await updateDB({
        title:sanitizeForStorage(toTitleCase(editTitle.trim())), notes:sanitizeForStorage(trimmedNotes),
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
    setNI([]); setErr(''); setHEOn(false); setPP(false);
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
    setEditInitialHtml(markedTextToHtml(entry.notes||'', entry.highlights||[], t.text, isDark));
    setNI([]); setErr(''); setHEOn(false); setPP(false);
    setEditing(true);
  };

  // ── EDIT MODE ──────────────────────────────────────────────────────────
  // A narrower cap than view mode even on desktop — a form of stacked
  // fields reads worse stretched to full width than a moderate column does.
  const editLocalCss = `
    .mb-dv-input { transition: border-color ${MOTION.fast} ${MOTION.ease}, box-shadow ${MOTION.fast} ${MOTION.ease}; }
    .mb-dv-input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}1f; outline: none; }
  `;

  if (editing) return (
    <div className="mb-detail-shell-narrow" style={{fontFamily:'Inter,sans-serif'}}>
      <style>{editLocalCss}</style>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:SPACE.lg+2}}>
        <IconEdit size={15} style={{color:t.text3,flexShrink:0}} />
        <div style={{fontSize:FONT.size.md,fontWeight:FONT.weight.bold,color:t.text}}>
          Editing: <span style={{color}}>{entry.system}</span>
        </div>
      </div>

      {/* Same gradient-wash + glow treatment as the Add Entry form — one
          premium shell for the whole form, with inner fields staying
          simple (recessed surface2 fill, see .mb-dv-input) rather than
          every element piling on its own gradient. */}
      <div style={{background:`linear-gradient(180deg, ${color}10 0%, ${t.surface} 240px)`,
        border:`1px solid ${t.border}`,borderRadius:RADIUS.xl2,
        boxShadow:`0 24px 56px -30px ${color}40, ${elevation(t,'sm')}`,padding:SPACE.xl2}}>
        <div style={{display:'flex',flexDirection:'column',gap:SPACE.xl}}>
          <F label="TITLE *">
            <input value={editTitle} onChange={e=>setET(e.target.value)}
              onBlur={()=>setET(tt=>toTitleCase(tt))}
              onKeyDown={e=>{ if (e.key==='Enter') e.target.blur(); }}
              className="mb-dv-input" style={inp} autoFocus />
          </F>
          <F label="DIFFICULTY">
            <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
              {DIFFICULTY.map(d=>(
                <button key={d} className="mb-detailbtn" onClick={()=>setED(d)} style={{
                  padding:'7px 16px',borderRadius:RADIUS.pill,border:'none',
                  cursor:'pointer',fontSize:FONT.size.base,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif',
                  background:editDiff===d?`${DIFF_COLOR[d]}1f`:t.surface2,
                  boxShadow:editDiff===d?`0 2px 10px -4px ${DIFF_COLOR[d]}60`:'none',
                  color:editDiff===d?DIFF_COLOR[d]:t.text3}}>{d}</button>
              ))}
            </div>
          </F>
          <F label="REVIEW NOTES">
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,marginBottom:6,flexWrap:'wrap'}}>
              <button className="mb-detailbtn"
                onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                onClick={()=>setHEOn(p=>!p)}
                style={{fontSize:FONT.size.xs,background:hlEditOn?t.hlBtnBg:t.surface2,
                  border:'none',
                  borderRadius:RADIUS.pill,padding:'5px 11px',cursor:'pointer',display:'flex',
                  alignItems:'center',gap:5,
                  color:hlEditOn?t.hlBtnText:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'}}>
                <IconEdit size={11} /> {hlEditOn?'On':'Highlight'}
              </button>
              <button className="mb-detailbtn"
                onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                onClick={()=>toggleBulletLines(editTaRef.current)}
                title="Turn the current line (or selected lines) into bullet points"
                style={{fontSize:FONT.size.xs,background:t.surface2,border:'none',
                  borderRadius:RADIUS.pill,padding:'5px 11px',cursor:'pointer',display:'flex',
                  alignItems:'center',gap:5,
                  color:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'}}>
                <IconListBullet size={11} /> Bullets
              </button>
              <button className="mb-detailbtn"
                onMouseDown={e=>e.preventDefault()} onTouchStart={e=>e.preventDefault()}
                onClick={()=>setPP(p=>!p)}
                title="While on, pasted text is inserted exactly as copied — no auto bold/italic/bullets — so you can format it yourself"
                style={{fontSize:FONT.size.xs,background:plainPaste?t.hlBtnBg:t.surface2,
                  border:'none',
                  borderRadius:RADIUS.pill,padding:'5px 11px',cursor:'pointer',display:'flex',
                  alignItems:'center',gap:5,
                  color:plainPaste?t.hlBtnText:t.text3,fontWeight:FONT.weight.semibold,fontFamily:'Inter,sans-serif'}}>
                {plainPaste?'Plain paste on':'Plain Paste'}
              </button>
              {editHl.highlights.length>0 && <span style={{fontSize:FONT.size.xs,color:t.text4}}>{editHl.highlights.length} highlights</span>}
            </div>
            {hlEditOn && <HLToolbar onApply={editHl.applyHL} onRemove={editHl.removeHL} onClearAll={editHl.clearAllHL} hasSelection={editHl.hasSel} />}
            <div style={{position:'relative', marginTop:8}}>
              {/* A real contentEditable, not a <textarea> — bold/italic/size
                  show formatted here, live, the moment you paste or type
                  them, via the exact same rendering (markedTextToHtml)
                  RenderedNotes/RichRuns.js use for the view-mode render
                  just below. Deliberately uncontrolled after the initial
                  mount per edit session (see editInitialHtml, set by
                  openEdit above): typing, pasting and the bullet/highlight
                  helpers all mutate the live DOM directly, and onInput
                  reads it back into `editNotes` state one-directionally —
                  re-rendering this div's content from React state on every
                  keystroke would reset the caret position on every single
                  character typed. */}
              <div ref={editTaRef}
                contentEditable suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: editInitialHtml }}
                onInput={() => {
                  const next = inlineTextWithMarks(editTaRef.current);
                  editHl.handleTextChange(editNotes, next);
                  setEN(next);
                }}
                onMouseUp={editHl.onSelChange} onKeyUp={editHl.onSelChange} onTouchEnd={editHl.onSelChange}
                onKeyDown={e => { handleBulletKeyDown(e); if (!e.defaultPrevented) editHl.handleShortcut(e); }}
                onPaste={e => plainPaste ? handlePlainPaste(e) : handleRichPaste(e, t.text)}
                className="mb-dv-input"
                style={{...inp, minHeight:200, lineHeight:'1.7',
                  marginTop:0, borderRadius:RADIUS.xl,
                  fontSize:FONT.size.lg, whiteSpace:'pre-wrap', overflowWrap:'break-word',
                  fontWeight:400, letterSpacing:'normal',
                  WebkitTextSizeAdjust:'100%', textSizeAdjust:'100%',
                  caretColor:t.text, color:t.text}} />
            </div>
          </F>
          {editImgs.length>0 && (
            <F label="EXISTING IMAGES">
              <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:8}}>
                {editImgs.map((url,i)=>(
                  <div key={i} style={{position:'relative'}}>
                    <img src={url} alt="" className="mb-detailimg"
                      style={{width:100,height:76,objectFit:'cover',borderRadius:RADIUS.lg,boxShadow:elevation(t,'sm')}} />
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
            <label style={{display:'inline-block',marginTop:8,background:t.surface2,
              border:'none',borderRadius:RADIUS.pill,padding:'8px 16px',
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
                      style={{width:100,height:76,objectFit:'cover',borderRadius:RADIUS.lg,boxShadow:elevation(t,'sm')}} />
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
              display:'flex',alignItems:'center',justifyContent:'center',gap:8,
              boxShadow:saving?'none':`0 4px 14px -2px ${color}55`}}>
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
                  Select text, then tap a colour here, or use the bar that pops up above your selection.
                </div>
              </>
            )}
            {/* maxWidth keeps line length comfortable rather than running the
                full width of a wide tablet/laptop column, without touching
                notesRef's structure — readSelection()'s character-offset
                math walks notesRef's text content, which this doesn't
                change. On mobile the card is already narrower than this,
                so it has no effect there. */}
            {/* mb-study-scope + data-selectable: native-app selection feel
                (no stray OS "Copy/Select All" callout, no browser right-click
                menu) while text stays fully selectable and copyable — see
                lib/studyInteraction.js. Applied regardless of hlViewOn: text
                selection and Ctrl/Cmd+C keep working either way, and when
                highlight mode is on, HLPopover below gives an in-app
                substitute for the browser menu this suppresses. */}
            <div ref={notesRef}
              className={STUDY_SCOPE_CLASS}
              data-selectable="true"
              onContextMenu={suppressContextMenu}
              style={{lineHeight:1.9,fontSize:FONT.size.lg,color:t.text2,maxWidth:640}}>
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

          {/* Usage readout — appears after Analyze, gone the moment you leave
              this entry (plain component state, not saved anywhere). The
              count is a REAL server-side figure now (api/analyze.mjs's
              ai_usage_daily), because Groq's and Gemini's free tiers are
              shared across every signed-in MedBook user via one API key
              each — a per-browser count couldn't mean anything against
              that. Provider is always shown, including when Groq's quota
              ran out and this call actually went to Gemini instead — that
              should be visible, not quietly swapped underneath you. */}
          {usageInfo && (
            <div style={{display:'flex',alignItems:'center',gap:8,
              background:t.surface2,border:`1px solid ${t.border}`,borderRadius:RADIUS.sm+1,
              padding:'6px 12px',marginBottom:SPACE.md,fontSize:FONT.size.xs,color:t.text4}}>
              <IconChart size={12} style={{color:t.text4,flexShrink:0}} />
              <span>
                ~{usageInfo.count} request{usageInfo.count!==1?'s':''} today via{' '}
                <strong style={{color:t.text3}}>
                  {usageInfo.provider === 'gemini' ? 'Gemini' : 'Groq'}{usageInfo.fallback ? ' (fallback)' : ''}
                </strong>
                {' '}· <strong style={{color:t.text3}}>{usageInfo.model}</strong>
                {usageInfo.limits.rpd && (
                  <> · free tier is usually ~{usageInfo.limits.rpm}/min, ~{usageInfo.limits.rpd}/day</>
                )}
              </span>
              <span style={{marginLeft:'auto',fontSize:FONT.size.micro,fontStyle:'italic',opacity:.7}}>
                estimate, not live from the provider
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
              <IconImages size={11} style={{flexShrink:0}} /> Images ({entry.images.length}) - tap to expand
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
