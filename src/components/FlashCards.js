import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import { useReviewKeyboard } from '../lib/useReviewKeyboard';
import { SYS_COLOR } from '../lib/constants';

// Sentinel key for cards with no system assigned (legacy cards, or anything
// created before folders existed). Never stored in the DB as this string —
// the DB value is always NULL; this is purely a UI-side grouping key.
const UNCAT = '__uncategorized__';

export default function FlashCards({ userId, userSystems }) {
  const { t } = useTheme();
  const [cards, setCards]     = useState([]);
  const [loading, setLoading] = useState(true);

  // 'folders' = top-level system browser (the new landing view)
  // 'list'    = cards inside one folder/system
  // 'add' | 'edit' | 'study' | 'studyOne'
  const [view, setView]           = useState('folders');
  const [activeFolder, setAF]     = useState(null); // system name, or UNCAT, or null (top level)

  const [studyIdx, setStudyIdx]   = useState(0);
  const [studyCards, setStudyCards] = useState([]);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone]       = useState(false);

  // Form
  const [q, setQ]         = useState('');
  const [a, setA]         = useState('');
  const [formSystem, setFormSystem] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  // Edit
  const [editId, setEditId]   = useState(null);
  const [editQ, setEditQ]     = useState('');
  const [editA, setEditA]     = useState('');
  const [editSystem, setEditSystem] = useState('');
  const [editSaving, setES]   = useState(false);

  // Theme-aware style helpers
  const B = (bg, color='#fff') => ({ background:bg, color, border:'none', borderRadius:8,
    padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif' });
  const lbl = { fontSize:10, color:t.text4, letterSpacing:.8, fontWeight:600,
    textTransform:'uppercase', display:'block', marginBottom:6 };
  const ta  = { width:'100%', background:t.surface2, border:`1px solid ${t.borderStrong}`, borderRadius:8,
    color:t.text, padding:'10px 12px', fontSize:14, outline:'none',
    boxSizing:'border-box', resize:'vertical', lineHeight:1.6, fontFamily:'Inter,sans-serif' };
  const selectStyle = { width:'100%', background:t.surface2, border:`1px solid ${t.borderStrong}`,
    borderRadius:8, color:t.text, padding:'10px 12px', fontSize:14, outline:'none',
    boxSizing:'border-box', fontFamily:'Inter,sans-serif' };
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

  // ── Folder grouping ──────────────────────────────────────────────────
  // Systems that have cards, in the same order as the sidebar (userSystems),
  // then any system referenced by a card but no longer in userSystems (e.g.
  // renamed/removed — the cards aren't lost, they still get their own
  // folder), then Uncategorized last.
  const folders = useMemo(() => {
    const counts = {};
    cards.forEach(c => {
      const key = c.system || UNCAT;
      counts[key] = (counts[key] || 0) + 1;
    });
    const out = [];
    const seen = new Set();
    (userSystems || []).forEach(s => {
      if (counts[s.name]) {
        out.push({ key: s.name, label: s.name, color: s.color || SYS_COLOR[s.name] || '#2563eb', count: counts[s.name] });
        seen.add(s.name);
      }
    });
    Object.keys(counts).forEach(key => {
      if (key === UNCAT || seen.has(key)) return;
      out.push({ key, label: key, color: SYS_COLOR[key] || '#6b7280', count: counts[key] });
      seen.add(key);
    });
    if (counts[UNCAT]) {
      out.push({ key: UNCAT, label: 'Uncategorized', color: t.text4, count: counts[UNCAT] });
    }
    return out;
  }, [cards, userSystems, t.text4]);

  const folderCards = useMemo(() => {
    if (activeFolder === null) return [];
    return cards.filter(c => (c.system || UNCAT) === activeFolder);
  }, [cards, activeFolder]);

  const openFolder = (key) => { setAF(key); setView('list'); };
  const backToFolders = () => { setAF(null); setView('folders'); };

  // ── CRUD ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    // Pre-select the system if we're already inside a real folder (not
    // Uncategorized) — saves a click for the common case. Adding from the
    // top level, or from inside Uncategorized, starts blank so you make a
    // deliberate choice instead of drifting back into an unsorted pile.
    setFormSystem(activeFolder && activeFolder !== UNCAT ? activeFolder : '');
    setQ(''); setA(''); setErr(''); setView('add');
  };

  const addCard = async () => {
    if (!q.trim() || !a.trim()) { setErr('Both fields required'); return; }
    if (!formSystem) { setErr('Choose a system for this card'); return; }
    setSaving(true); setErr('');
    const { data, error } = await supabase.from('flashcards').insert({
      user_id: userId, question: q.trim(), answer: a.trim(), system: formSystem
    }).select().single();
    if (error) { setErr(error.message); setSaving(false); return; }
    setCards(p => [data, ...p]);
    setQ(''); setA(''); setSaving(false);
    setAF(formSystem); setView('list'); // land in the folder the card was just filed under
  };

  const deleteCard = async (id) => {
    if (!window.confirm('Delete this flashcard?')) return;
    await supabase.from('flashcards').delete().eq('id', id);
    setCards(p => p.filter(c => c.id !== id));
  };

  const startEdit = (card) => {
    setEditId(card.id); setEditQ(card.question); setEditA(card.answer);
    setEditSystem(card.system || '');
    setErr(''); setView('edit');
  };

  const saveEdit = async () => {
    if (!editQ.trim() || !editA.trim()) { setErr('Both fields required'); return; }
    setES(true); setErr('');
    const { data, error } = await supabase.from('flashcards')
      .update({ question: editQ.trim(), answer: editA.trim(), system: editSystem || null })
      .eq('id', editId).select().single();
    if (error) { setErr(error.message); setES(false); return; }
    setCards(p => p.map(c => c.id === editId ? data : c));
    setES(false); setView('list');
  };

  // Fast path for re-filing legacy/Uncategorized cards without opening the
  // full edit form — a one-click dropdown right on the card row.
  const quickMove = async (card, newSystem) => {
    const { data, error } = await supabase.from('flashcards')
      .update({ system: newSystem || null })
      .eq('id', card.id).select().single();
    if (!error) setCards(p => p.map(c => c.id === card.id ? data : c));
  };

  // ── Study ────────────────────────────────────────────────────────────
  const studyThisFolder = () => {
    const shuffled = [...folderCards].sort(() => Math.random() - 0.5);
    setStudyCards(shuffled);
    setStudyIdx(0); setFlipped(false); setDone(false); setView('study');
  };

  const studyEverything = () => {
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

  // Keyboard: Space=reveal, Enter=Next (no difficulty rating here — this is a
  // plain flip-through deck, not the spaced-repetition review queue).
  const inStudy = (view === 'study' || view === 'studyOne') && !done && !!card;
  useReviewKeyboard(inStudy, {
    flipped, onFlip: () => setFlipped(true),
    onNext: () => nextCard(),
  });

  if (loading) return (
    <div style={{ textAlign:'center', paddingTop:60, color:t.text4, fontFamily:'Inter,sans-serif' }}>
      Loading flashcards…
    </div>
  );

  // ── Study mode ────────────────────────────────────────────────────────
  if (view === 'study' || view === 'studyOne') {
    const isOne = view === 'studyOne';
    const backTarget = () => { setView('list'); setDone(false); };

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
          {!isOne && activeFolder !== null && (
            <button onClick={studyThisFolder} style={B(t.accent)}>Shuffle & Restart</button>
          )}
          <button onClick={activeFolder===null ? backToFolders : backTarget}
            style={B(t.surface3,t.text2)}>
            {activeFolder===null ? '← All Folders' : '← Back to List'}
          </button>
        </div>
      </div>
    );

    return (
      <div style={{ maxWidth:560, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <button onClick={activeFolder===null ? backToFolders : backTarget}
            style={{ background:'none', border:'none',
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
            Show Answer · Space
          </button>
        ) : (
          <div style={{ display:'flex', gap:10 }}>
            {!isOne && <button onClick={nextCard} style={{ ...B(t.ok), flex:1 }}>
              Next →
            </button>}
            <button onClick={activeFolder===null ? backToFolders : backTarget}
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
          <label style={lbl}>SYSTEM</label>
          <select value={formSystem} onChange={e=>setFormSystem(e.target.value)} style={selectStyle}>
            <option value="">Choose a system…</option>
            {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>QUESTION</label>
          <textarea value={q} onChange={e=>setQ(e.target.value)}
            placeholder="What is the mechanism of action of metformin?"
            rows={3} style={ta} />
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
          <button onClick={()=>{ activeFolder ? setView('list') : backToFolders(); setQ(''); setA(''); setErr(''); }}
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
          <label style={lbl}>SYSTEM</label>
          <select value={editSystem} onChange={e=>setEditSystem(e.target.value)} style={selectStyle}>
            <option value="">Uncategorized</option>
            {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>QUESTION</label>
          <textarea value={editQ} onChange={e=>setEditQ(e.target.value)} rows={3} style={ta} />
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

  // ── Folder list (top level) ─────────────────────────────────────────
  if (view === 'folders') return (
    <div style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:20, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:16, fontWeight:700, color:t.text }}>
          Flashcards <span style={{ fontSize:13, color:t.text4, fontWeight:400 }}>({cards.length})</span>
        </div>
        {cards.length > 0 && (
          <button onClick={studyEverything} style={B(t.accent)}>▶ Study Everything (Shuffled)</button>
        )}
      </div>

      {cards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🃏</div>
          <div style={{ fontSize:14, color:t.text3, marginBottom:16 }}>
            No flashcards yet. Add cards from AI Analysis, or create one manually below.
          </div>
          <button onClick={openAdd} style={B(t.accent)}>+ Add First Card</button>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {folders.map(f => (
            <button key={f.key} onClick={()=>openFolder(f.key)} style={{
              display:'flex', alignItems:'center', gap:12, textAlign:'left',
              background:t.surface, border:`1px solid ${t.border}`, borderRadius:10,
              padding:'14px 18px', cursor:'pointer', boxShadow:`0 1px 2px ${t.shadow}`,
              fontFamily:'Inter,sans-serif' }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:f.color, flexShrink:0 }} />
              <div style={{ flex:1, fontSize:14, fontWeight:600,
                color: f.key===UNCAT ? t.text3 : t.text,
                fontStyle: f.key===UNCAT ? 'italic' : 'normal' }}>
                {f.label}
              </div>
              <span style={{ fontSize:12, color:t.text4, background:t.surface3,
                borderRadius:10, padding:'2px 9px', fontWeight:600 }}>{f.count}</span>
              <span style={{ fontSize:13, color:t.text4 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <button onClick={openAdd} style={{ ...B(t.ok), marginTop:16, width:'100%' }}>
          + New Card
        </button>
      )}
    </div>
  );

  // ── Per-folder card list ─────────────────────────────────────────────
  const folderMeta = folders.find(f => f.key === activeFolder);
  const folderLabel = folderMeta?.label || (activeFolder===UNCAT ? 'Uncategorized' : activeFolder);
  const folderColor = folderMeta?.color || t.text4;

  return (
    <div style={{ maxWidth:680, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <button onClick={backToFolders} style={{ background:'none', border:'none',
        color:t.text3, cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:14,
        fontFamily:'Inter,sans-serif', padding:0 }}>← All Folders</button>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:20, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:10, height:10, borderRadius:'50%', background:folderColor, flexShrink:0 }} />
          <div style={{ fontSize:16, fontWeight:700, color:t.text }}>
            {folderLabel} <span style={{ fontSize:13, color:t.text4, fontWeight:400 }}>({folderCards.length})</span>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {folderCards.length > 0 && (
            <button onClick={studyThisFolder} style={B(t.accent)}>▶ Study (Shuffled)</button>
          )}
          <button onClick={openAdd} style={B(t.ok)}>+ New Card</button>
        </div>
      </div>

      {activeFolder === UNCAT && folderCards.length > 0 && (
        <div style={{ background:t.warnBg, border:`1px solid ${t.warnBorder}`, borderRadius:8,
          padding:'10px 14px', fontSize:12.5, color:t.warn, marginBottom:14 }}>
          These cards have no system assigned. Use the dropdown on each card to file it —
          no need to open Edit.
        </div>
      )}

      {folderCards.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🃏</div>
          <div style={{ fontSize:14, color:t.text3, marginBottom:16 }}>
            No cards in {folderLabel} yet.
          </div>
          <button onClick={openAdd} style={B(t.accent)}>+ Add a Card</button>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {folderCards.map(c => (
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
                <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0, alignItems:'flex-end' }}>
                  <div style={{ display:'flex', gap:6 }}>
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
                  {/* Fast re-file path — no need to open Edit just to fix a
                      miscategorized or legacy Uncategorized card. */}
                  <select value={c.system || ''} onChange={e=>quickMove(c, e.target.value)}
                    title="Move to a different system"
                    style={{ fontSize:11, background:t.surface2, border:`1px solid ${t.border}`,
                      borderRadius:6, padding:'4px 6px', color:t.text3, fontFamily:'Inter,sans-serif',
                      cursor:'pointer' }}>
                    <option value="">Uncategorized</option>
                    {(userSystems||[]).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
