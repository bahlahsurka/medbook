// components/LandingPage.js
//
// Public marketing page — rendered at "/" for a signed-out visitor (see the
// render gate in App.js).
//
// Batch 1: sticky nav, hero (+CTAs+creator line), a real-MedBook-UI product
// preview, and a first pass at the "A better way to learn medicine." /
// Learn → Review → Remember composition.
//
// Batch 2: replaces that first-pass LRR with the fuller composition — a
// single shared panel (not three floating cards) that opens with a compact
// real-UI "loop" strip proving the product supports the whole cycle
// (Entry → System → Review Queue → Flashcard → back into Review), then the
// three Learn/Review/Remember stages beneath it as one divided row rather
// than three repeated feature cards, closing on the "Your medical
// knowledge, built to stay with you." transition line.
//
// Batch 3: the knowledge-workspace narrative ("Your knowledge, connected.")
// — one asymmetric real-UI showcase rather than five separate Review
// Entries/Systems/Search/Review Queue/Dashboard chapters. A large primary
// panel recreates the actual entry reading pane (system + title +
// highlighted Review Notes, with the real app's own toolbar/search chrome
// above it), with two smaller supporting panels beside it — a Systems
// browse list and a Dashboard/Review Queue stat strip — asymmetrically
// gridded rather than alternating text/screenshot blocks.
//
// Batch 4 (this pass): "Medicine is visual" — real, supplied medical
// diagrams (see lib/landingImages.js) walked through a SEE -> KEEP ->
// REVIEW -> REMEMBER narrative: a genuine diagram at full size, the SAME
// image shown living inside a real MedBook Review Entry, a brief resurface
// beat, then two HONEST recall paths — turning the entry's own facts into a
// text flashcard (real, for any entry), and Image Occlusion (real, but only
// for cards inside an IMPORTED Anki deck — labeled as such, never implied
// as something you can do to an arbitrary uploaded image, since MedBook
// has no UI for drawing your own occlusion regions). A restrained strip of
// four more real diagrams proves the breadth (pharmacology, dermatology,
// oncology, pathophysiology) without becoming an image gallery.
//
// Everything past that (Flashcards, AI section, About/Creator section,
// final CTA, footer) is intentionally NOT here yet — later batches.
//
// THEME: deliberately just useTheme(), the same hook every authenticated
// screen uses — no separate CSS-variable/media-query system. theme.js's
// readInitial() now falls back to prefers-color-scheme when no explicit
// choice is saved yet (see that file), which covers "automatically follow
// system theme" for the visitors who land here (nobody reaches this page
// having ever set an in-app preference), AND keeps this page's own chrome
// pixel-identical to the real EntryCard instances embedded in the product
// preview below, which read their colours from this same hook. A visitor
// flipping their OS theme live mid-visit won't be reflected until next
// load — the same one-time-read behaviour the rest of the app already has.
//
// ROUTING: no router library. App.js tracks window.location.pathname with
// a plain popstate listener; "Get Started"/"Sign In" push "/app" and let
// the existing session-gated render take over from there. See App.js.

import { useEffect, useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, MOTION, BREAKPOINT, elevation } from '../lib/theme';
import { IconPulse, IconSearch, IconRepeat, IconCards, IconChart, IconEdit,
  IconCheck, IconChevronRight, IconLayers, IconPin, IconImages } from '../lib/icons';
import { SYS_COLOR } from '../lib/constants';
import { HL_COLORS, resolveHL } from '../lib/highlights';
import { LANDING_IMAGES } from '../lib/landingImages';
import EntryCard from './EntryCard';

// Realistic, generic textbook-style study content — same voice as the
// app's own real placeholder text (AddEntry.js's title field placeholder
// is literally "e.g. Digoxin toxicity — ECG changes"). No real patient
// data, no copyrighted material; just plausible med-school review topics.
function mockEntries() {
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
  return [
    { id:'p1', title:'Digoxin toxicity: ECG changes', system:'Cardiology',
      notes:'Scooped ST depression, PR prolongation, and coloured-vision complaints are the classic exam triad.',
      review_count:3, next_review:null, images:[], pinned:true, created_at:daysAgo(2) },
    { id:'p2', title:'Cranial nerve exam: quick reference', system:'Neurology',
      notes:'CN III palsy: "down and out" eye with ptosis. CN VII: forehead-sparing means an upper motor neuron lesion.',
      review_count:0, next_review:daysAgo(1), images:[], pinned:false, created_at:daysAgo(5) },
    { id:'p3', title:'Beta-lactam mechanism of action', system:'Pharmacology',
      notes:'Bind penicillin-binding proteins, blocking the transpeptidase step of cell-wall synthesis.',
      review_count:6, next_review:null, images:[], pinned:false, created_at:daysAgo(9) },
  ];
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduced(mq.matches);
      const onChange = e => setReduced(e.matches);
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    } catch { /* matchMedia unavailable — treat as no preference */ }
  }, []);
  return reduced;
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
}

// ── Nav ──────────────────────────────────────────────────────────────────
function BrandMark({ t, size = 30, iconSize = 16 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:RADIUS.md, background:t.accent,
      display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', flexShrink:0 }}>
      <IconPulse size={iconSize} />
    </div>
  );
}

function Nav({ t, onGetStarted }) {
  return (
    <header className="mb-land-nav" style={{ position:'sticky', top:0, zIndex:100,
      background:t.surface, borderBottom:`1px solid ${t.border}` }}>
      <div className="mb-land-nav-inner" style={{ maxWidth:1160, margin:'0 auto',
        padding:`${SPACE.md}px ${SPACE.lg}px`, display:'flex', alignItems:'center',
        justifyContent:'space-between', gap:SPACE.md }}>
        <div style={{ display:'flex', alignItems:'center', gap:SPACE.sm+2 }}>
          <BrandMark t={t} />
          <span style={{ fontSize:FONT.size.md, fontWeight:FONT.weight.bold, color:t.text }}>MedBook</span>
        </div>

        {/* No hamburger/drawer — there are no other nav destinations yet in
            Batch 1. Below ~420px "Sign In" drops (Get Started alone covers
            both intents), rather than a menu with nothing else in it. */}
        <nav className="mb-land-nav-actions" style={{ display:'flex', alignItems:'center', gap:SPACE.lg }}
          aria-label="Primary">
          <a href="/app" onClick={e=>{e.preventDefault(); onGetStarted();}}
            style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:t.text2,
              textDecoration:'none', cursor:'pointer' }}>Sign In</a>
          <button className="mb-land-btn mb-land-btn-primary" onClick={onGetStarted} style={{
            background:t.accent, color:'#fff', border:'none', borderRadius:RADIUS.sm+1,
            padding:'9px 18px', fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold,
            cursor:'pointer', fontFamily:'Inter,sans-serif' }}>Get Started</button>
        </nav>
      </div>
    </header>
  );
}

