import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { SYSTEMS, DIFFICULTY, DIFF_COLOR } from '../lib/constants';

export default function AddEntry({ activeSystem, color, userId, onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [images, setImages] = useState([]); // { preview, file }
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState(null);

  const fileRef = useRef();
  const galleryRef = useRef();

  const loadFiles = useCallback((files) => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => setImages(prev => [...prev, { preview: e.target.result, file: f }]);
      reader.readAsDataURL(f);
    });
  }, []);

  const uploadImage = async (imgObj) => {
    const ext = imgObj.file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from('entry-images')
      .upload(path, imgObj.file, { contentType: imgObj.file.type });
    if (error) throw error;
    const { data } = supabase.storage.from('entry-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      // Upload images
      const urls = await Promise.all(images.map(uploadImage));

      const { data, error } = await supabase.from('entries').insert({
        user_id: userId,
        system: activeSystem,
        title: title.trim(),
        topic: topic.trim(),
        notes: notes.trim(),
        difficulty,
        images: urls,
        review_count: 0,
        last_reviewed: null
      }).select().single();

      if (error) throw error;
      onSaved(data);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', fontFamily: "'Syne', sans-serif" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 24 }}>
        New entry — <span style={{ color }}>{activeSystem}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <Field label="TITLE *">
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Digoxin toxicity — ECG changes"
            style={inp} autoFocus />
        </Field>

        <Field label="TOPIC / TAG">
          <input value={topic} onChange={e => setTopic(e.target.value)}
            placeholder="e.g. Arrhythmias, Electrolytes"
            style={inp} />
        </Field>

        <Field label="DIFFICULTY">
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={() => setDifficulty(d)} style={{
                padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: "'Syne', sans-serif",
                background: difficulty === d ? DIFF_COLOR[d] : '#1c1f2e',
                color: difficulty === d ? '#fff' : '#5a6580',
                transition: 'all .12s'
              }}>{d}</button>
            ))}
          </div>
        </Field>

        <Field label="REVIEW NOTES">
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Key concepts, mnemonics, clinical pearls, high-yield facts, buzzwords…"
            rows={8} style={{ ...inp, resize: 'vertical', lineHeight: 1.75 }} />
        </Field>

        <Field label="SCREENSHOTS / IMAGES">
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {/* Drag and drop */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); loadFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              style={{
                flex: 1, border: `2px dashed ${dragOver ? color : '#2a2f42'}`,
                borderRadius: 10, padding: '22px 14px', textAlign: 'center',
                cursor: 'pointer', background: dragOver ? `${color}12` : '#0c0e14',
                transition: 'all .13s'
              }}>
              <div style={{ fontSize: 26, marginBottom: 4 }}>🖼️</div>
              <div style={{ fontSize: 12, color: '#4a5070' }}>Drag & Drop</div>
              <div style={{ fontSize: 10, color: '#2a2f42', marginTop: 2 }}>or click to browse</div>
            </div>

            {/* Gallery / camera roll */}
            <div onClick={() => galleryRef.current?.click()}
              style={{
                flex: 1, border: '2px dashed #2a2f42', borderRadius: 10,
                padding: '22px 14px', textAlign: 'center',
                cursor: 'pointer', background: '#0c0e14', transition: 'all .13s'
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = color}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2f42'}>
              <div style={{ fontSize: 26, marginBottom: 4 }}>📷</div>
              <div style={{ fontSize: 12, color: '#4a5070' }}>From Gallery</div>
              <div style={{ fontSize: 10, color: '#2a2f42', marginTop: 2 }}>camera roll / files</div>
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*" multiple
            style={{ display: 'none' }} onChange={e => loadFiles(e.target.files)} />
          <input ref={galleryRef} type="file" accept="image/*" multiple
            style={{ display: 'none' }} onChange={e => loadFiles(e.target.files)} />

          {images.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img.preview} alt=""
                    style={{ width: 110, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #1c1f2e' }} />
                  <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{
                    position: 'absolute', top: -7, right: -7, background: '#e74c3c',
                    border: 'none', borderRadius: '50%', width: 20, height: 20,
                    fontSize: 10, color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Field>

        {err && (
          <div style={{ background: '#2a0d0d', border: '1px solid #e74c3c40', borderRadius: 8,
            padding: '10px 14px', fontSize: 13, color: '#e74c3c' }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{
            background: `linear-gradient(135deg, ${color}, ${color}cc)`,
            color: '#fff', border: 'none', borderRadius: 10,
            padding: '13px 28px', fontSize: 14, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1, fontFamily: "'Syne', sans-serif"
          }}>
            {saving ? 'Saving…' : '✓ Save Entry'}
          </button>
          <button onClick={onCancel} style={{
            background: '#1c1f2e', color: '#5a6580', border: 'none',
            borderRadius: 10, padding: '13px 20px', fontSize: 14,
            cursor: 'pointer', fontFamily: "'Syne', sans-serif"
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#4a5070', letterSpacing: 1.8, fontWeight: 800, marginBottom: 0 }}>{label}</div>
      {children}
    </div>
  );
}

const inp = {
  display: 'block', width: '100%', marginTop: 8,
  background: '#0c0e14', border: '1px solid #1c1f2e',
  borderRadius: 8, color: '#e8e8e8', padding: '11px 14px',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
  fontFamily: "'Syne', sans-serif"
};
