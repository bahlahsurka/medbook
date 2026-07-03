import { useState } from 'react';
import { useTheme } from '../lib/theme';

const STEPS = [
  { icon:'📋', title:'Welcome to MedBook', body:'Your personal USMLE Step 2 notebook. Organised by organ system, accessible on all your devices.' },
  { icon:'✏️', title:'Add entries your way', body:'Create notes system-by-system. Tag an entry to multiple systems at once. Your draft is auto-saved if you switch apps.' },
  { icon:'🖼️', title:'Upload screenshots', body:'Attach screenshots from UWorld, Amboss, or any resource directly to your entries. Tap any image to expand it.' },
  { icon:'🔁', title:'Review & revise', body:'Use the Review Queue for spaced repetition. Highlight key text. Pin important entries. Track what you\'ve revised.' },
];

export default function Onboarding({ onDone }) {
  const { t } = useTheme();
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div style={{ position:'fixed', inset:0, background:t.overlay, zIndex:300,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
      fontFamily:'Inter,sans-serif' }}>
      <div style={{ background:t.surface, borderRadius:16, width:'100%', maxWidth:400,
        padding:'36px 28px', textAlign:'center', boxShadow:`0 8px 32px ${t.shadowStrong}` }}>

        <div style={{ fontSize:48, marginBottom:16 }}>{s.icon}</div>
        <div style={{ fontSize:18, fontWeight:700, color:t.text, marginBottom:12 }}>{s.title}</div>
        <div style={{ fontSize:14, color:t.text3, lineHeight:1.7, marginBottom:28 }}>{s.body}</div>

        <div style={{ display:'flex', justifyContent:'center', gap:6, marginBottom:24 }}>
          {STEPS.map((_,i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:'50%',
              background:i===step?t.accent:t.border, transition:'background .2s' }} />
          ))}
        </div>

        <div style={{ display:'flex', gap:10 }}>
          {step > 0 && (
            <button onClick={()=>setStep(p=>p-1)} style={{ flex:1, background:t.surface3,
              border:`1px solid ${t.border}`, borderRadius:9, padding:12, fontSize:14,
              fontWeight:600, cursor:'pointer', color:t.text2, fontFamily:'Inter,sans-serif' }}>
              Back
            </button>
          )}
          <button onClick={()=>{ if(isLast) onDone(); else setStep(p=>p+1); }}
            style={{ flex:2, background:t.accent, color:'#fff', border:'none',
              borderRadius:9, padding:12, fontSize:14, fontWeight:600,
              cursor:'pointer', fontFamily:'Inter,sans-serif' }}>
            {isLast ? 'Start using MedBook' : 'Next'}
          </button>
        </div>

        <div onClick={onDone} style={{ marginTop:14, fontSize:12, color:t.text4,
          cursor:'pointer', textDecoration:'underline' }}>Skip intro</div>
      </div>
    </div>
  );
}