// ── Hero product preview — real MedBook UI, faithfully recreated ─────────
// Not a screenshot (no login/capture pipeline reaches this far), but not a
// generic mockup either: this reuses the ACTUAL EntryCard component and
// mirrors Sidebar.js/Dashboard.js's real nav items, icons, colours and
// spacing exactly — the same design system, not a decorative stand-in.
function SummaryTile({ t, label, value, accent }) {
  return (
    <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
      borderTop: accent ? `2px solid ${t.accent}` : `1px solid ${t.border}`,
      padding:`${SPACE.sm+2}px ${SPACE.md}px` }}>
      <div style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.6,
        fontWeight:FONT.weight.semibold, textTransform:'uppercase', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:FONT.weight.bold, color: accent ? t.accent : t.text }}>{value}</div>
    </div>
  );
}

const NAV_ROW = [
  { icon:IconSearch, label:'Global Search' },
  { icon:IconRepeat, label:'Review Queue' },
  { icon:IconCards,  label:'Flashcards' },
  { icon:IconChart,  label:'Dashboard', active:true },
  { icon:IconLayers, label:'Insights' },
];

function ProductPreview({ t }) {
  const entries = mockEntries();
  return (
    <div className="mb-land-window" aria-hidden="true" style={{ background:t.surface,
      border:`1px solid ${t.border}`, borderRadius:RADIUS.xl2, boxShadow:elevation(t,'xl'),
      overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 16px',
        borderBottom:`1px solid ${t.border}`, background:t.surface2 }}>
        <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#ff5f57' }} />
        <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#febc2e' }} />
        <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#28c840' }} />
      </div>
      <div className="mb-land-window-body" style={{ display:'flex' }}>
        <div className="mb-land-window-rail" style={{ width:196, flexShrink:0,
          borderRight:`1px solid ${t.border}`, background:t.surface, padding:`${SPACE.md}px ${SPACE.sm+2}px` }}>
          <div style={{ display:'flex', alignItems:'center', gap:SPACE.xs+2, marginBottom:SPACE.lg, padding:'0 4px' }}>
            <BrandMark t={t} size={24} iconSize={13} />
            <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.bold, color:t.text }}>MedBook</span>
          </div>
          {NAV_ROW.map(n => (
            <div key={n.label} style={{ display:'flex', alignItems:'center', gap:SPACE.sm,
              padding:'6px 8px', borderRadius:RADIUS.sm+1, marginBottom:1,
              background: n.active ? t.navActiveBg : 'transparent',
              color: n.active ? t.navActiveText : t.text3,
              fontSize:FONT.size.xs, fontWeight: n.active ? FONT.weight.semibold : FONT.weight.medium }}>
              <n.icon size={13} style={{ flexShrink:0 }} />
              <span>{n.label}</span>
            </div>
          ))}
        </div>
        <div className="mb-land-window-main" style={{ flex:1, minWidth:0, background:t.appBg,
          padding:`${SPACE.lg}px ${SPACE.lg}px` }}>
          <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text, marginBottom:2 }}>
            Good morning
          </div>
          <div style={{ fontSize:FONT.size.xs, color:t.text3, marginBottom:SPACE.md+2 }}>
            Your study overview
          </div>
          <div className="mb-land-tiles" style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))',
            gap:8, marginBottom:SPACE.lg }}>
            <SummaryTile t={t} label="Due Today" value="12" accent />
            <SummaryTile t={t} label="Entries" value="184" />
            <SummaryTile t={t} label="Reviewed" value="76%" />
            <SummaryTile t={t} label="Systems" value="9" />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {entries.map(e => (
              <EntryCard key={e.id} entry={e} color={SYS_COLOR[e.system]} showSystem />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────
function Hero({ t, onGetStarted, reducedMotion }) {
  const anim = (delay) => reducedMotion ? {} :
    { animation: `medbook-fade-in 560ms ${MOTION.ease} backwards`, animationDelay: `${delay}ms` };
  return (
    <section className="mb-land-hero" style={{ padding:`${SPACE.xl4}px ${SPACE.lg}px ${SPACE.xl3}px` }}>
      <div style={{ maxWidth:720, margin:'0 auto', textAlign:'center' }}>
        <h1 className="mb-land-h1" style={{ ...anim(0), color:t.text, fontWeight:FONT.weight.bold,
          lineHeight:1.14, letterSpacing:'-0.02em', margin:`0 0 ${SPACE.lg}px` }}>
          <span className="mb-land-h1-line">Learn medicine.</span>
          <span className="mb-land-h1-line">Remember more.</span>
          <span className="mb-land-h1-line">Study better.</span>
        </h1>

        <p style={{ ...anim(90), fontSize:FONT.size.lg, color:t.text3, lineHeight:FONT.leading.relaxed,
          maxWidth:540, margin:`0 auto ${SPACE.xl2}px` }}>
          MedBook brings your medical knowledge, notes, reviews, flashcards and
          AI-assisted learning into one focused workspace.
        </p>

        <div style={{ ...anim(160), display:'flex', gap:SPACE.md, justifyContent:'center',
          flexWrap:'wrap', marginBottom:SPACE.lg }}>
          <button className="mb-land-btn mb-land-btn-primary mb-land-btn-lg" onClick={onGetStarted} style={{
            background:t.accent, color:'#fff', border:'none', borderRadius:RADIUS.md,
            padding:'13px 28px', fontSize:FONT.size.base, fontWeight:FONT.weight.semibold,
            cursor:'pointer', fontFamily:'Inter,sans-serif', display:'inline-flex',
            alignItems:'center', gap:7 }}>
            Get Started <IconChevronRight size={14} />
          </button>
          <button className="mb-land-btn mb-land-btn-ghost mb-land-btn-lg" onClick={()=>scrollToId('mb-land-narrative')}
            style={{ background:'transparent', color:t.text2, border:`1px solid ${t.borderStrong}`,
            borderRadius:RADIUS.md, padding:'13px 24px', fontSize:FONT.size.base,
            fontWeight:FONT.weight.semibold, cursor:'pointer', fontFamily:'Inter,sans-serif' }}>
            See how it works
          </button>
        </div>

        <div style={{ ...anim(220), fontSize:FONT.size.xs, color:t.text4 }}>
          Built by Dr. Bahlah Surka for the way medical students actually study.
        </div>
      </div>

      <div className="mb-land-preview-wrap" style={{ ...anim(260), maxWidth:1080, margin:`${SPACE.xl4}px auto 0` }}>
        <ProductPreview t={t} />
      </div>
    </section>
  );
}

// ── Learn → Review → Remember ─────────────────────────────────────────────
// One shared panel, not three feature cards: a compact real-UI "loop" strip
// proves the product supports the whole cycle, then the three stages sit
// underneath as a single divided row (dividers + a connector badge between
// them, not three separately-bordered boxes repeating the same layout).
const STAGES = [
  { key:'learn', num:'01', title:'Learn', icon:IconEdit,
    items:['Review Entries', 'Systems', 'Notes', 'Images', 'Highlights'] },
  { key:'review', num:'02', title:'Review', icon:IconSearch,
    items:['Review Queue', 'Search', 'Organized knowledge'] },
  { key:'remember', num:'03', title:'Remember', icon:IconCards,
    items:['Flashcards', 'Spaced repetition', 'Favorites', 'Imported decks'] },
];

// Compact previews built from the app's own real colour/shape language
// (EntryCard's left-bar + pill, the dashboard's stat tiles, a flashcard's
// stacked-card silhouette) rather than screenshots or fabricated icons —
// what distinguishes each stage beyond just an icon and a list.
function StagePreview({ t, stageKey }) {
  if (stageKey === 'learn') {
    const c = SYS_COLOR.Cardiology;
    return (
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderLeft:`3px solid ${c}`,
        borderRadius:RADIUS.sm, padding:'8px 10px', display:'flex', flexDirection:'column', gap:5 }}>
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, color:t.text }}>
          Digoxin toxicity
        </span>
        <span style={{ fontSize:9, fontWeight:FONT.weight.medium, color:c, background:`${c}12`,
          border:`1px solid ${c}25`, borderRadius:RADIUS.sm-2, padding:'1px 6px', alignSelf:'flex-start' }}>
          Cardiology
        </span>
      </div>
    );
  }
  if (stageKey === 'review') {
    return (
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.sm,
        padding:'8px 10px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
        <div>
          <div style={{ fontSize:9, color:t.text4, letterSpacing:.5, fontWeight:FONT.weight.semibold,
            textTransform:'uppercase' }}>Due today</div>
          <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold, color:t.accent }}>12</div>
        </div>
        <div style={{ width:26, height:26, borderRadius:RADIUS.circle, background:t.navActiveBg,
          color:t.accent, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <IconRepeat size={13} />
        </div>
      </div>
    );
  }
  // remember — a short stack of cards, echoing the app's own flashcard UI
  return (
    <div style={{ position:'relative', padding:'2px 6px 0 0' }}>
      <div style={{ position:'absolute', inset:'6px -6px 0 6px', background:t.surface3,
        border:`1px solid ${t.border}`, borderRadius:RADIUS.sm }} aria-hidden="true" />
      <div style={{ position:'relative', background:t.surface, border:`1px solid ${t.border}`,
        borderRadius:RADIUS.sm, padding:'8px 10px', display:'flex', alignItems:'center', gap:7,
        boxShadow:elevation(t,'sm') }}>
        <IconCards size={13} style={{ color:t.accent, flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.medium, color:t.text2 }}>
          Beta-lactam MOA
        </span>
      </div>
    </div>
  );
}

