// components/SystemHome.js
//
// The System page — replaces what used to be a small text header (in
// App.js's shared top bar) plus a plain centred list with huge unused
// gutters on either side. This is a full redesign of the COMPOSITION, not
// a re-skin: a full-bleed identity hero establishes hierarchy before the
// notes begin, the notes column widens and gets a proper toolbar, and the
// empty space around it becomes an intentional atmospheric background
// instead of dead space. See SYSTEM_HERO_IMAGE/SYSTEM_BLURBS in
// lib/systemContent.js for why only some systems get a background image.
//
// All data/behaviour here is exactly what App.js already computed and
// owned before this component existed (sysEntries, activeSystemProgress,
// bulk selection, filters, search) — this file is presentational
// composition + the one new, purely-derived addition ("Continue
// Studying", computed from next_review/review_count that already exist)
// and a client-side sort mode that doesn't touch persistence.
import React, { useState, useMemo, useRef } from 'react';
import { SPACE, RADIUS, FONT, MOTION } from '../lib/theme';
import { IconRepeat, IconPlus, IconChevronRight, IconInbox, IconListBullet } from '../lib/icons';
import { SYSTEM_BLURBS, SYSTEM_HERO_IMAGE } from '../lib/systemContent';
import FilterChips from './FilterChips';
import EntryCard from './EntryCard';

const CONTENT_MAX_WIDTH = 880;

// ── Continue Studying — derived, not fabricated: the entry that's overdue
// soonest, or (nothing due) the most recent entry that's never been
// reviewed at all. Absent entirely when neither exists (a fresh system, or
// one that's fully caught up) rather than showing something meaningless.
function pickContinueEntry(allEntries) {
  const now = Date.now();
  const due = allEntries
    .filter(e => e.next_review && new Date(e.next_review).getTime() <= now)
    .sort((a, b) => new Date(a.next_review) - new Date(b.next_review));
  if (due.length) return { entry: due[0], reason: 'due' };
  const fresh = allEntries
    .filter(e => !e.review_count)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (fresh.length) return { entry: fresh[0], reason: 'new' };
  return null;
}

