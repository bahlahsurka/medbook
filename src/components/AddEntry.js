import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR, SYSTEMS, SYS_COLOR } from '../lib/constants';

const DRAFT_KEY = 'medbook_draft';

function loadDraft(system) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    return d[system] || null;
  } catch { return null; }
}
function saveDraft(system, data) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    d[system] = data;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
}
function clearDraft(system) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    delete d[system];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
}

export default function AddEntry({ activeSystem, color, userId, onSaved, onCancel }) {
  const draft = loadDraft(activeSystem);

  const [title, setTitle]       = useState(draft?.title || '');
  const [notes, setNotes]       = useState(draft?.notes || '');
  const [difficulty, setDiff]   = useState(draft?.difficulty || 'Medium');
  const [systems, setSystems]   = useState(draft?.systems || [activeSystem]);
  const [images, setImages]     = useState([]); // can't persist files in localStorage
  const [saving, setSaving]     = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr]           = useState(null);
  const [sysOpen, setSysOpen]   = useState(false);

  const fileRef    = useRef();
  const galleryRef = useRef();

  // Auto-save draft on every change
  useEffect(() => {
    saveDraft(activeSystem, { title, notes, difficulty, systems });
  }, [title, notes, difficulty, systems, activeSystem]);

  const toggleSystem = (sys) => {
    setSystems(prev =>
      prev.includes(sys) ? prev.filter(s => s !== sys) : [...prev, sys]
    );
  };

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
      .from('entry-images').upload(path, imgObj.file, { contentType: imgObj.file.type });
    if (error) throw error;
    const { data } = supabase.storage.from('entry-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    if (systems.length === 0) { setErr('Select at least one system'); return; }
    setSaving(true); setErr(null);
    try {
      const urls = await Promise.all(images.map(uploadImage));
      // Insert one entry per selected system
      const rows = systems.map(sys => ({
        user_id: userId, system: sys,
        title: title.trim(), notes: notes.trim(),
        difficulty, images: urls,
        review_count: 0, last_reviewed: null
      }));
      const { data, error } = await supabase.from('entries').insert(rows).select();
      if (error) throw error;
      clearDraft(activeSystem);
      onSaved(data); // array of saved entries
    } catch (e) {
      setErr(e.message); setSaving(false);
    }
  };

  const hasDraft = !!(draft?.title || draft?.notes);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>New Entry</div>
        {hasDraft && (
          <span style={{ fontSize: 11, background: '#fef9c3', color: '#92400e',
            borderRadius: 5, padding: '2px 8px', fontWeight: 600, border: '1px solid #fde68a' }}>
            Draft restored
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <Field label="TITLE *">
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Digoxin toxicity — ECG changes"
            style={inp} autoFocus />
        </Field>

        {/* System selector */}
        <Field label="SYSTEMS (select all that apply)">
          <div style={{ marginTop: 8 }}>
            {/* Selected pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {systems.map(s => (
                <span key={s} onClick={() => toggleSystem(s)} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 600,
                  background: `${SYS_COLOR[s]}15`, color: SYS_COLOR[s],
                  border: `1px solid ${SYS_COLOR[s]}40`,
                  borderRadius: 5, padding: '3px 10px', cursor: 'pointer'
                }}>
                  {s} <span style={{ fontSize: 10 }}>✕</span>
                </span>
              ))}
              <button onClick={() => setSysOpen(p => !p)} style={{
                fontSize: 12, background: '#f3f4f6', border: '1px solid #e5e7eb',
                borderRadius: 5, padding: '3px 12px', cursor: 'pointer',
                color: '#374151', fontWeight: 600
              }}>{sysOpen ? '▲ Close' : '+ Add System'}</button>
            </div>

            {/* Dropdown */}
            {sysOpen && (
              <div style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: 12, display: 'flex', flexWrap: 'wrap', gap: 6,
                maxHeight: 220, overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                {SYSTEMS.map(s => {
                  const sel = systems.includes(s);
                  return (
                    <button key={s} onClick={() => toggleSystem(s)} style={{
                      fontSize: 12, fontWeight: sel ? 600 : 400,
                      background: sel ? `${SYS_COLOR[s]}15` : '#f9fafb',
                      color: sel ? SYS_COLOR[s] : '#374151',
                      border: `1px solid ${sel ? SYS_COLOR[s] + '50' : '#e5e7eb'}`,
                      borderRadius: 5, padding: '5px 12px', cursor: 'pointer',
                      transition: 'all .1s'
                    }}>{s}</button>
                  );
                })}
              </div>
            )}
          </div>
        </Field>

        <Field label="DIFFICULTY">
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={() => setDiff(d)} style={{
                padding: '7px 16px', borderRadius: 6,
                border: `1px solid ${difficulty === d ? DIFF_COLOR[d] : '#e5e7eb'}`,
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: difficulty === d ? `${DIFF_COLOR[d]}12` : '#fff',
                color: difficulty === d ? DIFF_COLOR[d] : '#6b7280',
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
              }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>🖼️</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Drag & Drop</div>
            </div>
            <div onClick={() => galleryRef.current?.click()} style={{
              flex: 1, minWidth: 120, border: '2px dashed #d1d5db', borderRadius: 8,
              padding: '20px 14px', textAlign: 'center', cursor: 'pointer', background: '#f9fafb',
            }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>From Gallery</div>
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
                    style={{ width: 100, height: 76, objectFit: 'cover',
                      borderRadius: 7, border: '1px solid #e5e7eb' }} />
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
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
            ℹ️ Images are not saved in drafts — re-add them if you switched apps
          </div>
        </Field>

        {err && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving} style={{
            background: color, color: '#fff', border: 'none', borderRadius: 8,
            padding: '11px 24px', fontSize: 14, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1
          }}>{saving ? 'Saving…' : `✓ Save to ${systems.length} system${systems.length !== 1 ? 's' : ''}`}</button>
          <button onClick={() => { clearDraft(activeSystem); onCancel(); }} style={{
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
        fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
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