function StageBlock({ t, stage }) {
  return (
    <div className="mb-land-stage">
      <div className="mb-land-stage-inner">
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between',
          marginBottom:SPACE.md }}>
          <div style={{ width:32, height:32, borderRadius:RADIUS.md, background:t.navActiveBg,
            display:'flex', alignItems:'center', justifyContent:'center', color:t.accent }}>
            <stage.icon size={15} />
          </div>
          <span aria-hidden="true" style={{ fontSize:FONT.size.xl2, fontWeight:FONT.weight.bold,
            color:t.text4, opacity:.5, lineHeight:1 }}>{stage.num}</span>
        </div>
        <h3 style={{ fontSize:FONT.size.xs, letterSpacing:.8, textTransform:'uppercase',
          fontWeight:FONT.weight.bold, color:t.text, margin:`0 0 ${SPACE.sm+2}px` }}>{stage.title}</h3>
        <ul style={{ listStyle:'none', margin:`0 0 ${SPACE.md}px`, padding:0, display:'flex',
          flexDirection:'column', gap:6 }}>
          {stage.items.map(item => (
            <li key={item} style={{ display:'flex', alignItems:'center', gap:7,
              fontSize:FONT.size.sm, color:t.text2 }}>
              <IconCheck size={11} style={{ color:t.ok, flexShrink:0 }} />
              {item}
            </li>
          ))}
        </ul>
        <StagePreview t={t} stageKey={stage.key} />
      </div>
    </div>
  );
}

// The compact "proof" strip — real MedBook pieces chained together to show
// the whole loop at a glance before the stage-by-stage breakdown below.
function FlowChip({ t, children }) {
  return (
    <div style={{ background:t.surface2, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
      padding:'8px 12px', display:'flex', alignItems:'center', gap:7, flexShrink:0 }}>
      {children}
    </div>
  );
}

function FlowArrow({ t }) {
  return <IconChevronRight size={13} style={{ color:t.text4, flexShrink:0 }} aria-hidden="true" />;
}

function FlowDiagram({ t }) {
  const c = SYS_COLOR.Cardiology;
  return (
    <div className="mb-land-flow-diagram" role="img"
      aria-label="Review Entry leads to System, then Review Queue, then Flashcard, then back into Review Queue">
      <FlowChip t={t}>
        <span style={{ width:8, height:8, borderRadius:2, background:c, flexShrink:0 }} aria-hidden="true" />
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, color:t.text }}>Entry</span>
      </FlowChip>
      <FlowArrow t={t} />
      <FlowChip t={t}>
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.medium, color:c }}>System</span>
      </FlowChip>
      <FlowArrow t={t} />
      <FlowChip t={t}>
        <IconRepeat size={12} style={{ color:t.accent, flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, color:t.text }}>Review Queue</span>
      </FlowChip>
      <FlowArrow t={t} />
      <FlowChip t={t}>
        <IconCards size={12} style={{ color:t.accent, flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, color:t.text }}>Flashcard</span>
      </FlowChip>
      <FlowArrow t={t} />
      <div style={{ background:'transparent', border:`1px dashed ${t.borderStrong}`, borderRadius:RADIUS.md,
        padding:'8px 12px', display:'flex', alignItems:'center', gap:6, flexShrink:0, color:t.accent }}>
        <IconRepeat size={12} />
        <span style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold }}>Review again</span>
      </div>
    </div>
  );
}

