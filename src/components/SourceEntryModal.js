// components/SourceEntryModal.js
//
// Engram Stage 3 item 8 — "Jump to source on a miss... opens that entry
// (read-only navigation, existing DetailView), and returns to the same
// place in the session." Rather than route through App.js's own
// openEntry/backToList/view-switching (which has no "return to whatever
// screen I was on" concept — backToList always lands on the entries
// list, and threading a "came from My Cards" branch through that shared,
// heavily-used navigation would be a far bigger, riskier change than this
// stage calls for), this renders the REAL DetailView component inside a
// self-contained overlay that lives entirely within the study session.
// Nothing about the session ever unmounts underneath it — closing this
// modal IS "returning to the same place," by construction, not by any
// save/restore mechanism that could drift.
//
// DetailView expects a few App.js-level callbacks (onDeleted/onUpdated)
// this modal has no shared state to route them into; they're handled
// locally (close on delete, keep a local copy on edit) since a study
// session has no `entries` list of its own to keep in sync, and doesn't
// need one for a quick look at where a card came from.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SYS_COLOR } from '../lib/constants';
import DetailView from './DetailView';

export default function SourceEntryModal({ t, entryId, userId, onClose }) {
  const [entry, setEntry] = useState(undefined); // undefined=loading, null=not found, else the row
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.from('entries').select('*').eq('id', entryId).single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setErr('Could not load this entry.'); setEntry(null); return; }
        setEntry(data);
      });
    return () => { cancelled = true; };
  }, [entryId]);

  return (
    <div style={{ position:'fixed', inset:0, background:t.overlay, zIndex:400,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:t.appBg, borderRadius:14, width:'100%', maxWidth:760, height:'min(88vh, 900px)',
        boxShadow:`0 8px 40px ${t.shadowStrong}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'12px 16px', borderBottom:`1px solid ${t.border}`, flexShrink:0 }}>
          <span style={{ fontSize:13, fontWeight:700, color:t.text3, fontFamily:'Inter,sans-serif' }}>
            Source entry
          </span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:t.text3,
            cursor:'pointer', fontSize:20, lineHeight:1, fontFamily:'Inter,sans-serif' }}>×</button>
        </div>
        <div style={{ flex:1, minHeight:0, overflow:'auto', padding:16 }}>
          {entry === undefined && (
            <div style={{ textAlign:'center', padding:'60px 0', color:t.text4, fontSize:13, fontFamily:'Inter,sans-serif' }}>
              Loading…
            </div>
          )}
          {entry === null && (
            <div style={{ textAlign:'center', padding:'60px 20px', fontFamily:'Inter,sans-serif' }}>
              <div style={{ fontSize:28, marginBottom:10 }}>🔍</div>
              <div style={{ fontSize:13.5, color:t.text3 }}>{err || 'This entry is no longer available.'}</div>
            </div>
          )}
          {entry && (
            <DetailView entry={entry} userId={userId}
              onBack={onClose}
              onDeleted={onClose}
              onUpdated={(next) => setEntry(next)}
              onPrev={() => {}} onNext={() => {}} hasPrev={false} hasNext={false}
              color={SYS_COLOR[entry.system] || '#2563eb'} />
          )}
        </div>
      </div>
    </div>
  );
}
