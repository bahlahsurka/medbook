// components/SystemHome.js
//
// The System page. Second pass at this component — the first attempt
// (identity hero + full-bleed colour wash + a grayscaled/blurred stock-style
// background image) still read as a generic AI-dashboard hero: an artificial
// gradient standing in for real content. This version removes the wash and
// the borrowed landing-page artwork entirely and replaces them with the
// system's OWN real entry images, arranged as a small editorial mosaic next
// to the title — the user's actual medical knowledge becomes the page's
// visual identity instead of a decorative backdrop. See pickHeroImages()
// below. A system with no photographed entries yet simply gets a
// typography-only header — nothing is ever generated or substituted.
//
// All data/behaviour here is exactly what App.js already computed and
// owned before this component existed (sysEntries, activeSystemProgress,
// bulk selection, filters, search) — this file is presentational
// composition + the one derived addition ("Continue Studying", computed
// from next_review/review_count that already exist) and a client-side sort
// mode that doesn't touch persistence.
import React, { useState, useMemo, useRef } from 'react';
import { SPACE, RADIUS, FONT, MOTION } from '../lib/theme';
import { IconRepeat, IconPlus, IconChevronRight, IconInbox, IconListBullet } from '../lib/icons';
import { SYSTEM_BLURBS } from '../lib/systemContent';
import FilterChips from './FilterChips';
import EntryCard from './EntryCard';

const CONTENT_MAX_WIDTH = 1040;
const MOSAIC_MAX_DESKTOP = 3;
const MOSAIC_MAX_MOBILE = 2;

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

// ── Real imagery, pulled straight from the system's own entries — never
// generated, never stock, never blurred into abstraction. One image per
// entry (most recent entries first) so the mosaic reads as several
// different cases rather than one entry's photos repeated. A system with
// no photographed entries returns an empty array and the hero simply runs
// typography-only across the full width — nothing stands in for a missing
// image.
function pickHeroImages(allEntries, max) {
  return allEntries
    .filter(e => e.images?.length > 0)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, max)
    .map(e => ({ src: e.images[0], entry: e }));
}

// A small curated mosaic rather than a uniform grid: one image genuinely
// dominant, the rest supporting it — the arrangement (and each tile's
// aspect ratio) changes with how many real photographed entries exist,
// down to a single asymmetrically-sized image rather than stretching one
// photo to fill a grid built for three. Every tile opens the entry it's
// from — the imagery is real content, not decoration, so it stays useful.
function HeroImageMosaic({ t, images, onOpen, isMobile }) {
  const shown = images.slice(0, isMobile ? MOSAIC_MAX_MOBILE : MOSAIC_MAX_DESKTOP);
  if (!shown.length) return null;
  const count = shown.length;

  const tilePos = (i) => {
    if (count === 1) return { gridColumn:'1', gridRow:'1' };
    if (count === 2) return { gridColumn: i===0 ? '1' : '2', gridRow:'1' };
    return i===0 ? { gridColumn:'1', gridRow:'1 / 3' } : { gridColumn:'2', gridRow: i===1 ? '1' : '2' };
  };

  return (
    <div style={{
      width: isMobile ? '100%' : (count===1 ? 220 : 320),
      height: isMobile ? 120 : (count===1 ? 240 : 264),
      display:'grid', gap: isMobile ? 6 : 8, flexShrink:0,
      gridTemplateColumns: count===1 ? '1fr' : '1.3fr 1fr',
      gridTemplateRows: count===3 ? '1fr 1fr' : '1fr',
    }}>
      {shown.map((img, i) => (
        <button key={img.entry.id} className="mb-mosaic-tile" onClick={()=>onOpen(img.entry)} title={img.entry.title}
          style={{ ...tilePos(i), padding:0, margin:0, minWidth:0, minHeight:0, overflow:'hidden',
            border:`1px solid ${t.border}`, borderRadius:RADIUS.lg, cursor:'pointer', background:t.surface3 }}>
          <img src={img.src} alt="" loading="lazy" decoding="async"
            style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
        </button>
      ))}
    </div>
  );
}

