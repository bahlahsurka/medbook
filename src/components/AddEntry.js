import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';

export default function AddEntry({ activeSystem, color, userId, onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [images, setImages] = useState([]);
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
    setSaving(true); setErr(null);
    try {
      const urls = await Promise.all(images.map(uploadImage));
      const { data, error } = await supabase.from('entries').insert({
        user_id: userId, system: activeSystem,
        title: title.trim(), topic: topic.trim(),
        notes: notes.trim(), difficulty, images: urls,
        review_count: 0, last_reviewed: null
      }).select().single();
      if (error) throw error;
      onSaved(data);
    } catch (e) {
      setErr(e.message); setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 20 }}>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={() => setDifficulty(d)} style={{
                padding: '7px 16px', borderRadius: 6, border: `1px solid ${difficulty === d ? DIFF_COLOR[d] : '#e5e7eb'}`,
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: difficulty === d ? `${DIFF_COLOR[d]}12` : '#fff',
                color: difficulty === d ? DIFF_COLOR[d] : '#6b7280',
                transition: 'all .1s'
              }}>{d}</button>
            ))}
          </div>
        </Field>

        <Field label="REVIEW NOTES">
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Key concepts, mnemonics, clinical pearls, high-yield facts…"
            rows={8} style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} />
        </Field>

        <Field label="SCREENSHOTS / IMAGES">
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); loadFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              style={{
                flex: 1, minWidth: 120, border: `2px dashed ${dragOver ? color : '#d1d5db'}`,
                borderRadius: 8, padding: '20px 14px', textAlign: 'center',
                cursor: 'pointer', background: dragOver ? `${color}08` : '#f9fafb',
                transition: 'all .13s'
              }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>🖼️</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Drag & Drop</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>or click to browse</div>
            </div>

            <div onClick={() => galleryRef.current?.click()}
              style={{
                flex: 1, minWidth: 120, border: '2px dashed #d1d5db', borderRadius: 8,
                padding: '20px 14px', textAlign: 'center', cursor: 'pointer',
                background: '#f9fafb', transition: 'all .13s'
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = color}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#d1d5db'}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>From Gallery</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>camera roll / files</div>
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
                    style={{ width: 100, height: 76, objectFit: 'cover', borderRadius: 7, border: '1px solid #e5e7eb' }} />
                  <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{
                    position: 'absolute', top: -7, right: -7, background: '#dc2626',
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
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{
            background: color, color: '#fff', border: 'none', borderRadius: 8,
            padding: '11px 24px', fontSize: 14, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1
          }}>
            {saving ? 'Saving…' : '✓ Save Entry'}
          </button>
          <button onClick={onCancel} style={{
            background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
            borderRadius: 8, padding: '11px 20px', fontSize: 14, cursor: 'pointer'
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.8,
        fontWeight: 600, marginBottom: 0, textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  );
}

const inp = {
  display: 'block', width: '100%', marginTop: 8,
  background: '#fff', border: '1px solid #d1d5db',
  borderRadius: 8, color: '#111827', padding: '10px 12px',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
