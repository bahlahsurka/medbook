import { useState } from 'react';
import { useTheme } from '../lib/theme';

/**
 * AISections — renders the six Gemini-generated sections beneath the user's Review.
 *
 * Controlled component: the parent owns `sections` and receives edits via onChange.
 * NOTHING here can touch the Review — it never receives it.
 */

const SECTIONS = [
  { key:'keyLearningPoints', label:'Key Learning Points', icon:'🎯', accent:'#2563eb' },
  { key:'highYield',         label:'High Yield',          icon:'⭐', accent:'#d97706' },
  { key:'clinicalPearls',    label:'Clinical Pearls',     icon:'💡', accent:'#0891b2' },
  { key:'redFlags',          label:'Red Flags',           icon:'🚩', accent:'#dc2626' },
  { key:'relatedTopics',     label:'Related Topics',      icon:'🔗', accent:'#7c3aed' },
];

export default function AISections({
  sections, onChange, onAddToDeck, deckAdded = {}, generatedAt, model, busy,
}) {
  const { t } = useTheme();
  // Expanded by default — the whole point is to see the output at a glance.
  const [collapsed, setCollapsed] = useState({});
  const [editing, setEditing]     = useState({});

  const toggle = key => setCollapsed(p => ({ ...p, [key]: !p[key] }));
  const toggleEdit = key => setEditing(p => ({ ...p, [key]: !p[key] }));

  const setList = (key, list) => onChange({ ...sections, [key]: list });

  const fmtDate = iso => {
    try {
      return new Date(iso).toLocaleString('en-GB',
        { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    } catch { return ''; }
  };

  return (
    <div style={{ fontFamily:'Inter,sans-serif' }}>
      {SECTIONS.map(s => {
        const list = Array.isArray(sections?.[s.key]) ? sections[s.key] : [];
        const isOpen = !collapsed[s.key];
        const isEditing = !!editing[s.key];

        return (
          <div key={s.key} style={{
            background:t.surface, border:`1px solid ${t.border}`,
            borderLeft:`3px solid ${s.accent}`, borderRadius:10,
            marginBottom:10, overflow:'hidden'
          }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 14px',
              cursor:'pointer', userSelect:'none' }} onClick={()=>toggle(s.key)}>
              <span style={{ fontSize:14 }}>{s.icon}</span>
              <span style={{ fontSize:12.5, fontWeight:700, color:t.text, flex:1 }}>{s.label}</span>
              <span style={{ fontSize:11, color:t.text4, background:t.surface3,
                borderRadius:10, padding:'1px 7px', fontWeight:600 }}>{list.length}</span>
              <button
                onClick={e=>{ e.stopPropagation(); toggleEdit(s.key); if(collapsed[s.key]) toggle(s.key); }}
                style={{ background:'none', border:'none', cursor:'pointer',
                  fontSize:11, color:isEditing?s.accent:t.text4, fontWeight:600,
                  fontFamily:'Inter,sans-serif', padding:'2px 4px' }}>
                {isEditing ? 'Done' : 'Edit'}
              </button>
              <span style={{ fontSize:11, color:t.text4, transform:isOpen?'rotate(90deg)':'none',
                transition:'transform .15s' }}>▶</span>
            </div>

            {/* Body */}
            {isOpen && (
              <div style={{ padding:'0 14px 12px' }}>
                {isEditing ? (
                  <>
                    <textarea
                      value={list.join('\n')}
                      onChange={e=>setList(s.key, e.target.value.split('\n'))}
                      onBlur={e=>setList(s.key,
                        e.target.value.split('\n').map(x=>x.trim()).filter(Boolean))}
                      rows={Math.max(3, list.length + 1)}
                      placeholder="One point per line…"
                      style={{ width:'100%', background:t.surface2,
                        border:`1px solid ${t.borderStrong}`, borderRadius:7,
                        color:t.text, padding:'8px 10px', fontSize:13, lineHeight:1.6,
                        outline:'none', boxSizing:'border-box', resize:'vertical',
                        fontFamily:'Inter,sans-serif' }} />
                    <div style={{ fontSize:10.5, color:t.text4, marginTop:4 }}>
                      One point per line. These are yours to edit — Gemini won't overwrite
                      them unless you Re-analyze.
                    </div>
                  </>
                ) : list.length === 0 ? (
                  <div style={{ fontSize:12, color:t.text4, fontStyle:'italic' }}>
                    Nothing here — your Review didn't support this section.
                  </div>
                ) : (
                  <ul style={{ margin:0, paddingLeft:18 }}>
                    {list.map((item,i)=>(
                      <li key={i} style={{ fontSize:13, color:t.text2, lineHeight:1.65,
                        marginBottom:4 }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Flashcards — separate because of the front/back shape + deck button */}
      <FlashcardSection
        cards={Array.isArray(sections?.flashcards) ? sections.flashcards : []}
        onChange={list => setList('flashcards', list)}
        onAddToDeck={onAddToDeck}
        deckAdded={deckAdded}
        busy={busy}
      />

      {generatedAt && (
        <div style={{ fontSize:10.5, color:t.text4, textAlign:'right', marginTop:8 }}>
          Generated {fmtDate(generatedAt)}{model ? ` · ${model}` : ''}
        </div>
      )}
    </div>
  );
}

function FlashcardSection({ cards, onChange, onAddToDeck, deckAdded, busy }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(true);
  const accent = '#16a34a';

  const update = (i, field, value) =>
    onChange(cards.map((c,j)=> j===i ? { ...c, [field]: value } : c));
  const remove = i => onChange(cards.filter((_,j)=>j!==i));

  return (
    <div style={{ background:t.surface, border:`1px solid ${t.border}`,
      borderLeft:`3px solid ${accent}`, borderRadius:10, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 14px',
        cursor:'pointer', userSelect:'none' }} onClick={()=>setOpen(p=>!p)}>
        <span style={{ fontSize:14 }}>🃏</span>
        <span style={{ fontSize:12.5, fontWeight:700, color:t.text, flex:1 }}>Flashcards</span>
        <span style={{ fontSize:11, color:t.text4, background:t.surface3,
          borderRadius:10, padding:'1px 7px', fontWeight:600 }}>{cards.length}</span>
        <span style={{ fontSize:11, color:t.text4, transform:open?'rotate(90deg)':'none',
          transition:'transform .15s' }}>▶</span>
      </div>

      {open && (
        <div style={{ padding:'0 14px 12px' }}>
          {cards.length === 0 ? (
            <div style={{ fontSize:12, color:t.text4, fontStyle:'italic' }}>
              No flashcards generated from this Review.
            </div>
          ) : cards.map((c,i)=>{
            const added = deckAdded[`${i}:${c.front}`];
            return (
              <div key={i} style={{ background:t.surface2, border:`1px solid ${t.border}`,
                borderRadius:8, padding:10, marginBottom:8 }}>
                <input value={c.front} onChange={e=>update(i,'front',e.target.value)}
                  placeholder="Front"
                  style={{ width:'100%', background:'transparent', border:'none',
                    color:t.text, fontSize:13, fontWeight:600, outline:'none',
                    fontFamily:'Inter,sans-serif', marginBottom:4 }} />
                <input value={c.back} onChange={e=>update(i,'back',e.target.value)}
                  placeholder="Back"
                  style={{ width:'100%', background:'transparent', border:'none',
                    color:t.text3, fontSize:12.5, outline:'none',
                    fontFamily:'Inter,sans-serif' }} />
                <div style={{ display:'flex', gap:6, marginTop:8 }}>
                  <button
                    onClick={()=>onAddToDeck(c, i)}
                    disabled={busy || added || !c.front.trim() || !c.back.trim()}
                    style={{ fontSize:11, fontWeight:600, fontFamily:'Inter,sans-serif',
                      background: added ? t.okBg : `${accent}1f`,
                      border:`1px solid ${added ? t.okBorder : accent+'55'}`,
                      color: added ? t.ok : accent,
                      borderRadius:6, padding:'4px 10px',
                      cursor: (busy||added) ? 'default' : 'pointer',
                      opacity: (!c.front.trim()||!c.back.trim()) ? .5 : 1 }}>
                    {added ? '✓ In my deck' : '+ Add to my deck'}
                  </button>
                  <button onClick={()=>remove(i)}
                    style={{ fontSize:11, fontWeight:600, fontFamily:'Inter,sans-serif',
                      background:t.surface3, border:`1px solid ${t.border}`,
                      color:t.text4, borderRadius:6, padding:'4px 10px', cursor:'pointer' }}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {cards.length > 0 && (
            <div style={{ fontSize:10.5, color:t.text4 }}>
              "Add to my deck" copies a card into your permanent Flashcards.
              Copies are yours — Re-analyze never touches them.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
