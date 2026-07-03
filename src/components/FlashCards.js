import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

export default function FlashCards({ userId }) {
  const { t } = useTheme();
  const [cards, setCards]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState('list'); // list | add | edit | study | studyOne
  const [studyIdx, setStudyIdx]   = useState(0);
  const [studyCards, setStudyCards] = useState([]);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]       = useState(false);

  // Form
  const [q, setQ]         = useState('');
  const [a, setA]         = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  // Edit
  const [editId, setEditId]   = useState(null);
  const [editQ, setEditQ]     = useState('');
  const [editA, setEditA]     = useState('');
  const [editSaving, setES]   = useState(false);

  // Theme-aware style helpers
  const B = (bg, color='#fff') => ({ background:bg, color, border:'none', borderRadius:8,
    padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif' });
  const lbl = { fontSize:10, color:t.text4, letterSpacing:.8, fontWeight:600,
    textTransform:'uppercase', display:'block', marginBottom:6 };
  const ta  = { width:'100%', background:t.surface2, border:`1px solid ${t.borderStrong}`, borderRadius:8,
    color:t.text, padding:'10px 12px', fontSize:14, outline:'none',
    boxSizing:'border-box', resize:'vertical', lineHeight:1.6, fontFamily:'Inter,sans-serif' };
  const ErrBox = ({ msg }) => (
    <div style={{ background:t.dangerBg, border:`1px solid ${t.dangerBorder}`,
      borderRadius:8, padding:'10px 14px', fontSize:13, color:t.danger }}>{msg}</div>
  );

  useEffect(() => {
    if (!userId) return;
    supabase.from('flashcards').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setCards(data || []);
        setLoading(false);
      });
  }, [userId]);

  const addCard = async () => {
    if (!q.trim() || !a.trim()) { setErr('Both fields required'); return; }
    setSaving(true); setErr('');
    const { data, error } = await supabase.from('flashcards').insert({
      user_id: userId, question: q.trim(), answer: a.trim()
    }).select().single();
    if (error) { setErr(error.message); setSaving(false); return; }
    setCards(p => [data, ...p]);
    setQ(''); setA(''); setSaving(false); setView('list');
  };

  const deleteCard = async (id) => {
    if (!window.confirm('Delete this flashcard?')) return;
    await supabase.from('flashcards').delete().eq('id', id);
    setCards(p => p.filter(c => c.id !== id));
  };

  const startEdit = (card) => {
    setEditId(card.id); setEditQ(card.question); setEditA(card.answer);
    setErr(''); setView('edit');
  };

  const saveEdit = async () => {
    if (!editQ.trim() || !editA.trim()) { setErr('Both fields required'); return; }
    setES(true); setErr('');
    const { data, error } = await supabase.from('flashcards')
      .update({ question: editQ.trim(), answer: editA.trim() })
      .eq('id', editId).select().single();
    if (error) { setErr(error.message); setES(false); return; }
    setCards(p => p.map(c => c.id === editId ? data : c));
    setES(false); setView('list');
  };

  const studyAll = () => {
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    setStudyCards(shuffled);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('study');
  };

  const studyOne = (card) => {
    setStudyCards([card]);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('studyOne');
  };

  const nextCard = () => {
    if (studyIdx + 1 >= studyCards.length) setDone(true);
    else { setStudyIdx(p => p + 1); setFlipped(false); }
  };

  const card = studyCards[studyIdx];

  if (loading) return (
    <div style={{ textAlign:'center', paddingTop:60, color:t.text4, fontFamily:'Inter,sans-serif' }}>
      Loading flashcards…
    </div>
  );

  // ── Study mode ────────────────────────────────────────────────────────
  if (view === 'study' || view === 'studyOne') {
    const isOne = view === 'studyOne';

    if (done || (!card && studyCards.length > 0)) return (
      <div style={{ maxWidth:500, margin:'0 auto', textAlign:'center',
        paddingTop:60, fontFamily:'Inter,sans-serif' }}>
        <div style={{ fontSize:40, marginBottom:16 }}>✅</div>
        <div style={{ fontSize:17, fontWeight:700, color:t.text, marginBottom:8 }}>
          {isOne ? 'Card reviewed!' : 'All done!'}
        </div>
        {!isOne && <div style={{ fontSize:14, color:t.text3, marginBottom:24 }}>
          You went through all {studyCards.length} cards.
        </div>}
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          {!isOne && <button onClick={studyAll} style={B(t.accent)}>Shuffle & Restart</button>}
          <button onClick={()=>{ setView('list'); setDone(false); }}
            style={B(t.surface3,t.text2)}>Back to List</button>
        </div>
      </div>
    );

    return (
      <div style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <button onClick={()=>setView('list')} style={{ background:'none', border:'none',
            color:t.text3, cursor:'pointer', fontSize:13, fontWeight:500,
            fontFamily:'Inter,sans-serif' }}>← Back</button>
          {!isOne && <span style={{ fontSize:13, color:t.text3 }}>
            {studyIdx + 1} / {studyCards.length}
          </span>}
        </div>

        {!isOne && (
          <div style={{ height:4, background:t.surface3, borderRadius:4, marginBottom:20 }}>
            <div style={{ height:'100%', background:t.accent, borderRadius:4,
              width:`${((studyIdx+1)/studyCards.length)*100}%`, transition:'width .3s' }} />
          </div>
        )}

        <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:14,
          padding:28, minHeight:200, boxShadow:`0 2px 8px ${t.shadow}`, marginBottom:16 }}>
          <div style={{ fontSize:10, color:t.text4, fontWeight:600,
            textTransform:'uppercase', letterSpacing:.8, marginBottom:12 }}>Question</div>
          <div style={{ fontSize:17, fontWeight:600, color:t.text, lineHeight:1.5 }}>
            {card.question}
          </div>
          {flipped && (
            <div style={{ marginTop:20, paddingTop:20, borderTop:`1px solid ${t.border}` }}>
              <div style={{ fontSize:10, color:t.ok, fontWeight:600,
                textTransform:'uppercase', letterSpacing:.8, marginBottom:12 }}>Answer</div>
              <div style={{ fontSize:15, color:t.text2, lineHeight:1.7, whiteSpace:'pre-wrap' }}>
                {card.answer}
              </div>
            </div>
          )}
        </div>

        {!flipped ? (
          <button onClick={()=>setFlipped(true)} style={{ ...B(t.accent), width:'100%' }}>
            Show Answer
          </button>
        ) : (
          <div style={{ display:'flex', gap:10 }}>
            {!isOne && <button onClick={nextCard} style={{ ...B(t.ok), flex:1 }}>
              Next →
            </button>}
            <button onClick={()=>{ setView('list'); setDone(false); }}
              style={{ ...B(t.surface3,t.text2), flex:isOne?2:1 }}>
              {isOne ? '← Back to List' : 'End Session'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Add mode ──────────────────────────────────────────────────────────
  if (view === 'add') return (
    <div style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:16, fontWeight:700, color:t.text, marginBottom:20 }}>New Flashcard</div>
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label style={lbl}>QUESTION</label>
          <textarea value={q} onChange={e=>setQ(e.target.value)}
            placeholder="What is the mechanism of action of metformin?"
            rows={3} autoFocus style={ta} />
        </div>
        <div>
          <label style={lbl}>ANSWER</label>
          <textarea value={a} onChange={e=>setA(e.target.value)}
            placeholder="Activates AMPK → decreases hepatic gluconeogenesis"
            rows={4} style={ta} />
        </div>
        {err && <ErrBox msg={err} />}
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={addCard} disabled={saving} style={B(t.accent)}>
            {saving?'Saving…':'+ Add Card'}
          </button>
          <button onClick={()=>{ setView('list'); setQ(''); setA(''); setErr(''); }}
            style={B(t.surface3,t.text2)}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── Edit mode ─────────────────────────────────────────────────────────
  if (view === 'edit') return (
    <div style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:16, fontWeight:700, color:t.text, marginBottom:20 }}>Edit Flashcard</div>
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label style={lbl}>QUESTION</label>
          <textarea value={editQ} onChange={e=>setEditQ(e.target.value)} rows={3} autoFocus style={ta} />
        </div>
        <div>
          <label style={lbl}>ANSWER</label>
          <textarea value={editA} onChange={e=>setEditA(e.target.value)} rows={4} style={ta} />
        </div>
        {err && <ErrBox msg={err} />}
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={saveEdit} disabled={editSaving} style={B(t.accent)}>
            {editSaving?'Saving…':'✓ Save Changes'}
          </button>
          <button onClick={()=>{ setView('list'); setErr(''); }} style={B(t.surface3,t.text2)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  // ── List mode ─────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:20, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:16, fontWeight:700, color:t.text }}>
          Flashcards <span style={{ fontSize:13, color:t.text4, fontWeight:400 }}>({cards.length})</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {cards.length > 0 && (
            <button onClick={studyAll} style={B(t.accent)}>▶ Study All (Shuffled)</button>
          )}
          <button onClick={()=>setView('add')} style={B(t.ok)}>+ New Card</button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🃏</div>
          <div style={{ fontSize:14, color:t.text3, marginBottom:16 }}>
            No flashcards yet. Add short Q&A cards for quick-fire facts.
          </div>
          <button onClick={()=>setView('add')} style={B(t.accent)}>+ Add First Card</button>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {cards.map(c => (
            <div key={c.id} style={{ background:t.surface, border:`1px solid ${t.border}`,
              borderRadius:10, padding:'16px 18px',
              boxShadow:`0 1px 2px ${t.shadow}` }}>
              <div style={{ display:'flex', justifyContent:'space-between',
                alignItems:'flex-start', gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:t.text, marginBottom:6 }}>
                    {c.question}
                  </div>
                  <div style={{ fontSize:12, color:t.text3, lineHeight:1.6 }}>{c.answer}</div>
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button onClick={()=>studyOne(c)} style={{
                    background:t.navActiveBg, border:`1px solid ${t.navActiveBorder}`, color:t.navActiveText,
                    borderRadius:6, padding:'5px 10px', fontSize:11,
                    cursor:'pointer', fontWeight:600, fontFamily:'Inter,sans-serif' }}>
                    ▶ Review
                  </button>
                  <button onClick={()=>startEdit(c)} style={{
                    background:t.surface2, border:`1px solid ${t.border}`, color:t.text2,
                    borderRadius:6, padding:'5px 10px', fontSize:11,
                    cursor:'pointer', fontWeight:600, fontFamily:'Inter,sans-serif' }}>
                    ✎ Edit
                  </button>
                  <button onClick={()=>deleteCard(c.id)} style={{
                    background:t.dangerBg, border:`1px solid ${t.dangerBorder}`, color:t.danger,
                    borderRadius:6, padding:'5px 10px', fontSize:11,
                    cursor:'pointer', fontWeight:600, fontFamily:'Inter,sans-serif' }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