function ProductNarrative({ t, reducedMotion }) {
  return (
    <section id="mb-land-narrative" style={{ padding:`${SPACE.xl4}px ${SPACE.lg}px`, background:t.surface2,
      borderTop:`1px solid ${t.border}` }}>
      <div style={{ maxWidth:1100, margin:'0 auto' }}>
        <div style={{ textAlign:'center', maxWidth:560, margin:`0 auto ${SPACE.xl3}px` }}>
          <h2 style={{ fontSize:'clamp(24px, 3.2vw, 32px)', fontWeight:FONT.weight.bold,
            color:t.text, lineHeight:1.2, margin:`0 0 ${SPACE.sm+2}px` }}>
            A better way to learn medicine.
          </h2>
          <p style={{ fontSize:FONT.size.md, color:t.text3, lineHeight:FONT.leading.relaxed, margin:0 }}>
            MedBook connects learning, review and memory into one study workflow.
          </p>
        </div>

        <div className="mb-land-flow-panel" style={{ background:t.surface, border:`1px solid ${t.border}`,
          borderRadius:RADIUS.xl2, boxShadow:elevation(t,'md'), overflow:'hidden' }}>
          <div className="mb-land-flow-diagram-wrap" style={{ borderBottom:`1px solid ${t.border}` }}>
            <FlowDiagram t={t} />
          </div>
          <div className="mb-land-stage-row">
            {STAGES.map(stage => <StageBlock key={stage.key} t={t} stage={stage} />)}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:560, margin:`${SPACE.xl4}px auto 0`, textAlign:'center' }}>
        <p style={{ fontSize:'clamp(17px, 2vw, 20px)', fontWeight:FONT.weight.semibold,
          color:t.text2, lineHeight:1.4, margin:0 }}>
          Your medical knowledge, built to stay with you.
        </p>
      </div>
    </section>
  );
}

// ── Knowledge workspace ("Your knowledge, connected.") ────────────────────
// One asymmetric real-UI showcase, not five separate Review Entries/Systems/
// Search/Review Queue/Dashboard chapters: a large primary panel recreates
// the actual entry reading pane (with the real app's own toolbar/search
// chrome above it, and real highlighted Review Notes), and two smaller
// panels beside it — a Systems browse list, and a Dashboard/Review Queue
// stat strip — cover the rest without turning the page into a screenshot
// collage.
const CAPABILITIES = ['Review Entries', 'Systems', 'Search', 'Review Queue', 'Dashboard'];

function CapabilityPills({ t }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center' }}>
      {CAPABILITIES.map(label => (
        <span key={label} style={{ fontSize:FONT.size.xs, fontWeight:FONT.weight.medium, color:t.text3,
          background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.pill,
          padding:'5px 12px' }}>
          {label}
        </span>
      ))}
    </div>
  );
}

// The primary showcase: the real app's own toolbar chrome (system breadcrumb
// + global search, exactly as App.js renders it for the 'list'/'detail'
// views) sitting above a faithful recreation of DetailView's reading pane —
// system tag, title, meta + action icons, a divider, and Review Notes
// rendered with real highlight colours (lib/highlights.js's own palette,
// resolved the same isDark-aware way DetailView itself does).
function EntryReadingPane({ t, isDark }) {
  const c = SYS_COLOR.Cardiology;
  const yellow = resolveHL(HL_COLORS[0], isDark);
  const green = resolveHL(HL_COLORS[1], isDark);

  return (
    <div className="mb-land-window mb-land-showcase-primary" aria-hidden="true" style={{ background:t.surface,
      border:`1px solid ${t.border}`, borderRadius:RADIUS.xl2, boxShadow:elevation(t,'xl'), overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 16px',
        borderBottom:`1px solid ${t.border}`, background:t.surface2 }}>
        <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#ff5f57' }} />
        <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#febc2e' }} />
        <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#28c840' }} />
      </div>

      {/* The app's own toolbar row — system breadcrumb on the left, Global
          Search on the right — recreated from App.js's real header exactly.
          flexWrap means a narrow viewport wraps the search chip onto its
          own line instead of forcing an overflow. */}
      <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', rowGap:6, gap:SPACE.sm,
        padding:'10px 18px', borderBottom:`1px solid ${t.border}`, background:t.surface }}>
        <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:c, flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.bold, color:t.text }}>Cardiology</span>
        <div style={{ flex:1 }} />
        <span className="mb-land-showcase-search" style={{ background:t.surface2, border:`1px solid ${t.border}`,
          borderRadius:RADIUS.sm+1, color:t.text4, padding:'6px 12px', fontSize:FONT.size.xs }}>
          Search notes…
        </span>
      </div>

      <div className="mb-land-showcase-body" style={{ padding:SPACE.xl }}>
        <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:c }}>Cardiology</span>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:SPACE.md,
          margin:`4px 0 ${SPACE.md}px` }}>
          <div style={{ flex:1, minWidth:0, fontSize:'clamp(19px, 2.2vw, 24px)', fontWeight:FONT.weight.bold,
            color:t.text, lineHeight:FONT.leading.tight }}>
            Digoxin toxicity: ECG changes
            <IconPin size={14} style={{ marginLeft:8, color:t.warn, verticalAlign:2 }} />
          </div>
          <div className="mb-land-showcase-actions" style={{ display:'flex', gap:6, flexShrink:0 }}>
            {[IconCheck, IconEdit, IconPin].map((Ic, i) => (
              <span key={i} style={{ width:26, height:26, borderRadius:RADIUS.sm+1, background:t.surface2,
                border:`1px solid ${t.border}`, color:t.text3, display:'flex', alignItems:'center',
                justifyContent:'center' }}>
                <Ic size={12} />
              </span>
            ))}
          </div>
        </div>
        <div style={{ fontSize:FONT.size.xs, color:t.text4, marginBottom:SPACE.lg }}>
          06 Sept <span style={{ color:t.ok, fontWeight:FONT.weight.semibold }}> · Reviewed 3×</span>
        </div>

        <div style={{ height:1, background:t.border, marginBottom:SPACE.lg }} />

        <div style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
          textTransform:'uppercase', marginBottom:SPACE.md }}>
          Review Notes
        </div>
        <p style={{ fontSize:FONT.size.md, color:t.text2, lineHeight:1.9, margin:0 }}>
          <mark style={{ background:yellow.bg, color:yellow.text, borderRadius:2, padding:'0 2px' }}>
            Scooped ST depression
          </mark>, PR prolongation, and{' '}
          <mark style={{ background:green.bg, color:green.text, borderRadius:2, padding:'0 2px' }}>
            coloured-vision complaints
          </mark>{' '}are the classic exam triad.
        </p>
      </div>
    </div>
  );
}