// The header itself. Deliberately not one enclosing card/panel — it sits
// directly on the page like the opening of a chapter: a small eyebrow
// label, the system name, a one-line description, the review-state line,
// then actions. On desktop the real-image mosaic sits beside that column;
// on mobile it drops in as a short, bounded strip right after the
// description rather than either a giant vertical block or being pushed
// below the fold.
function SystemHero({ t, system, color, total, progress, onAdd, onReview, continueInfo, onOpen, heroImages, isMobile }) {
  const blurb = SYSTEM_BLURBS[system];

  const eyebrow = (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
      <span style={{ width:6, height:6, borderRadius:RADIUS.circle, background:color, flexShrink:0 }} />
      <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold,
        letterSpacing:'0.14em', textTransform:'uppercase', color:t.text4 }}>System</span>
    </div>
  );

  const titleEl = (
    <h1 style={{ margin:0, fontSize: isMobile?28:38, fontWeight:FONT.weight.bold,
      color:t.text, letterSpacing:'-0.02em', lineHeight:1.08 }}>
      {system}
    </h1>
  );

  const blurbEl = blurb && (
    <p style={{ margin:'12px 0 0', fontSize:FONT.size.md, color:t.text3,
      lineHeight:FONT.leading.relaxed, maxWidth:460 }}>
      {blurb}
    </p>
  );

  const statsEl = (
    <div style={{ fontSize:FONT.size.sm, color:t.text4 }}>
      {total} {total===1?'entry':'entries'}
      {total > 0 && (<>
        {progress.due > 0 && <span style={{ color, fontWeight:FONT.weight.semibold }}> · {progress.due} due for review</span>}
        {' · '}{progress.reviewed} of {total} reviewed
      </>)}
    </div>
  );

  const actionsEl = (
    <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm+2, flexWrap:'wrap' }}>
      <button className="mb-hero-cta" onClick={onAdd} style={{
        background:color, color:'#fff', border:'none', borderRadius:RADIUS.md,
        padding:'11px 20px', fontSize:FONT.size.base, fontWeight:FONT.weight.semibold,
        cursor:'pointer', display:'inline-flex', alignItems:'center', gap:7 }}>
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
      {continueInfo && (
        <button className="mb-continue-link" onClick={()=>onOpen(continueInfo.entry)} style={{
          background:'none', border:'none', padding:'6px 2px', cursor:'pointer',
          display:'inline-flex', alignItems:'center', gap:6, fontSize:FONT.size.base, color:t.text4, minWidth:0 }}>
          <span style={{ flexShrink:0 }}>{continueInfo.reason==='due' ? 'Continue' : 'Pick up next'}:</span>
          <span style={{ color:t.text2, fontWeight:FONT.weight.semibold,
            maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {continueInfo.entry.title}
          </span>
          <IconChevronRight size={13} style={{ flexShrink:0 }} />
        </button>
      )}
    </div>
  );

  const mosaicEl = heroImages.length > 0 && (
    <HeroImageMosaic t={t} images={heroImages} onOpen={onOpen} isMobile={isMobile} />
  );

  if (isMobile) {
    return (
      <div style={{ maxWidth:CONTENT_MAX_WIDTH, margin:'0 auto', padding:`${SPACE.xl2}px ${SPACE.lg}px 0` }}>
        {eyebrow}
        {titleEl}
        {blurbEl}
        {mosaicEl && <div style={{ marginTop:18 }}>{mosaicEl}</div>}
        <div style={{ marginTop:18 }}>{statsEl}</div>
        <div style={{ marginTop:16 }}>{actionsEl}</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth:CONTENT_MAX_WIDTH, margin:'0 auto', padding:`${SPACE.xl4}px ${SPACE.xl2}px 0` }}>
      <div style={{ display:'flex', gap:48, alignItems:'flex-start' }}>
        <div style={{ flex:'1 1 380px', minWidth:0 }}>
          {eyebrow}
          {titleEl}
          {blurbEl}
          <div style={{ marginTop:18 }}>{statsEl}</div>
          <div style={{ marginTop:22 }}>{actionsEl}</div>
        </div>
        {mosaicEl}
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
  t, system, color, allEntries, sysEntries, progress,
  search, setSearch, difficultyFilter, setDifficultyFilter, pinnedOnly, setPinnedOnly,
  bulkMode, setBulkMode, selected2, toggleSelect, onOpen, onStartBulk,
  onAdd, onReview, userSystems, bulkPin, bulkMove, bulkDelete, isMobile,
}) {
  const [sortMode, setSortMode] = useState('recent');
  const total = allEntries.length;

  const continueInfo = useMemo(() => (total > 0 ? pickContinueEntry(allEntries) : null), [allEntries, total]);
  const shown = useMemo(() => sortEntries(sysEntries, sortMode), [sysEntries, sortMode]);
  const heroImages = useMemo(() => pickHeroImages(allEntries, MOSAIC_MAX_DESKTOP), [allEntries]);

  return (
    <div>
      <style>{`
        .mb-hero-cta { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-hero-cta:hover { filter: brightness(1.06); }
        .mb-hero-cta:active { transform: scale(0.97); }
        .mb-hero-ghost:hover { background: ${t.surface2}; border-color: ${t.text4}; }
        .mb-hero-ghost:active { transform: scale(0.97); }
        .mb-continue-link:hover span:nth-child(2) { color: ${color}; }
        .mb-sorttoggle:hover { background: ${t.surface2}; }
        .mb-mosaic-tile { transition: border-color ${MOTION.fast} ${MOTION.ease}; }
        .mb-mosaic-tile img { transition: transform ${MOTION.slow} ${MOTION.ease}; }
        .mb-mosaic-tile:hover { border-color: ${t.borderStrong}; }
        .mb-mosaic-tile:hover img { transform: scale(1.045); }
      `}</style>

      <SystemHero t={t} system={system} color={color} total={total} progress={progress}
        onAdd={onAdd} onReview={onReview} continueInfo={continueInfo} onOpen={onOpen}
        heroImages={heroImages} isMobile={isMobile} />

      {total > 0 && (
        <div style={{ maxWidth:CONTENT_MAX_WIDTH, margin:'0 auto', padding: isMobile?`0 ${SPACE.lg}px`:`0 ${SPACE.xl2}px` }}>
          <div style={{ height:1, background:t.border, margin: isMobile?`${SPACE.xl2}px 0 ${SPACE.xl}px`:`${SPACE.xl4}px 0 ${SPACE.xl}px` }} />
        </div>
      )}

      <div style={{ maxWidth:CONTENT_MAX_WIDTH, margin:'0 auto',
        padding: isMobile ? `0 ${SPACE.lg}px ${SPACE.xl2}px` : `0 ${SPACE.xl2}px ${SPACE.xl2}px` }}>

        {total > 0 && (
          <>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:16 }}>
              <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold,
                letterSpacing:'0.14em', textTransform:'uppercase', color:t.text4 }}>Your Knowledge</span>
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${system}…`}
                style={{ flex: isMobile ? '1 1 auto' : '1 1 220px', minWidth: isMobile?0:160,
                  background:t.surface2, border:`1px solid ${t.border}`,
                  borderRadius:RADIUS.sm+1, color:t.text, padding: isMobile?'9px 12px':'8px 12px',
                  fontSize:FONT.size.base, outline:'none' }} />

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
