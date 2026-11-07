// components/StudyByTimePicker.js
//
// Engram Stage 3 item 7 — "Study by time." Shows "≈ N cards · M min" for
// each duration BEFORE starting, using the fixed 40s/card planning rate
// (never a measured time — see api.js/settings.js's own comments) for the
// theoretical budget, and a real query (same fill order the session
// itself will use: overdue-first due, then new under the daily cap) for
// how many cards are actually ready right now, capped at that budget.
// Same overlay/centered-card convention as ConfirmDialog/FavoritesScreen's
// own preview modal.

import { useEffect, useState } from 'react';
import * as ownCardsApi from '../lib/ownCards/api';
import { OWN_CARDS_DEFAULTS, studyMinutesToCardBudget } from '../lib/ownCards/settings';

export default function StudyByTimePicker({ t, userId, system, scopeLabel, onStart, onClose }) {
  const [counts, setCounts] = useState(null); // { [minutes]: availableCount } | null while loading

  useEffect(() => {
    let cancelled = false;
    const maxMinutes = Math.max(...OWN_CARDS_DEFAULTS.studyTimeChoicesMinutes);
    const maxBudget = studyMinutesToCardBudget(maxMinutes);
    // One query at the largest budget — every smaller duration's count is
    // just that same result sliced down, never a second round trip.
    ownCardsApi.getSessionCards({ userId, system, limit: maxBudget, newCardsPerDay: OWN_CARDS_DEFAULTS.newCardsPerDay })
      .then(rows => {
        if (cancelled) return;
        const byMinutes = {};
        OWN_CARDS_DEFAULTS.studyTimeChoicesMinutes.forEach(m => {
          byMinutes[m] = Math.min(rows.length, studyMinutesToCardBudget(m));
        });
        setCounts(byMinutes);
      })
      .catch(() => { if (!cancelled) setCounts({}); });
    return () => { cancelled = true; };
  }, [userId, system]);

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:t.overlay, zIndex:300,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:t.surface, borderRadius:14, padding:20,
        maxWidth:380, width:'100%', boxShadow:`0 8px 32px ${t.shadowStrong}`, fontFamily:'Inter,sans-serif' }}>
        <div style={{ fontSize:15, fontWeight:700, color:t.text, marginBottom:4 }}>Study by time</div>
        <div style={{ fontSize:12.5, color:t.text4, marginBottom:16 }}>{scopeLabel}</div>

        {counts === null ? (
          <div style={{ textAlign:'center', padding:'20px 0', color:t.text4, fontSize:13 }}>Checking how many cards are ready…</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {OWN_CARDS_DEFAULTS.studyTimeChoicesMinutes.map(m => {
              const budget = studyMinutesToCardBudget(m);
              const n = counts[m] ?? 0;
              const isDefault = m === OWN_CARDS_DEFAULTS.defaultStudyMinutes;
              return (
                <button key={m} onClick={() => n > 0 && onStart(budget)} disabled={n === 0} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  background: isDefault ? t.navActiveBg : t.surface2,
                  border:`1px solid ${isDefault ? t.navActiveBorder : t.border}`,
                  borderRadius:10, padding:'12px 14px', cursor: n===0 ? 'default' : 'pointer', opacity: n===0 ? .5 : 1,
                  fontFamily:'Inter,sans-serif', textAlign:'left', width:'100%' }}>
                  <span style={{ fontSize:14, fontWeight:700, color:t.text }}>{m} min</span>
                  <span style={{ fontSize:12.5, color:t.text3, textAlign:'right' }}>
                    {n === 0 ? 'No cards ready' : n < budget ? `Only ${n} card${n!==1?'s':''} available` : `≈ ${n} cards · ${m} min`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button onClick={onClose} style={{ marginTop:16, width:'100%', background:'none', border:'none',
          color:t.text3, fontSize:13, cursor:'pointer', fontFamily:'Inter,sans-serif' }}>Cancel</button>
      </div>
    </div>
  );
}
