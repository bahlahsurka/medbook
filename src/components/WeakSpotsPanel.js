// components/WeakSpotsPanel.js
//
// Engram Stage 3 item 9 — "Weak spots... systems ranked by retention
// (only systems with enough graded reviews to be meaningful — pick a
// threshold, e.g. >= 20, and state it)." Threshold lives in
// lib/ownCards/settings.js (weakSpotMinReviews), not a magic number here.
// Renders nothing at all until there's something meaningful to show —
// no empty state, since "no system has 20+ reviews yet" is the normal
// state for a while and isn't worth a permanent placeholder.
//
// "Designed so it can later go down to topic level once topic grouping
// exists — don't build topic level now": this panel is deliberately
// system-only (the one grouping My Cards already has) with no topic
// concept anywhere in it, so adding a topic drill-down later is additive
// to this component, not a rewrite of it.

import { useEffect, useState } from 'react';
import * as ownCardsApi from '../lib/ownCards/api';
import { OWN_CARDS_DEFAULTS } from '../lib/ownCards/settings';

const MAX_ROWS = 5;

export default function WeakSpotsPanel({ t, userId, onStudySystem }) {
  const [spots, setSpots] = useState(undefined); // undefined = loading

  useEffect(() => {
    let cancelled = false;
    ownCardsApi.getWeakSpots(userId, OWN_CARDS_DEFAULTS.weakSpotMinReviews).then(s => { if (!cancelled) setSpots(s); });
    return () => { cancelled = true; };
  }, [userId]);

  if (!spots || spots.length === 0) return null;

  return (
    <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:12, padding:14, marginBottom:16, fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:11, color:t.text4, letterSpacing:.6, fontWeight:700, textTransform:'uppercase', marginBottom:8 }}>
        Weak spots
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {spots.slice(0, MAX_ROWS).map(s => (
          <button key={s.system} onClick={() => onStudySystem(s.system)} style={{
            display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%',
            background:t.surface2, border:`1px solid ${t.border}`, borderRadius:8, padding:'8px 10px',
            cursor:'pointer', fontFamily:'Inter,sans-serif', textAlign:'left' }}>
            <span style={{ fontSize:13, fontWeight:600, color:t.text }}>{s.system}</span>
            <span style={{ fontSize:12, color: s.retentionPct < 70 ? t.danger : t.text3, fontWeight:600 }}>
              {s.retentionPct}% · {s.total} review{s.total!==1?'s':''}
            </span>
          </button>
        ))}
      </div>
      <div style={{ fontSize:10.5, color:t.text4, marginTop:8, lineHeight:1.5 }}>
        Systems with {OWN_CARDS_DEFAULTS.weakSpotMinReviews}+ graded reviews, weakest first. Tap one to study it.
      </div>
    </div>
  );
}