// Secondary panel A — Systems, recreated from Sidebar.js's own SystemRow
// (coloured left border, due/count pills, progress bar) at browsing scale.
const MINI_SYSTEMS = [
  { name:'Cardiology', color:SYS_COLOR.Cardiology, due:3, count:28, pct:82 },
  { name:'Neurology', color:SYS_COLOR.Neurology, due:1, count:19, pct:58 },
  { name:'Pharmacology', color:SYS_COLOR.Pharmacology, due:0, count:34, pct:91 },
];

function SystemsPanel({ t }) {
  return (
    <div className="mb-land-showcase-panel" style={{ background:t.surface, border:`1px solid ${t.border}`,
      borderRadius:RADIUS.xl, boxShadow:elevation(t,'md'), padding:SPACE.lg }}>
      <div style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
        textTransform:'uppercase', marginBottom:SPACE.md }}>
        Systems
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:SPACE.sm+2 }}>
        {MINI_SYSTEMS.map(sys => (
          <div key={sys.name} style={{ paddingLeft:10, borderLeft:`3px solid ${sys.color}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.medium, color:t.text2, flex:1 }}>
                {sys.name}
              </span>
              {sys.due > 0 && (
                <span style={{ fontSize:FONT.size.micro, fontWeight:FONT.weight.semibold, color:t.accent,
                  background:t.navActiveBg, borderRadius:RADIUS.pill, padding:'1px 6px', flexShrink:0 }}>
                  {sys.due} due
                </span>
              )}
              <span style={{ fontSize:FONT.size.micro, background:t.surface3, color:t.text4,
                borderRadius:RADIUS.pill, padding:'1px 7px', fontWeight:FONT.weight.semibold, flexShrink:0 }}>
                {sys.count}
              </span>
            </div>
            <div style={{ height:3, background:t.surface3, borderRadius:RADIUS.sm, marginTop:5, overflow:'hidden' }}>
              <div style={{ height:'100%', borderRadius:RADIUS.sm, background:sys.color, width:`${sys.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Secondary panel B — Dashboard + Review Queue, sharing one compact stat
// strip (same numbers as the hero's own preview, kept consistent site-wide)
// rather than a fourth separate box.
function SurfacePanel({ t }) {
  const stats = [
    { label:'Due Today', value:'12', accent:true },
    { label:'Reviewed', value:'76%' },
    { label:'Systems', value:'9' },
  ];
  return (
    <div className="mb-land-showcase-panel" style={{ background:t.surface, border:`1px solid ${t.border}`,
      borderRadius:RADIUS.xl, boxShadow:elevation(t,'md'), padding:SPACE.lg }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:SPACE.md }}>
        <IconChart size={12} style={{ color:t.text4 }} />
        <span style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
          textTransform:'uppercase' }}>
          Dashboard
        </span>
      </div>
      <div className="mb-land-showcase-stats" style={{ display:'flex', gap:8 }}>
        {stats.map(s => (
          <div key={s.label} style={{ flex:1, minWidth:0, background:t.surface2, border:`1px solid ${t.border}`,
            borderRadius:RADIUS.md, borderTop: s.accent ? `2px solid ${t.accent}` : `1px solid ${t.border}`,
            padding:'9px 10px' }}>
            <div style={{ fontSize:9, color:t.text4, letterSpacing:.5, fontWeight:FONT.weight.semibold,
              textTransform:'uppercase', marginBottom:3, whiteSpace:'nowrap', overflow:'hidden',
              textOverflow:'ellipsis' }}>
              {s.label}
            </div>
            <div style={{ fontSize:FONT.size.lg, fontWeight:FONT.weight.bold,
              color: s.accent ? t.accent : t.text }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:SPACE.md, color:t.text3 }}>
        <IconRepeat size={12} style={{ flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.xs }}>Review Queue resurfaces what's due, automatically.</span>
      </div>
    </div>
  );
}

function KnowledgeWorkspace({ t, isDark }) {
  return (
    <section id="mb-land-knowledge" style={{ padding:`${SPACE.xl4}px ${SPACE.lg}px`,
      borderTop:`1px solid ${t.border}` }}>
      <div style={{ maxWidth:1100, margin:'0 auto' }}>
        <div style={{ textAlign:'center', maxWidth:560, margin:`0 auto ${SPACE.xl2}px` }}>
          <h2 style={{ fontSize:'clamp(24px, 3.2vw, 32px)', fontWeight:FONT.weight.bold,
            color:t.text, lineHeight:1.2, margin:`0 0 ${SPACE.sm+2}px` }}>
            Your knowledge, connected.
          </h2>
          <p style={{ fontSize:FONT.size.md, color:t.text3, lineHeight:FONT.leading.relaxed,
            margin:`0 0 ${SPACE.lg}px` }}>
            Capture what you learn. Organize it by system. Return to it when it matters.
          </p>
          <CapabilityPills t={t} />
        </div>

        <div className="mb-land-showcase-grid">
          <EntryReadingPane t={t} isDark={isDark} />
          <SystemsPanel t={t} />
          <SurfacePanel t={t} />
        </div>
      </div>
    </section>
  );
}

// ── Visual learning ("Medicine is visual. MedBook remembers that.") ──────
// Real supplied medical diagrams (lib/landingImages.js) walked through
// SEE -> KEEP -> REVIEW -> REMEMBER, as one flowing vertical narrative
// rather than a grid — that composition is already mobile-friendly by
// nature, so every width gets the same story, just full-width.

// A small centered eyebrow tag marking each narrative beat.
function FlowLabel({ t, children }) {
  return (
    <div style={{ fontSize:FONT.size.micro, color:t.accent, letterSpacing:1.2,
      fontWeight:FONT.weight.bold, textTransform:'uppercase', textAlign:'center',
      marginBottom:SPACE.sm }}>
      {children}
    </div>
  );
}

// A short vertical connector between beats. `caption` isn't decorative —
// it's real information for anyone who can't see the connecting line
// itself, not just a visual flourish.
function NarrativeArrow({ t, caption }) {
  return (
    <div aria-hidden="true" style={{ display:'flex', flexDirection:'column', alignItems:'center',
      gap:4, padding:`${SPACE.md}px 0` }}>
      <div style={{ width:1, height:22, background:t.borderStrong }} />
      <IconChevronRight size={14} style={{ color:t.text4, transform:'rotate(90deg)' }} />
      {caption && (
        <span style={{ fontSize:FONT.size.xs, color:t.text4, fontWeight:FONT.weight.medium }}>
          {caption}
        </span>
      )}
    </div>
  );
}

// A real supplied diagram, framed consistently. No forced aspect ratio —
// width scales, height follows naturally — so nothing is ever misleadingly
// cropped. Lazy-loaded: this whole section sits well below the fold.
function RealImageFrame({ t, image, maxWidth = 760 }) {
  return (
    <figure style={{ margin:0, maxWidth, width:'100%', marginLeft:'auto', marginRight:'auto' }}>
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:RADIUS.xl,
        boxShadow:elevation(t,'lg'), padding:SPACE.md }}>
        <img src={image.src} alt={image.alt} loading="lazy" decoding="async"
          style={{ display:'block', width:'100%', height:'auto', borderRadius:RADIUS.md }} />
      </div>
      <figcaption style={{ fontSize:FONT.size.xs, color:t.text4, textAlign:'center',
        marginTop:SPACE.sm, fontWeight:FONT.weight.medium }}>
        {image.caption}
      </figcaption>
    </figure>
  );
}

function SeeStep({ t }) {
  return (
    <div>
      <FlowLabel t={t}>See</FlowLabel>
      <RealImageFrame t={t} image={LANDING_IMAGES.heartFailurePathway} />
    </div>
  );
}

// The SAME diagram, now shown living inside a real MedBook Review Entry —
// system tag, title, a short real note, and the app's own "Images (n) -
// tap to expand" panel (DetailView.js's actual pattern) holding it as a
// thumbnail. This is the whole point of the section: the diagram isn't
// just attached, it sits right next to the knowledge it explains.
function KeepStep({ t }) {
  const c = SYS_COLOR.Cardiology;
  const img = LANDING_IMAGES.heartFailurePathway;
  return (
    <div>
      <FlowLabel t={t}>Keep</FlowLabel>
      <div style={{ maxWidth:480, margin:'0 auto' }}>
        <div className="mb-land-window" aria-hidden="true" style={{ background:t.surface,
          border:`1px solid ${t.border}`, borderRadius:RADIUS.xl2, boxShadow:elevation(t,'lg'),
          overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 16px',
            borderBottom:`1px solid ${t.border}`, background:t.surface2 }}>
            <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#ff5f57' }} />
            <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#febc2e' }} />
            <span style={{ width:10, height:10, borderRadius:RADIUS.circle, background:'#28c840' }} />
          </div>
          <div className="mb-land-showcase-body" style={{ padding:SPACE.xl }}>
            <span style={{ fontSize:FONT.size.sm, fontWeight:FONT.weight.semibold, color:c }}>Cardiology</span>
            <div style={{ fontSize:FONT.size.xl, fontWeight:FONT.weight.bold, color:t.text,
              lineHeight:FONT.leading.tight, margin:'4px 0 10px' }}>
              Heart failure: pathogenesis
            </div>
            <p style={{ fontSize:FONT.size.sm, color:t.text2, lineHeight:1.7,
              margin:`0 0 ${SPACE.lg}px` }}>
              Compensatory neurohormonal activation keeps blood pressure up short-term, but it's
              also what drives the remodeling that worsens long-term function.
            </p>
            <div style={{ background:t.surface2, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
              padding:SPACE.md }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:FONT.size.micro,
                color:t.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
                textTransform:'uppercase', marginBottom:SPACE.sm }}>
                <IconImages size={11} style={{ flexShrink:0 }} /> Images (1) · tap to expand
              </div>
              <img src={img.src} alt={img.alt} loading="lazy" decoding="async"
                style={{ width:'100%', maxWidth:220, height:'auto', borderRadius:RADIUS.sm,
                  border:`1px solid ${t.border}`, display:'block', background:t.surface2 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewBeat({ t }) {
  return (
    <div style={{ textAlign:'center', maxWidth:460, margin:'0 auto' }}>
      <FlowLabel t={t}>Review</FlowLabel>
      <p style={{ fontSize:FONT.size.md, color:t.text3, lineHeight:FONT.leading.relaxed,
        margin:`0 0 ${SPACE.sm}px` }}>
        This entry resurfaces in Review Queue like any other: the diagram comes back with it,
        not as a separate file to go dig up.
      </p>
      <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:FONT.size.xs,
        fontWeight:FONT.weight.semibold, color:t.accent, background:t.navActiveBg,
        borderRadius:RADIUS.pill, padding:'4px 12px' }}>
        <IconRepeat size={11} /> Due in Review Queue
      </span>
    </div>
  );
}

// Front/back flashcard drawn from the same diagram's own facts — real,
// ordinary MedBook flashcards (plain text front/back), available for any
// Review Entry, not something special-cased for this one.
function FlashcardRecall({ t }) {
  return (
    <div className="mb-land-showcase-panel" style={{ background:t.surface, border:`1px solid ${t.border}`,
      borderRadius:RADIUS.xl, boxShadow:elevation(t,'md'), padding:SPACE.lg, height:'100%',
      display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:SPACE.md }}>
        <IconCards size={12} style={{ color:t.text4 }} />
        <span style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8,
          fontWeight:FONT.weight.semibold, textTransform:'uppercase' }}>
          Flashcard
        </span>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ background:t.surface2, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
          padding:'12px 14px' }}>
          <div style={{ fontSize:9, color:t.text4, letterSpacing:.5, fontWeight:FONT.weight.semibold,
            textTransform:'uppercase', marginBottom:4 }}>Front</div>
          <div style={{ fontSize:FONT.size.sm, color:t.text, fontWeight:FONT.weight.medium }}>
            What drives deleterious remodeling in decompensated heart failure?
          </div>
        </div>
        <div style={{ background:t.surface2, border:`1px solid ${t.border}`, borderRadius:RADIUS.md,
          padding:'12px 14px' }}>
          <div style={{ fontSize:9, color:t.text4, letterSpacing:.5, fontWeight:FONT.weight.semibold,
            textTransform:'uppercase', marginBottom:4 }}>Back</div>
          <div style={{ fontSize:FONT.size.sm, color:t.text2 }}>
            Long-term neurohormonal activation: sympathetic, renin-angiotensin, and ADH.
          </div>
        </div>
      </div>
      <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:SPACE.md }}>
        Pulled straight from the entry. Works for any Review Entry.
      </div>
    </div>
  );
}

