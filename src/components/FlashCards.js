import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const CARDS_KEY = 'medbook_flashcards_v1';

export default function FlashCards({ userId }) {
  const [cards, setCards]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState('list'); // list | add | study
  const [studyIdx, setStudyIdx] = useState(0);
  const [flipped, setFlipped]   = useState(false);
  const [studyDone, setDone]    = useState(false);

  // Form
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

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
    if (!q.trim() || !a.trim()) { setErr('Both question and answer are required'); return; }
    setSaving(true); setErr('');
    const { data, error } = await supabase.from('flashcards').insert({
      user_id: userId, question: q.trim(), answer: a.trim()
    }).select().single();
    if (error) { setErr(error.message); setSaving(false); return; }
    setCards(p => [data, ...p]);
    setQ(''); setA('');
    setSaving(false);
    setView('list');
  };

  const deleteCard = async (id) => {
    await supabase.from('flashcards').delete().eq('id', id);
    setCards(p => p.filter(c => c.id !== id));
  };

  const card = cards[studyIdx];

  if (loading) return (
    <div style={{ textAlign:'center', paddingTop:60, color:'#9ca3af', fontFamily:'Inter,sans-serif' }}>
      Loading flashcards…
    </div>
  );

  // Study mode
  if (view === 'study') {
    if (cards.length === 0) return (
      <div style={{ textAlign:'center', paddingTop:60, fontFamily:'Inter,sans-serif' }}>
        <div style={{ fontSize:14, color:'#6b7280', marginBottom:16 }}>No flashcards yet.</div>
        <button onClick={()=>setView('list')} style={btnStyle('#2563eb')}>Back</button>
      </div>
    );
    if (studyDone) return (
      <div style={{ maxWidth:500, margin:'0 auto', textAlign:'center', paddingTop:60, fontFamily:'Inter,sans-serif' }}>
        <div style={{ fontSize:40, marginBottom:16 }}>✅</div>
        <div style={{ fontSize:18, fontWeight:700, color:'#111827', marginBottom:8 }}>All done!</div>
        <div style={{ fontSize:14, color:'#6b7280', marginBottom:24 }}>You went through all {cards.length} cards.</div>
        <button onClick={()=>{ setStudyIdx(0); setFlipped(false); setDone(false); }} style={btnStyle('#2563eb')}>
          Study Again
        </button>
        <button onClick={()=>{ setView('list'); setStudyIdx(0); setFlipped(false); setDone(false); }}
          style={{ ...btnStyle('#f3f4f6'), color:'#374151', marginLeft:10 }}>Back to List</button>
      </div>
    );
    return (
      <div style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <button onClick={()=>{ setView('list'); setStudyIdx(0); setFlipped(false); }} style={{
            background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:13, fontWeight:500
          }}>← Back</button>
          <span style={{ fontSize:13, color:'#6b7280' }}>{studyIdx+1} / {cards.length}</span>
        </div>

        {/* Progress */}
        <div style={{ height:4, background:'#e5e7eb', borderRadius:4, marginBottom:20 }}>
          <div style={{ height:'100%', background:'#2563eb', borderRadius:4,
            width:`${((studyIdx+1)/cards.length)*100}%`, transition:'width .3s' }} />
        </div>

        {/* Card */}
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14,
          padding:28, minHeight:220, boxShadow:'0 2px 8px rgba(0,0,0,.06)',
          marginBottom:16, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600,
              textTransform:'uppercase', letterSpacing:.8, marginBottom:12 }}>Question</div>
            <div style={{ fontSize:17, fontWeight:600, color:'#111827', lineHeight:1.5 }}>
              {card.question}
            </div>
          </div>
          {flipped && (
            <div style={{ marginTop:20, paddingTop:20, borderTop:'1px solid #e5e7eb' }}>
              <div style={{ fontSize:10, color:'#16a34a', fontWeight:600,
                textTransform:'uppercase', letterSpacing:.8, marginBottom:12 }}>Answer</div>
              <div style={{ fontSize:15, color:'#1f2937', lineHeight:1.7, whiteSpace:'pre-wrap' }}>
                {card.answer}
              </div>
            </div>
          )}
        </div>

        {!flipped ? (
          <button onClick={()=>setFlipped(true)} style={{ ...btnStyle('#2563eb'), width:'100%' }}>
            Show Answer
          </button>
        ) : (
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={()=>{ setFlipped(false); if(studyIdx+1>=cards.length) setDone(true); else setStudyIdx(p=>p+1); }}
              style={{ ...btnStyle('#16a34a'), flex:1 }}>Next →</button>
            <button onClick={()=>{ setStudyIdx(0); setFlipped(false); }}
              style={{ ...btnStyle('#f3f4f6'), color:'#374151', flex:1 }}>Restart</button>
          </div>
        )}
      </div>
    );
  }

  // Add mode
  if (view === 'add') return (
    <div style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ fontSize:16, fontWeight:700, color:'#111827', marginBottom:20 }}>New Flashcard</div>
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
            placeholder="Activates AMPK → decreases hepatic gluconeogenesis, increases insulin sensitivity"
            rows={4} style={ta} />
        </div>
        {err && <div style={{ background:'#fef2f2', border:'1px solid #fecaca',
          borderRadius:8, padding:'10px 14px', fontSize:13, color:'#dc2626' }}>{err}</div>}
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={addCard} disabled={saving} style={btnStyle('#2563eb')}>
            {saving ? 'Saving…' : '+ Add Card'}
          </button>
          <button onClick={()=>{ setView('list'); setQ(''); setA(''); setErr(''); }}
            style={{ ...btnStyle('#f3f4f6'), color:'#374151' }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // List mode
  return (
    <div style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:16, fontWeight:700, color:'#111827' }}>
          Flashcards <span style={{ fontSize:13, color:'#9ca3af', fontWeight:400 }}>({cards.length})</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {cards.length > 0 && (
            <button onClick={()=>{ setStudyIdx(0); setFlipped(false); setDone(false); setView('study'); }}
              style={btnStyle('#2563eb')}>▶ Study All</button>
          )}
          <button onClick={()=>setView('add')} style={btnStyle('#16a34a')}>+ New Card</button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🃏</div>
          <div style={{ fontSize:14, color:'#6b7280', marginBottom:16 }}>
            No flashcards yet. Add short Q&A cards for quick-fire facts.
          </div>
          <button onClick={()=>setView('add')} style={btnStyle('#2563eb')}>+ Add First Card</button>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {cards.map(c => (
            <div key={c.id} style={{ background:'#fff', border:'1px solid #e5e7eb',
              borderRadius:10, padding:'16px 18px',
              boxShadow:'0 1px 2px rgba(0,0,0,.04)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#111827', marginBottom:6 }}>{c.question}</div>
                  <div style={{ fontSize:12, color:'#6b7280', lineHeight:1.6 }}>{c.answer}</div>
                </div>
                <button onClick={()=>deleteCard(c.id)} style={{ background:'#fef2f2',
                  border:'1px solid #fecaca', color:'#dc2626', borderRadius:6,
                  padding:'4px 10px', fontSize:11, cursor:'pointer',
                  fontWeight:600, flexShrink:0, fontFamily:'Inter,sans-serif' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnStyle = bg => ({
  background:bg, color:'#fff', border:'none', borderRadius:8,
  padding:'10px 20px', fontSize:13, fontWeight:600,
  cursor:'pointer', fontFamily:'Inter,sans-serif'
});
const lbl = { fontSize:10, color:'#9ca3af', letterSpacing:.8, fontWeight:600,
  textTransform:'uppercase', display:'block', marginBottom:6 };
const ta = { width:'100%', background:'#fff', border:'1px solid #d1d5db', borderRadius:8,
  color:'#111827', padding:'10px 12px', fontSize:14, outline:'none',
  boxSizing:'border-box', resize:'vertical', lineHeight:1.6, fontFamily:'Inter,sans-serif' };
