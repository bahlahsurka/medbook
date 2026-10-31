// components/SyllabusProgress.js
//
// Shared presentation layer for the syllabus-progress experience — the
// Overall Syllabus Progress composition and the ranked System Progress
// Register — used identically by Dashboard.js (full version, row click
// navigates to the system) and ReviewQueue.js (compact version, row click
// toggles that system into the upcoming session's filter).
//
// Deliberately theme-agnostic: Dashboard reads the global theme (`t` from
// lib/theme.js) and Review Queue reads its own bespoke `rt` palette
// (lib/reviewQueueTheme.js) — the two don't share field names (t.surface3
// vs rt.surfaceSunken, t.borderStrong vs rt.borderRich, etc.), so rather
// than assume one shape, every component here takes a small flat `colors`
// object with the handful of tokens it actually needs. Each caller maps
// its own theme into that shape once (same adapter pattern already used
// for HLPopover's `colors` prop) — no new colors are introduced anywhere
// in this file beyond lightness-adjusted variants of a system's own
// identity color (see lib/colorContrast.js) and a small set of translucent
// white overlays used only in dark mode (unfilled-track fill, hairlines,
// hover sweep) — never a new hue or a decorative background wash.
import { SPACE, RADIUS, FONT, MOTION } from '../lib/theme';
import { formatCoveragePct } from '../lib/syllabusProgress';
import { ensureDarkContrastFloor, barFillGradient } from '../lib/colorContrast';

const SANS = 'Inter,sans-serif';

// ─── Overall Syllabus Progress ─────────────────────────────────────────────
// One composition: coverage % (primary), reviewed/total (supporting),
// active-systems count (quiet context), remaining (subtler still), then a
// single proportional bar. Never an oversized "remaining" number — it's
// the smallest, quietest text in the block.
export function OverallSyllabusProgress({ colors: c, total, reviewed, unreviewed, compact, isDark, systemCount }) {
  if (total === 0) {
    return (
      <div style={{ fontSize:FONT.size.sm, color:c.text4, fontFamily:SANS }}>
        No active entries yet — add some to start tracking syllabus coverage.
      </div>
    );
  }
  const pctLabel = formatCoveragePct(reviewed, total);
  const fillPct = (reviewed / total) * 100;
  const trackColor = isDark ? 'rgba(255,255,255,0.07)' : c.surfaceTrack;

  return (
    <div style={{ fontFamily:SANS }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:compact?10:14, flexWrap:'wrap' }}>
        <div style={{
          fontSize: compact ? 32 : FONT.size.display, fontWeight:FONT.weight.bold, color:c.text,
          lineHeight:1, letterSpacing:-1, fontVariantNumeric:'tabular-nums' }}>
          {pctLabel}
        </div>
        <div style={{ fontSize:FONT.size.sm, color:c.text3, fontWeight:FONT.weight.medium,
          fontVariantNumeric:'tabular-nums' }}>
          <span style={{ color:c.text2 }}>{reviewed.toLocaleString()}</span> / {total.toLocaleString()} reviewed
        </div>
        {systemCount > 0 && (
          <div style={{ fontSize:FONT.size.xs, color:c.text4 }}>
            across {systemCount} system{systemCount===1?'':'s'}
          </div>
        )}
        <div style={{ fontSize:FONT.size.xs, color:c.text3, marginLeft:'auto', fontVariantNumeric:'tabular-nums' }}>
          {unreviewed.toLocaleString()} remaining
        </div>
      </div>

      <div style={{ marginTop: compact ? 10 : 14, height: compact ? 6 : 8,
        background:trackColor, borderRadius:RADIUS.pill, overflow:'hidden' }}>
        <div style={{
          height:'100%', borderRadius:RADIUS.pill, background:barFillGradient(c.accent, isDark),
          width:`${fillPct}%`, minWidth: reviewed > 0 ? 2 : 0,
          transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
      </div>
    </div>
  );
}

// ─── System Progress Register ──────────────────────────────────────────────

const GROUP_LABEL = { 'in-progress':'In Progress', 'not-started':'Not Started', 'completed':'Completed' };
const GROUP_ORDER = ['in-progress', 'not-started', 'completed'];

function GroupLabel({ colors: c, label, count }) {
  return (
    <div style={{ fontSize:FONT.size.micro, color:c.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
      textTransform:'uppercase', padding:'10px 2px 6px' }}>
      {label} <span style={{ fontVariantNumeric:'tabular-nums' }}>· {count}</span>
    </div>
  );
}

// Compact, understated tab/pill row — All / In Progress / Not Started /
// Completed, each with its own live count. Semantic <button>s with a
// touch-comfortable height and a visible focus ring, same as every other
// interactive element in this register.
function FilterPills({ colors: c, counts, active, onChange }) {
  const pills = [
    { key:'all', label:'All', count:counts.all },
    { key:'in-progress', label:'In Progress', count:counts['in-progress'] },
    { key:'not-started', label:'Not Started', count:counts['not-started'] },
    { key:'completed', label:'Completed', count:counts.completed },
  ];
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      {pills.map(p => {
        const isActive = active === p.key;
        return (
          <button key={p.key} type="button" className="mb-syl-pill" onClick={() => onChange(p.key)}
            aria-pressed={isActive} style={{
              fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, fontFamily:SANS,
              background: isActive ? c.accentBg : 'transparent',
              color: isActive ? c.accent : c.text3,
              border:`1px solid ${isActive ? c.accentBorder : c.border}`,
              borderRadius:RADIUS.pill, padding:'5px 11px', cursor:'pointer',
              minHeight:28, fontVariantNumeric:'tabular-nums' }}>
            {p.label} <span style={{ opacity:.75 }}>({p.count})</span>
          </button>
        );
      })}
    </div>
  );
}