// Image Occlusion — real, but only for cards inside an IMPORTED Anki deck.
// Labeled as such throughout: MedBook has no UI for drawing your own
// occlusion regions on an uploaded image, so this never implies you can do
// that to any photo you take. What's shown — full diagram, structures
// masked, click to recall then reveal — is exactly how an imported Image
// Occlusion card actually studies inside MedBook today (see
// ImportedDecks/CardRenderer.js). The mask positions below are an
// illustrative approximation for this mockup, not derived from real
// per-card occlusion data.
const IO_MASKS = [
  { top:11, left:19, width:22, height:8.5 },
  { top:23, left:19, width:22, height:9 },
  { top:42, left:19, width:22, height:9 },
];

function ImageOcclusionDemo({ t, reducedMotion }) {
  const [revealed, setRevealed] = useState(false);
  const img = LANDING_IMAGES.circleOfWillis;
  return (
    <div className="mb-land-showcase-panel" style={{ background:t.surface, border:`1px solid ${t.border}`,
      borderRadius:RADIUS.xl, boxShadow:elevation(t,'md'), padding:SPACE.lg }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:SPACE.sm }}>
        <IconLayers size={12} style={{ color:t.text4 }} />
        <span style={{ fontSize:FONT.size.micro, color:t.text4, letterSpacing:.8,
          fontWeight:FONT.weight.semibold, textTransform:'uppercase' }}>
          Image Occlusion · Imported Decks
        </span>
      </div>
      <button type="button" onClick={()=>setRevealed(r=>!r)}
        aria-pressed={revealed} aria-label={revealed ? 'Hide labels again' : 'Reveal hidden labels'}
        style={{ position:'relative', display:'block', width:'100%', padding:0,
          border:`1px solid ${t.border}`, borderRadius:RADIUS.md, overflow:'hidden',
          cursor:'pointer', background:'none' }}>
        <img src={img.src} alt={img.alt} loading="lazy" decoding="async"
          style={{ display:'block', width:'100%', height:'auto' }} />
        {IO_MASKS.map((m,i) => (
          <span key={i} aria-hidden="true" style={{ position:'absolute',
            top:`${m.top}%`, left:`${m.left}%`, width:`${m.width}%`, height:`${m.height}%`,
            background:t.accent, borderRadius:3, display:'flex', alignItems:'center',
            justifyContent:'center', color:'#fff', fontSize:12, fontWeight:FONT.weight.bold,
            opacity:revealed ? 0 : 1,
            transition: reducedMotion ? 'none' : `opacity ${MOTION.normal} ${MOTION.ease}` }}>
            ?
          </span>
        ))}
      </button>
      <div style={{ fontSize:FONT.size.xs, color:t.text4, marginTop:SPACE.sm, textAlign:'center' }}>
        {revealed ? 'Revealed. Tap to hide again.' : 'Structures hidden. Recall them, then tap to reveal.'}
      </div>
    </div>
  );
}