function SystemHero({ t, system, color, total, progress, onAdd, onReview, continueInfo, onOpen, isMobile }) {
  const blurb = SYSTEM_BLURBS[system];
  const image = SYSTEM_HERO_IMAGE[system];

  return (
    <div style={{ position:'relative', overflow:'hidden' }}>
      {image && !isMobile && (
        <img src={image.src} alt="" aria-hidden="true" loading="lazy" decoding="async" style={{
          position:'absolute', top:0, right:0, height:'100%', width:'42%', objectFit:'cover',
          opacity:0.09, filter:'grayscale(0.6) blur(2px) contrast(0.85)',
          WebkitMaskImage:'linear-gradient(to left, black 30%, transparent 88%)',
          maskImage:'linear-gradient(to left, black 30%, transparent 88%)',
        }} />
      )}

      <div style={{ position:'relative', maxWidth:CONTENT_MAX_WIDTH, margin:'0 auto',
        padding: isMobile ? `${SPACE.xl2}px ${SPACE.lg}px ${SPACE.lg}px` : `${SPACE.xl5}px ${SPACE.xl2}px ${SPACE.xl2}px`,
        display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:SPACE.xl3, flexWrap:'wrap' }}>

        <div style={{ minWidth:0, flex:'1 1 360px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ width:8, height:8, borderRadius:RADIUS.circle, background:color, flexShrink:0 }} />
            <h1 style={{ margin:0, fontSize: isMobile ? 26 : 36, fontWeight:FONT.weight.bold,
              color:t.text, letterSpacing:'-0.01em', lineHeight:1.1,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {system}
            </h1>
          </div>

          {blurb && (
            <p style={{ margin:`${SPACE.sm}px 0 0`, fontSize:FONT.size.md, color:t.text3,
              lineHeight:FONT.leading.relaxed, maxWidth:480 }}>
              {blurb}
            </p>
          )}

          <div style={{ marginTop:SPACE.md, fontSize:FONT.size.sm, color:t.text4 }}>
            {total} {total===1?'entry':'entries'}
            {total > 0 && (
              <>
                {progress.due > 0 && <span style={{ color, fontWeight:FONT.weight.semibold }}> · {progress.due} due for review</span>}
                {' · '}{progress.reviewed} of {total} reviewed
              </>
            )}
          </div>

          <div style={{ display:'flex', gap:SPACE.sm+2, marginTop:SPACE.xl, flexWrap:'wrap' }}>
            <button className="mb-hero-cta" onClick={onAdd} style={{
              background:color, color:'#fff', border:'none', borderRadius:RADIUS.md,
              padding:'11px 20px', fontSize:FONT.size.base, fontWeight:FONT.weight.semibold,
              cursor:'pointer', display:'inline-flex', alignItems:'center', gap:7,
              boxShadow:`0 4px 14px ${color}40` }}>
              <IconPlus size={14} /> Add Entry
            </button>
            {total > 0 && (
              <button className="mb-hero-ghost" onClick={onReview} style={{
                background:'transparent', color:t.text2, border:`1px solid ${t.borderStrong}`,
                borderRadius:RADIUS.md, padding:'11px 18px', fontSize:FONT.size.base,
                fontWeight:FONT.weight.semibold, cursor:'pointer',
                display:'inline-flex', alignItems:'center', gap:7 }}>
                <IconRepeat size={14} /> Review
              </button>
            )}
          </div>
        </div>

        {continueInfo && (
          <button onClick={()=>onOpen(continueInfo.entry)} className="mb-continue"
            style={{ background:'none', border:'none', cursor:'pointer', textAlign:'left',
              padding:'10px 12px', margin:'0 -12px', borderRadius:RADIUS.md,
              flex: isMobile ? '1 1 100%' : '0 1 300px', minWidth:0,
              display:'flex', alignItems:'center', gap:10,
              transition:`background ${MOTION.fast} ${MOTION.ease}` }}>
            <div style={{ minWidth:0, flex:1 }}>
              <div style={{ fontSize:FONT.size.micro, letterSpacing:.8, textTransform:'uppercase',
                fontWeight:FONT.weight.semibold, color:t.text4, marginBottom:3 }}>
                {continueInfo.reason==='due' ? 'Continue studying' : 'Pick up next'}
              </div>
              <div style={{ fontSize:FONT.size.base, fontWeight:FONT.weight.semibold, color:t.text,
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {continueInfo.entry.title}
              </div>
            </div>
            <IconChevronRight size={15} style={{ color:t.text4, flexShrink:0 }} />
          </button>
        )}
      </div>
    </div>
  );
}

const SORT_OPTIONS = [
  { key:'recent', label:'Recent' },
  { key:'title',  label:'Title A–Z' },
  { key:'due',    label:'Due first' },
];

function sortEntries(list, sortMode) {
  if (sortMode === 'recent') return list; // already pinned-first/insertion order from the parent
  const arr = [...list];
  if (sortMode === 'title') {
    arr.sort((a, b) => (a.pinned !== b.pinned) ? (a.pinned ? -1 : 1) : a.title.localeCompare(b.title));
  } else if (sortMode === 'due') {
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ad = a.next_review ? new Date(a.next_review).getTime() : Infinity;
      const bd = b.next_review ? new Date(b.next_review).getTime() : Infinity;
      return ad - bd;
    });
  }
  return arr;
}

// Long-press (touch) / right-click (desktop) enters bulk-select mode —
// verbatim behaviour from the previous inline version in App.js (including
// the overlay-badge checkbox treatment), just relocated to where it's
// actually used, and memoised for the same reason it was before: with
// hundreds of cards, this stops every card re-rendering on each keystroke/
// selection change. Parent must keep passing stable callback props.
const SelectableCard = React.memo(function SelectableCard({ t, entry, color, bulkMode, isSelected, onOpen, onToggleSelect, onStartBulk }) {
  const timer = useRef(null);
  const moved = useRef(false);
  const fired = useRef(false);
  const startXY = useRef({ x:0, y:0 });
  const [pressed, setPressed] = useState(false);

  const HOLD_MS = 650;
  const MOVE_TOLERANCE_PX = 10;

  const startPress = (e) => {
    const t0 = e.touches?.[0];
    startXY.current = t0 ? { x:t0.clientX, y:t0.clientY } : { x:0, y:0 };
    moved.current = false; fired.current = false; setPressed(true);
    timer.current = setTimeout(() => { if (!moved.current) { fired.current = true; onStartBulk(entry.id); } }, HOLD_MS);
  };
  const endPress = () => { clearTimeout(timer.current); setPressed(false); };
  const cancelPress = () => { clearTimeout(timer.current); setPressed(false); };
  const trackMove = (e) => {
    const t0 = e.touches?.[0];
    if (!t0) return;
    const dx = t0.clientX - startXY.current.x, dy = t0.clientY - startXY.current.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) { moved.current = true; clearTimeout(timer.current); setPressed(false); }
  };

  const tap = () => { if (bulkMode) onToggleSelect(entry.id); else onOpen(entry); };
  const handleClick = () => { if (fired.current) { fired.current = false; return; } tap(); };

  return (
    <div data-bulk-card style={{ position:'relative', outline:isSelected?`2px solid ${color}`:'none',
      borderRadius:RADIUS.md, cursor:'pointer',
      WebkitUserSelect:'none', userSelect:'none',
      transform: pressed ? 'scale(0.985)' : 'scale(1)',
      transition:`outline ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}` }}
      onClick={handleClick}
      onContextMenu={e=>{e.preventDefault();fired.current=true;onStartBulk(entry.id);}}
      onMouseDown={()=>setPressed(true)} onMouseUp={()=>setPressed(false)} onMouseLeave={()=>setPressed(false)}
      onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={trackMove} onTouchCancel={cancelPress}>
      {bulkMode && (
        <div style={{ position:'absolute', top:10, left:10, zIndex:10, width:22, height:22,
          borderRadius:RADIUS.sm, background:isSelected?color:t.surface,
          border:`2px solid ${isSelected?color:t.borderStrong}`,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:`0 1px 2px ${t.shadow}`, pointerEvents:'none',
          transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}` }}>
          {isSelected && <span style={{ color:'#fff', fontSize:FONT.size.sm, fontWeight:FONT.weight.bold }}>✓</span>}
        </div>
      )}
      <EntryCard entry={entry} color={color} />
    </div>
  );
});
function bulkBtnStyle(color) {
  return { fontSize:FONT.size.sm, background:`${color}10`, border:`1px solid ${color}30`,
    color, borderRadius:RADIUS.sm, padding:'5px 10px', cursor:'pointer', fontWeight:FONT.weight.semibold };
}

export default function SystemHome({
  t, isDark, system, color, allEntries, sysEntries, progress,
  search, setSearch, difficultyFilter, setDifficultyFilter, pinnedOnly, setPinnedOnly,
  bulkMode, setBulkMode, selected2, toggleSelect, onOpen, onStartBulk,
  onAdd, onReview, userSystems, bulkPin, bulkMove, bulkDelete, isMobile,
}) {
  const [sortMode, setSortMode] = useState('recent');
  const total = allEntries.length;

  const continueInfo = useMemo(() => (total > 0 ? pickContinueEntry(allEntries) : null), [allEntries, total]);
  const shown = useMemo(() => sortEntries(sysEntries, sortMode), [sysEntries, sortMode]);

  // A soft colour-wash tuned per theme — reads as "premium, barely-there"
  // in light mode; would vanish against dark's near-black surface at the
  // same alpha, so dark gets a touch more. Deliberately NOT confined to the
  // hero: it's positioned on this whole page's outer wrapper and fades out
  // roughly a screen-and-a-half down, so the space beside the first stretch
  // of notes still feels like part of one designed page instead of the
  // hero's atmosphere cutting off at a hard seam the moment the list
  // begins. Same idiom the public landing page's hero uses, just scoped
  // to a bounded top region rather than the whole scrollable page — a
  // notes list can run to hundreds of entries, and glowing gradients for
  // its entire length would be exactly the "giant glowing gradient" this
  // redesign is supposed to avoid.
  const wash = isDark
    ? `radial-gradient(1000px 620px at 85% 0%, ${color}26, transparent 60%), radial-gradient(800px 520px at 6% 55%, ${color}12, transparent 65%)`
    : `radial-gradient(1000px 620px at 85% 0%, ${color}17, transparent 60%), radial-gradient(800px 520px at 6% 55%, ${color}0a, transparent 65%)`;

  return (
    <div style={{ position:'relative' }}>
      <div aria-hidden="true" style={{ position:'absolute', top:0, left:0, right:0,
        height: isMobile ? 560 : 860, background:wash, pointerEvents:'none' }} />
      <style>{`
        .mb-hero-cta { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-hero-cta:hover { filter: brightness(1.06); }
        .mb-hero-cta:active { transform: scale(0.97); }
        .mb-hero-ghost:hover { background: ${t.surface2}; border-color: ${t.text4}; }
        .mb-hero-ghost:active { transform: scale(0.97); }
        .mb-continue:hover { background: ${t.surface2}; }
        .mb-sorttoggle:hover { background: ${t.surface2}; }
      `}</style>

      <SystemHero t={t} system={system} color={color} total={total} progress={progress}
        onAdd={onAdd} onReview={onReview} continueInfo={continueInfo} onOpen={onOpen} isMobile={isMobile} />

      <div style={{ position:'relative', maxWidth:CONTENT_MAX_WIDTH, margin:'0 auto', padding: isMobile ? `${SPACE.lg}px` : `${SPACE.xl2}px` }}>

        {total > 0 && (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
              {!isMobile && (
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${system}…`}
                  style={{ flex:'1 1 220px', minWidth:160, background:t.surface2, border:`1px solid ${t.border}`,
                    borderRadius:RADIUS.sm+1, color:t.text, padding:'8px 12px', fontSize:FONT.size.base, outline:'none' }} />
              )}
              {isMobile && (
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${system}…`}
                  style={{ flex:'1 1 auto', minWidth:0, background:t.surface2, border:`1px solid ${t.border}`,
                    borderRadius:RADIUS.sm+1, color:t.text, padding:'9px 12px', fontSize:FONT.size.base, outline:'none' }} />
              )}
              <button className="mb-bulkbtn" onClick={()=>setBulkMode(p=>!p)} style={{
                fontSize:FONT.size.sm, flexShrink:0,
                background:bulkMode?t.navActiveBg:t.surface3, border:`1px solid ${bulkMode?t.navActiveBorder:t.border}`,
                borderRadius:RADIUS.sm, padding:'7px 12px', cursor:'pointer',
                color:bulkMode?t.navActiveText:t.text3, fontWeight:FONT.weight.semibold }}>
                {bulkMode ? `☑ ${selected2.size} selected` : '☑ Select'}
              </button>

              {!bulkMode && !isMobile && (
                <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                  <IconListBullet size={13} style={{ color:t.text4 }} />
                  <select value={sortMode} onChange={e=>setSortMode(e.target.value)} className="mb-sorttoggle"
                    style={{ fontSize:FONT.size.sm, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm,
                      padding:'6px 9px', cursor:'pointer', color:t.text2, background:t.surface }}>
                    {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
              )}

              {bulkMode && selected2.size > 0 && (<>
                <button className="mb-bulkbtn" onClick={()=>bulkPin(true)} style={bulkBtnStyle('#d97706')}>📌 Pin</button>
                <button className="mb-bulkbtn" onClick={()=>bulkPin(false)} style={bulkBtnStyle('#6b7280')}>Unpin</button>
                <select onChange={e=>{ if (e.target.value) { bulkMove(e.target.value); e.target.value=''; } }}
                  defaultValue="" style={{ fontSize:FONT.size.sm, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm,
                    padding:'5px 10px', cursor:'pointer', color:t.text2, background:t.surface }}>
                  <option value="" disabled>Move to…</option>
                  {userSystems.filter(s=>s.name!==system).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
                <button className="mb-bulkbtn" onClick={bulkDelete} style={bulkBtnStyle('#dc2626')}>🗑 Delete</button>
              </>)}
              {bulkMode && selected2.size === 0 && (
                <span style={{ fontSize:FONT.size.sm, color:t.text4 }}>
                  {isMobile ? 'Tap cards to select' : 'Click or right-click to select'}
                </span>
              )}
            </div>

            <FilterChips t={t} difficultyFilter={difficultyFilter} setDifficultyFilter={setDifficultyFilter}
              pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} disabled={bulkMode} />
            <div style={{ height:SPACE.md }} />
          </>
        )}

        {total === 0 ? (
          <div style={{ textAlign:'center', padding:'60px 20px', animation:`medbook-fade-in ${MOTION.normal} ${MOTION.ease}` }}>
            <div style={{ width:56, height:56, borderRadius:RADIUS.xl2, background:t.surface3,
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <IconInbox size={24} style={{ color:t.text4 }} />
            </div>
            <div style={{ fontSize:FONT.size.base, color:t.text3 }}>No entries yet for {system}</div>
            <button className="mb-hero-cta" onClick={onAdd} style={{ marginTop:16,
              background:color, color:'#fff', border:'none', borderRadius:RADIUS.md,
              padding:'10px 22px', fontSize:FONT.size.base, fontWeight:FONT.weight.semibold, cursor:'pointer',
              display:'inline-flex', alignItems:'center', gap:7 }}>
              <IconPlus size={14} /> Add First Entry
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div style={{ textAlign:'center', padding:'60px 20px', animation:`medbook-fade-in ${MOTION.normal} ${MOTION.ease}` }}>
            <div style={{ width:56, height:56, borderRadius:RADIUS.xl2, background:t.surface3,
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <IconInbox size={24} style={{ color:t.text4 }} />
            </div>
            <div style={{ fontSize:FONT.size.base, color:t.text3 }}>No entries match your search and filters</div>
          </div>
        ) : (
          <div key={`${search}-${difficultyFilter}-${pinnedOnly}-${sortMode}`}
            style={{ display:'flex', flexDirection:'column', gap:8, animation:`medbook-fade-in ${MOTION.fast} ${MOTION.ease}` }}>
            {shown.map(entry => (
              <SelectableCard key={entry.id} t={t} entry={entry} color={color} bulkMode={bulkMode}
                isSelected={selected2.has(entry.id)} onOpen={onOpen}
                onToggleSelect={toggleSelect} onStartBulk={onStartBulk} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