function SystemRow({ colors: c, row, onClick, selected, muted, isDark, completed }) {
  const dotColor = ensureDarkContrastFloor(row.color, isDark) || c.text4;
  const pctLabel = formatCoveragePct(row.reviewed, row.total);
  const fillPct = row.total > 0 ? (row.reviewed / row.total) * 100 : 0;
  const trackColor = isDark ? 'rgba(255,255,255,0.07)' : c.surfaceTrack;
  // Completed rows stay fully legible but visually step back — a lower
  // base opacity (restored to 1 on hover/focus via the .mb-syl-row-complete
  // CSS rule below) plus a desaturated-reading bar fill, so "In Progress"
  // keeps the eye without Completed rows vanishing or losing their numbers.
  const rowStyle = {
    display:'block', width:'100%', textAlign:'left', background: selected ? c.accentBg : 'transparent',
    border:`1px solid ${selected ? c.accentBorder : 'transparent'}`,
    borderRadius:RADIUS.sm, padding:'11px 10px', minHeight:44, position:'relative', overflow:'hidden',
    cursor: onClick ? 'pointer' : 'default',
    opacity: muted ? .6 : 1,
    transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}, opacity ${MOTION.fast} ${MOTION.ease}`,
  };
  const barFill = completed
    ? (isDark ? `${dotColor}72` : `${dotColor}6e`) // ~45%/43% opacity — desaturated-reading without a new color
    : barFillGradient(row.color, isDark);

  if (row.total === 0) {
    return (
      <div className="mb-syl-row" style={rowStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:dotColor, flexShrink:0, opacity:.5 }} />
          <span style={{ flex:1, fontSize:FONT.size.sm, color:c.text3, fontWeight:FONT.weight.medium,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.name}</span>
          <span style={{ fontSize:FONT.size.xs, color:c.text4 }}>No entries</span>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className={`mb-syl-row${completed ? ' mb-syl-row-complete' : ''}`}
      onClick={onClick} style={rowStyle}>
      {/* Desktop: one aligned row, five columns. */}
      {/* display intentionally NOT set inline — the mb-syl-row-desktop/
          mb-syl-row-mobile class pair below controls display (none<->grid,
          block<->none) per breakpoint; an inline display here would always
          win over that media-query rule regardless of viewport width. */}
      <div className="mb-syl-row-desktop" style={{
        gridTemplateColumns:'10px minmax(56px,1fr) 80px 56px minmax(70px,140px) 92px',
        alignItems:'center', columnGap:12 }}>
        <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:dotColor, flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.sm, color:c.text, fontWeight:FONT.weight.semibold,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.name}</span>
        <span style={{ fontSize:FONT.size.xs, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap', textAlign:'right' }}>
          <span style={{ color:c.text2 }}>{row.reviewed}</span><span style={{ color:c.text3 }}>/{row.total}</span>
        </span>
        <span style={{ fontSize:FONT.size.xs, color:c.text, fontWeight:FONT.weight.semibold,
          fontVariantNumeric:'tabular-nums', textAlign:'right' }}>
          {pctLabel}
        </span>
        <span style={{ height:5, background:trackColor, borderRadius:RADIUS.pill, overflow:'hidden' }}>
          <span style={{ display:'block', height:'100%', borderRadius:RADIUS.pill, background:barFill,
            width:`${fillPct}%`, minWidth: row.reviewed > 0 ? 2 : 0,
            transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
        </span>
        <span style={{ fontSize:FONT.size.micro, color:c.text3, fontVariantNumeric:'tabular-nums', textAlign:'right' }}>
          {row.unreviewed === 0 ? 'complete' : `${row.unreviewed} remaining`}
        </span>
      </div>

      {/* Mobile: two lines — identity+coverage, then bar+compact sublabel. */}
      <div className="mb-syl-row-mobile">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:dotColor, flexShrink:0 }} />
          <span style={{ flex:1, fontSize:FONT.size.sm, color:c.text, fontWeight:FONT.weight.semibold,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.name}</span>
          <span style={{ fontSize:FONT.size.xs, color:c.text, fontWeight:FONT.weight.semibold,
            fontVariantNumeric:'tabular-nums', flexShrink:0 }}>{pctLabel}</span>
        </div>
        <div style={{ height:5, background:trackColor, borderRadius:RADIUS.pill, overflow:'hidden', margin:'7px 0 4px' }}>
          <div style={{ height:'100%', borderRadius:RADIUS.pill, background:barFill,
            width:`${fillPct}%`, minWidth: row.reviewed > 0 ? 2 : 0,
            transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
        </div>
        <div style={{ fontSize:FONT.size.micro, color:c.text3, fontVariantNumeric:'tabular-nums' }}>
          <span style={{ color:c.text2 }}>{row.reviewed}</span>/{row.total} · {row.unreviewed === 0 ? 'complete' : `${row.unreviewed} remaining`}
        </div>
      </div>
    </button>
  );
}

// `register` — the { inProgress, notStarted, completed, empty } shape from
// lib/syllabusProgress.js's buildSystemRegister(). `onRowClick(name)` is
// optional (omit for a read-only register); `selectedNames`, if given,
// marks rows selected (Review Queue's toggle-in-place use). `maxRows`
// caps how many non-empty rows render before a "Show all" control appears
// (Dashboard); omit it (Review Queue) to always render everything passed
// in (callers there already trim `register` to a small set before calling).
// `filterPills`, `activeGroup`/`onActiveGroupChange` are Dashboard-only
// (Review Queue's compact instance omits them — same register, no pills).
export function SystemProgressRegister({ colors: c, register, onRowClick, selectedNames,
  maxRows, expanded, onToggleExpand, showEmpty = false, isDark,
  filterPills = false, activeGroup = 'all', onActiveGroupChange }) {
  const byKey = { 'in-progress':register.inProgress, 'not-started':register.notStarted, completed:register.completed };
  const pillCounts = {
    all: GROUP_ORDER.reduce((n, k) => n + byKey[k].length, 0),
    'in-progress': byKey['in-progress'].length,
    'not-started': byKey['not-started'].length,
    completed: byKey.completed.length,
  };

  const visibleKeys = activeGroup === 'all' ? GROUP_ORDER : [activeGroup];
  const groups = visibleKeys.map(key => ({ key, rows: byKey[key] }));
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  let budget = maxRows && !expanded ? maxRows : Infinity;
  const rendered = [];
  for (const g of groups) {
    if (g.rows.length === 0) continue;
    const take = Math.min(g.rows.length, budget);
    if (take <= 0) break;
    rendered.push({ ...g, rows: g.rows.slice(0, take) });
    budget -= take;
  }
  const hiddenCount = totalRows - rendered.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="mb-syl-container">
      <style>{`
        /* Container query, NOT a viewport media query — this register can
           sit at full page width (Review Queue) or inside a ~65% column
           (Dashboard's System Progress), and a page-width breakpoint has
           no idea which. Switching on the register's OWN rendered width
           instead means it always picks the layout that actually fits,
           with no "it's wide enough per the viewport but this one column
           isn't" dead zone squeezing the name column to nothing. */
        .mb-syl-container { container-type:inline-size; }
        .mb-syl-row-desktop { display:none; }
        .mb-syl-row-mobile { display:block; }
        @container (min-width:520px) {
          .mb-syl-row-desktop { display:grid; }
          .mb-syl-row-mobile { display:none; }
        }
        /* Left-to-right hover/focus sweep — a restrained light pass, never
           a colored wash. Pseudo-element so it layers over the row's own
           background (incl. the selected-state tint) without replacing it. */
        .mb-syl-row::after {
          content:''; position:absolute; inset:0; pointer-events:none;
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, transparent 90%);
          opacity:0; transition: opacity ${MOTION.fast} ${MOTION.ease};
        }
        .mb-syl-row:hover::after, .mb-syl-row:focus-visible::after { opacity:1; }
        .mb-syl-row:focus-visible { outline:2px solid ${c.accent}; outline-offset:2px; }
        .mb-syl-row:active { transform:scale(0.995); }
        .mb-syl-row-complete { opacity:.58; }
        .mb-syl-row-complete:hover, .mb-syl-row-complete:focus-visible { opacity:1; }
        .mb-syl-pill:hover { filter:brightness(1.08); }
        .mb-syl-pill:focus-visible { outline:2px solid ${c.accent}; outline-offset:2px; }
      `}</style>

      {filterPills && (
        <div style={{ marginBottom:SPACE.md }}>
          <FilterPills colors={c} counts={pillCounts} active={activeGroup} onChange={onActiveGroupChange} />
        </div>
      )}

      {rendered.map(g => (
        <div key={g.key}>
          {activeGroup === 'all' && <GroupLabel colors={c} label={GROUP_LABEL[g.key]} count={g.rows.length} />}
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {g.rows.map(row => (
              <SystemRow key={row.name} colors={c} row={row} isDark={isDark} completed={g.key === 'completed'}
                onClick={onRowClick ? () => onRowClick(row.name) : undefined}
                selected={!!selectedNames && selectedNames.includes(row.name)} />
            ))}
          </div>
        </div>
      ))}

      {totalRows === 0 && (
        <div style={{ fontSize:FONT.size.sm, color:c.text4, padding:'12px 2px' }}>
          No systems in this group.
        </div>
      )}

      {showEmpty && register.empty.length > 0 && (
        <div>
          <GroupLabel colors={c} label="No entries" count={register.empty.length} />
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {register.empty.map(row => <SystemRow key={row.name} colors={c} row={row} isDark={isDark} muted />)}
          </div>
        </div>
      )}

      {maxRows && hiddenCount > 0 && (
        <button type="button" onClick={onToggleExpand} style={{
          display:'block', width:'100%', textAlign:'center', marginTop:SPACE.sm,
          background:'none', border:'none', color:c.accent, fontSize:FONT.size.sm,
          fontWeight:FONT.weight.semibold, fontFamily:SANS, cursor:'pointer', padding:'8px 0', minHeight:40 }}>
          Show all {totalRows} systems
        </button>
      )}
      {maxRows && expanded && totalRows > maxRows && (
        <button type="button" onClick={onToggleExpand} style={{
          display:'block', width:'100%', textAlign:'center', marginTop:SPACE.sm,
          background:'none', border:'none', color:c.text3, fontSize:FONT.size.sm,
          fontWeight:FONT.weight.medium, fontFamily:SANS, cursor:'pointer', padding:'8px 0', minHeight:40 }}>
          Show less
        </button>
      )}
    </div>
  );
}
