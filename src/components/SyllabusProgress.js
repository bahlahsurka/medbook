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
// in this file, only existing tokens reused under neutral names.
import { SPACE, RADIUS, FONT, MOTION } from '../lib/theme';
import { formatCoveragePct } from '../lib/syllabusProgress';

const SANS = 'Inter,sans-serif';

// ─── Overall Syllabus Progress ─────────────────────────────────────────────
// One composition: coverage % (primary), reviewed/total (supporting),
// remaining (subtle), then a single proportional bar. Never an oversized
// "remaining" number — it's the smallest, quietest text in the block.
export function OverallSyllabusProgress({ colors: c, total, reviewed, unreviewed, compact }) {
  if (total === 0) {
    return (
      <div style={{ fontSize:FONT.size.sm, color:c.text4, fontFamily:SANS }}>
        No active entries yet — add some to start tracking syllabus coverage.
      </div>
    );
  }
  const pctLabel = formatCoveragePct(reviewed, total);
  const fillPct = (reviewed / total) * 100;

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
          {reviewed.toLocaleString()} / {total.toLocaleString()} reviewed
        </div>
        <div style={{ fontSize:FONT.size.xs, color:c.text4, marginLeft:'auto', fontVariantNumeric:'tabular-nums' }}>
          {unreviewed.toLocaleString()} remaining
        </div>
      </div>

      <div style={{ marginTop: compact ? 10 : 14, height: compact ? 6 : 8,
        background:c.surfaceTrack, borderRadius:RADIUS.pill, overflow:'hidden' }}>
        <div style={{
          height:'100%', borderRadius:RADIUS.pill, background:c.accent,
          width:`${fillPct}%`, minWidth: reviewed > 0 ? 2 : 0,
          transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
      </div>
    </div>
  );
}

// ─── System Progress Register ──────────────────────────────────────────────

const GROUP_LABEL = { 'in-progress':'In Progress', 'not-started':'Not Started', 'completed':'Completed' };

function GroupLabel({ colors: c, label, count }) {
  return (
    <div style={{ fontSize:FONT.size.micro, color:c.text4, letterSpacing:.8, fontWeight:FONT.weight.semibold,
      textTransform:'uppercase', padding:'10px 2px 6px' }}>
      {label} <span style={{ fontVariantNumeric:'tabular-nums' }}>· {count}</span>
    </div>
  );
}

function SystemRow({ colors: c, row, onClick, selected, muted }) {
  const dotColor = row.color || c.text4;
  const pctLabel = formatCoveragePct(row.reviewed, row.total);
  const fillPct = row.total > 0 ? (row.reviewed / row.total) * 100 : 0;
  const rowStyle = {
    display:'block', width:'100%', textAlign:'left', background: selected ? c.accentBg : 'transparent',
    border:`1px solid ${selected ? c.accentBorder : 'transparent'}`,
    borderRadius:RADIUS.sm, padding:'9px 10px', cursor: onClick ? 'pointer' : 'default',
    opacity: muted ? .6 : 1,
    transition:`background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}`,
  };

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
    <button type="button" className="mb-syl-row" onClick={onClick} style={rowStyle}>
      {/* Desktop: one aligned row, five columns. */}
      {/* display intentionally NOT set inline — the mb-syl-row-desktop/
          mb-syl-row-mobile class pair below controls display (none<->grid,
          block<->none) per breakpoint; an inline display here would always
          win over that media-query rule regardless of viewport width. */}
      <div className="mb-syl-row-desktop" style={{
        gridTemplateColumns:'10px minmax(0,1fr) 92px 60px minmax(90px,160px) 108px',
        alignItems:'center', columnGap:14 }}>
        <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:dotColor, flexShrink:0 }} />
        <span style={{ fontSize:FONT.size.sm, color:c.text2, fontWeight:FONT.weight.semibold,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.name}</span>
        <span style={{ fontSize:FONT.size.xs, color:c.text3, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
          {row.reviewed}/{row.total}
        </span>
        <span style={{ fontSize:FONT.size.xs, color:c.text2, fontWeight:FONT.weight.semibold,
          fontVariantNumeric:'tabular-nums', textAlign:'right' }}>
          {pctLabel}
        </span>
        <span style={{ height:5, background:c.surfaceTrack, borderRadius:RADIUS.pill, overflow:'hidden' }}>
          <span style={{ display:'block', height:'100%', borderRadius:RADIUS.pill, background:dotColor,
            width:`${fillPct}%`, minWidth: row.reviewed > 0 ? 2 : 0,
            transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
        </span>
        <span style={{ fontSize:FONT.size.micro, color:c.text4, fontVariantNumeric:'tabular-nums', textAlign:'right' }}>
          {row.unreviewed === 0 ? 'complete' : `${row.unreviewed} remaining`}
        </span>
      </div>

      {/* Mobile: two lines — identity+coverage, then bar+compact sublabel. */}
      <div className="mb-syl-row-mobile">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:7, height:7, borderRadius:RADIUS.circle, background:dotColor, flexShrink:0 }} />
          <span style={{ flex:1, fontSize:FONT.size.sm, color:c.text2, fontWeight:FONT.weight.semibold,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.name}</span>
          <span style={{ fontSize:FONT.size.xs, color:c.text2, fontWeight:FONT.weight.semibold,
            fontVariantNumeric:'tabular-nums', flexShrink:0 }}>{pctLabel}</span>
        </div>
        <div style={{ height:5, background:c.surfaceTrack, borderRadius:RADIUS.pill, overflow:'hidden', margin:'7px 0 4px' }}>
          <div style={{ height:'100%', borderRadius:RADIUS.pill, background:dotColor,
            width:`${fillPct}%`, minWidth: row.reviewed > 0 ? 2 : 0,
            transition:`width ${MOTION.slow} ${MOTION.ease}` }} />
        </div>
        <div style={{ fontSize:FONT.size.micro, color:c.text4, fontVariantNumeric:'tabular-nums' }}>
          {row.reviewed}/{row.total} · {row.unreviewed === 0 ? 'complete' : `${row.unreviewed} remaining`}
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
export function SystemProgressRegister({ colors: c, register, onRowClick, selectedNames,
  maxRows, expanded, onToggleExpand, showEmpty = false }) {
  const groups = [
    { key:'in-progress', rows:register.inProgress },
    { key:'not-started', rows:register.notStarted },
    { key:'completed',   rows:register.completed },
  ];
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
    <div>
      <style>{`
        .mb-syl-row-desktop { display:none; }
        .mb-syl-row-mobile { display:block; }
        @media (min-width:768px) {
          .mb-syl-row-desktop { display:grid; }
          .mb-syl-row-mobile { display:none; }
        }
      `}</style>
      {rendered.map(g => (
        <div key={g.key}>
          <GroupLabel colors={c} label={GROUP_LABEL[g.key]} count={g.rows.length} />
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {g.rows.map(row => (
              <SystemRow key={row.name} colors={c} row={row}
                onClick={onRowClick ? () => onRowClick(row.name) : undefined}
                selected={!!selectedNames && selectedNames.includes(row.name)} />
            ))}
          </div>
        </div>
      ))}

      {showEmpty && register.empty.length > 0 && (
        <div>
          <GroupLabel colors={c} label="No entries" count={register.empty.length} />
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {register.empty.map(row => <SystemRow key={row.name} colors={c} row={row} muted />)}
          </div>
        </div>
      )}

      {maxRows && hiddenCount > 0 && (
        <button type="button" onClick={onToggleExpand} style={{
          display:'block', width:'100%', textAlign:'center', marginTop:SPACE.sm,
          background:'none', border:'none', color:c.accent, fontSize:FONT.size.sm,
          fontWeight:FONT.weight.semibold, fontFamily:SANS, cursor:'pointer', padding:'8px 0' }}>
          Show all {totalRows} systems
        </button>
      )}
      {maxRows && expanded && totalRows > maxRows && (
        <button type="button" onClick={onToggleExpand} style={{
          display:'block', width:'100%', textAlign:'center', marginTop:SPACE.sm,
          background:'none', border:'none', color:c.text3, fontSize:FONT.size.sm,
          fontWeight:FONT.weight.medium, fontFamily:SANS, cursor:'pointer', padding:'8px 0' }}>
          Show less
        </button>
      )}
    </div>
  );
}
