import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';
import { FONT, RADIUS, MOTION } from '../lib/theme';

// Difficulty + pinned filters, shared by the per-system System page and
// Global Search. Purely a client-side narrowing of whatever list the caller
// already computed — no data fetching, no navigation changes.
// `disabled` (bulk mode) greys the chips out and makes them inert in
// place — deliberately NOT unmounting this row when bulk mode toggles.
// An earlier version hid it entirely, which shifted the toolbar and list
// up by this row's height at the exact moment bulk mode activates —
// disorienting on its own, and it could shift a card into the spot a
// blank-space exit tap was aimed at, or vice versa. Same layout at every
// moment, only interactivity changes. With pointer-events:none while
// disabled, a tap here passes straight through to whatever's underneath,
// which is how it ends up triggering the Main pane's delegated exit
// handler like any other non-card, non-control area does.
export default function FilterChips({ t, difficultyFilter, setDifficultyFilter, pinnedOnly, setPinnedOnly, disabled }) {
  return (
    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',
        opacity:disabled?0.45:1, pointerEvents:disabled?'none':'auto',
        transition:`opacity ${MOTION.fast} ${MOTION.ease}`}}>
      {['All', ...DIFFICULTY].map(d => {
        const active = difficultyFilter===d;
        const c = d==='All' ? t.text3 : (DIFF_COLOR[d] || t.text3);
        return (
          <button key={d} className="mb-chip" onClick={()=>setDifficultyFilter(d)} style={{
            fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, cursor:'pointer',
            borderRadius:RADIUS.pill, padding:'4px 11px',
            background:active?`${c}1f`:'transparent', color:active?c:t.text4,
            border:`1px solid ${active?`${c}44`:t.border}`}}>
            {d}
          </button>
        );
      })}
      <span style={{width:1,height:14,background:t.border,margin:'0 2px',flexShrink:0}} />
      <button className="mb-chip" onClick={()=>setPinnedOnly(p=>!p)} style={{
        fontSize:FONT.size.xs, fontWeight:FONT.weight.semibold, cursor:'pointer',
        borderRadius:RADIUS.pill, padding:'4px 11px', display:'flex', alignItems:'center', gap:4,
        background:pinnedOnly?t.navActiveBg:'transparent', color:pinnedOnly?t.navActiveText:t.text4,
        border:`1px solid ${pinnedOnly?t.navActiveBorder:t.border}`}}>
        📌 Pinned
      </button>
    </div>
  );
}