function RememberStep({ t, reducedMotion }) {
  return (
    <div>
      <FlowLabel t={t}>Remember</FlowLabel>
      <p style={{ fontSize:FONT.size.sm, color:t.text3, textAlign:'center', maxWidth:520,
        lineHeight:FONT.leading.relaxed, margin:`0 auto ${SPACE.lg}px` }}>
        Two real ways this becomes active recall, not just something you looked at once.
      </p>
      <div className="mb-land-remember-grid">
        <FlashcardRecall t={t} />
        <ImageOcclusionDemo t={t} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}

// A restrained strip proving breadth (pharmacology, dermatology, oncology,
// pathophysiology) — object-fit:contain in a fixed-height frame, never
// object-fit:cover: one of these is a tall multi-stage pathway diagram, and
// cropping it to a short landscape thumbnail would cut off real content.
const VARIETY_IMAGES = [
  LANDING_IMAGES.hivAntiviral,
  LANDING_IMAGES.skinImmunology,
  LANDING_IMAGES.cancerImmunology,
  LANDING_IMAGES.postCardiacInjury,
];

function VisualVarietyStrip({ t }) {
  return (
    <div>
      <div style={{ textAlign:'center', maxWidth:520, margin:`0 auto ${SPACE.lg}px` }}>
        <p style={{ fontSize:FONT.size.sm, color:t.text3, lineHeight:FONT.leading.relaxed, margin:0 }}>
          Anatomy, pathways, pharmacology, pathology: whatever the source, it stays with the
          knowledge it belongs to.
        </p>
      </div>
      <div className="mb-land-variety-strip">
        {VARIETY_IMAGES.map(img => (
          <figure key={img.src} className="mb-land-variety-item" style={{ margin:0 }}>
            <div style={{ background:t.surface2, border:`1px solid ${t.border}`, borderRadius:RADIUS.lg,
              height:170, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
              <img src={img.src} alt={img.alt} loading="lazy" decoding="async"
                style={{ display:'block', maxWidth:'100%', maxHeight:'100%', width:'auto', height:'auto' }} />
            </div>
            <figcaption style={{ fontSize:FONT.size.micro, color:t.text4, textAlign:'center',
              marginTop:6, fontWeight:FONT.weight.medium }}>
              {img.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function VisualLearning({ t, reducedMotion }) {
  return (
    <section id="mb-land-visual" style={{ padding:`${SPACE.xl4}px ${SPACE.lg}px`,
      background:t.surface2, borderTop:`1px solid ${t.border}` }}>
      <div style={{ maxWidth:1100, margin:'0 auto' }}>
        <div style={{ textAlign:'center', maxWidth:620, margin:`0 auto ${SPACE.xl3}px` }}>
          <h2 style={{ fontSize:'clamp(24px, 3.2vw, 32px)', fontWeight:FONT.weight.bold,
            color:t.text, lineHeight:1.2, margin:`0 0 ${SPACE.sm+2}px` }}>
            Medicine is visual. MedBook remembers that.
          </h2>
          <p style={{ fontSize:FONT.size.md, color:t.text3, lineHeight:FONT.leading.relaxed, margin:0 }}>
            Diagrams, algorithms, flowcharts, clinical pathways and images are part of how
            medicine is learned. Keep them alongside your knowledge instead of leaving them
            scattered across screenshots, files and folders.
          </p>
        </div>

        <SeeStep t={t} />
        <NarrativeArrow t={t} caption="Upload · Keep" />
        <KeepStep t={t} />
        <NarrativeArrow t={t} />
        <ReviewBeat t={t} />
        <NarrativeArrow t={t} />
        <RememberStep t={t} reducedMotion={reducedMotion} />

        <div style={{ height:1, background:t.border, margin:`${SPACE.xl3}px 0` }} />

        <VisualVarietyStrip t={t} />
      </div>

      <div style={{ maxWidth:560, margin:`${SPACE.xl4}px auto 0`, textAlign:'center' }}>
        <p style={{ fontSize:'clamp(17px, 2vw, 20px)', fontWeight:FONT.weight.semibold,
          color:t.text2, lineHeight:1.4, margin:0 }}>
          Some things shouldn't just be looked at. They should be remembered.
        </p>
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function LandingPage({ onGetStarted }) {
  const { t, isDark } = useTheme();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    document.title = 'MedBook: A better way to learn medicine';
    return () => { document.title = 'MedBook: Medical Notebook'; };
  }, []);

  return (
    <div className="mb-landing" style={{ background:t.appBg, minHeight:'100vh', fontFamily:'Inter,sans-serif' }}>
      <style>{`
        .mb-landing h1, .mb-landing h2, .mb-landing h3 { font-family: Inter, sans-serif; }
        .mb-land-btn { transition: filter ${MOTION.fast} ${MOTION.ease}, transform ${MOTION.fast} ${MOTION.ease}; }
        .mb-land-btn:hover { filter: brightness(1.05); }
        .mb-land-btn-ghost:hover { background: ${t.surface2}; border-color: ${t.text4}; }
        .mb-land-btn:active { transform: scale(0.97); }
        .mb-land-btn:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }

        /* The proof strip: chips + arrows wrap freely on narrow screens
           rather than trying to force one unbroken line — each chip is
           sized to its own content, so wrapping still reads as one
           continuous chain, just folded onto more lines. */
        .mb-land-flow-diagram { display:flex; flex-wrap:wrap; align-items:center;
          justify-content:center; gap:${SPACE.sm}px; padding:${SPACE.lg}px; }
        .mb-land-flow-diagram-wrap { background:${t.surface2}; }

        /* One shared panel for all three stages — a divided row, not three
           separately-bordered cards. Mobile stacks them in the SAME panel
           (bottom borders) rather than turning each into its own box;
           desktop lays them side by side (right borders). Either way a
           small circular connector sits on the divider between stages,
           rotating from pointing down (stacked) to pointing right (row). */
        .mb-land-stage-row { display:flex; flex-direction:column; }
        .mb-land-stage { position:relative; flex:1; min-width:0; }
        .mb-land-stage-inner { padding:${SPACE.lg}px; }
        .mb-land-stage:not(:last-child) { border-bottom:1px solid ${t.border}; }
        .mb-land-stage:not(:last-child)::after {
          content:'›'; position:absolute; left:50%; bottom:0; z-index:1;
          transform:translate(-50%, 50%) rotate(90deg);
          width:24px; height:24px; border-radius:${RADIUS.circle};
          background:${t.surface}; border:1px solid ${t.border}; color:${t.text4};
          display:flex; align-items:center; justify-content:center;
          font-size:15px; line-height:1;
        }
        @media (min-width: ${BREAKPOINT.mobile}px) {
          .mb-land-stage-row { flex-direction:row; align-items:stretch; }
          .mb-land-stage:not(:last-child) { border-bottom:none; border-right:1px solid ${t.border}; }
          .mb-land-stage:not(:last-child)::after {
            left:100%; bottom:50%; transform:translate(-50%, 50%) rotate(0deg);
          }
        }

        .mb-land-h1-line { display:block; font-size:clamp(30px, 6.4vw, 54px); }

        @media (max-width: 420px) {
          .mb-land-nav-actions a { display: none; }
        }

        /* prefers-reduced-motion is handled at the JS level for the staged
           entrance animation above (see useReducedMotion/anim()) — this
           covers anything CSS-only that slips in later without needing to
           thread the JS flag through every new touch. */
        @media (prefers-reduced-motion: reduce) {
          .mb-landing * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
        }

        /* Product preview: shrink and simplify on narrow screens rather than
           overflowing or shrinking illegibly — the fake sidebar rail is the
           first thing to go, since the entry cards + stat tiles alone still
           read clearly as "a real app" without it. */
        @media (max-width: ${BREAKPOINT.mobile}px) {
          .mb-land-window-rail { display: none; }
          .mb-land-tiles { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
        }
        @media (max-width: 480px) {
          .mb-land-window-main { padding: ${SPACE.md}px !important; }
        }

        /* Knowledge workspace showcase — one large primary panel plus two
           smaller supporting ones, stacked full-width on mobile (each stays
           fully readable, never shrunk to postage-stamp size) and arranged
           as an asymmetric bento (primary spans both rows in a narrower
           left column) from tablet-landscape up. Strict grid tracks, not
           free-floating offsets — the asymmetry comes from the column/row
           split, not from breaking out of a grid. */
        .mb-land-showcase-grid { display:grid; grid-template-columns:1fr; gap:${SPACE.lg}px; }
        @media (min-width: ${BREAKPOINT.tablet}px) {
          .mb-land-showcase-grid {
            grid-template-columns:1.6fr 1fr;
            grid-template-rows:auto auto;
            align-items:stretch;
          }
          .mb-land-showcase-primary { grid-column:1; grid-row:1 / 3; }
        }
        @media (max-width: 480px) {
          .mb-land-showcase-body { padding: ${SPACE.md}px !important; }
        }

        /* Visual learning: the two REMEMBER paths (flashcard / image
           occlusion) stack full-width on mobile — each stays completely
           legible rather than shrinking side by side — and sit side by
           side only once there's room for both without cramping. */
        .mb-land-remember-grid { display:grid; grid-template-columns:1fr; gap:${SPACE.lg}px;
          max-width:640px; margin:0 auto; }
        @media (min-width: ${BREAKPOINT.mobile}px) {
          .mb-land-remember-grid { grid-template-columns:1fr 1fr; max-width:none; }
        }

        /* The variety strip wraps naturally rather than forcing four across
           on a narrow screen — 2x2 on phones, one row from tablet up. */
        .mb-land-variety-strip { display:flex; flex-wrap:wrap; gap:${SPACE.md}px; justify-content:center; }
        .mb-land-variety-item { flex:1 1 200px; max-width:240px; }
      `}</style>

      <Nav t={t} onGetStarted={onGetStarted} />
      <main>
        <Hero t={t} onGetStarted={onGetStarted} reducedMotion={reducedMotion} />
        <ProductNarrative t={t} reducedMotion={reducedMotion} />
        <KnowledgeWorkspace t={t} isDark={isDark} />
        <VisualLearning t={t} reducedMotion={reducedMotion} />
      </main>
    </div>
  );
}
