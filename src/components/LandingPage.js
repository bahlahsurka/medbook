// components/LandingPage.js
//
// Public marketing page — rendered at "/" for a signed-out visitor (see the
// render gate in App.js).
//
// Batch 1: sticky nav, hero (+CTAs+creator line), a real-MedBook-UI product
// preview, and a first pass at the "A better way to learn medicine." /
// Learn → Review → Remember composition.
//
// Batch 2 (this pass): replaces that first-pass LRR with the fuller
// composition — a single shared panel (not three floating cards) that opens
// with a compact real-UI "loop" strip proving the product supports the
// whole cycle (Entry → System → Review Queue → Flashcard → back into
// Review), then the three Learn/Review/Remember stages beneath it as one
// divided row rather than three repeated feature cards, closing on the
// "Your medical knowledge, built to stay with you." transition line.
//
// Everything past that (deep flashcard story, AI section, About/Creator
// section, final CTA, footer) is intentionally NOT here yet — later batches.
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
  IconCheck, IconChevronRight, IconLayers } from '../lib/icons';
import { SYS_COLOR } from '../lib/constants';
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

// ── Page ─────────────────────────────────────────────────────────────────
export default function LandingPage({ onGetStarted }) {
  const { t } = useTheme();
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
      `}</style>

      <Nav t={t} onGetStarted={onGetStarted} />
      <main>
        <Hero t={t} onGetStarted={onGetStarted} reducedMotion={reducedMotion} />
        <ProductNarrative t={t} reducedMotion={reducedMotion} />
      </main>
    </div>
  );
}
