import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DIFFICULTY, DIFF_COLOR } from '../lib/constants';

const DRAFT_KEY = 'medbook_draft_v1';

function loadDraft(sys) {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')[sys] || null; }
  catch { return null; }
}
function saveDraft(sys, data) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    d[sys] = data;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
}
function clearDraft(sys) {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    delete d[sys];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
}

export default function AddEntry({ activeSystem, color, userId, onSaved, onCancel, userSystems }) {
  const draft = loadDraft(activeSystem);

  const [title, setTitle]       = useState(draft?.title || '');
  const [notes, setNotes]       = useState(draft?.notes || '');
  const [difficulty, setDiff]   = useState(draft?.difficulty || 'Medium');
  const [systems, setSystems]   = useState(draft?.systems?.length ? draft.systems : [activeSystem]);
  const [images, setImages]     = useState([]);
  const [saving, setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '', 'uploading', 'saving', 'done', 'error'
  const [err, setErr]           = useState('');
  const [sysOpen, setSysOpen]   = useState(false);
  const [dragOver, setDrag]     = useState(false);

  const fileRef = useRef();
  const galRef  = useRef();

  // Autosave draft on every keystroke
  useEffect(() => {
    saveDraft(activeSystem, { title, notes, difficulty, systems });
  }, [title, notes, difficulty, systems, activeSystem]);

  const toggleSys = (name) =>
    setSystems(p => p.includes(name) ? p.filter(s => s !== name) : [...p, name]);

  const loadFiles = useCallback((files) => {
    Array.from(files).forEach(f => {
      if (!f.type.startsWith('image/')) return;
      const r = new FileReader();
      r.onload = e => setImages(p => [...p, { preview: e.target.result, file: f }]);
      r.readAsDataURL(f);
    });
  }, []);

  const uploadImage = async (img) => {
    const ext = img.file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from('entry-images')
      .upload(path, img.file, { contentType: img.file.type });
    if (error) throw new Error(`Image upload failed: ${error.message}`);
    return supabase.storage.from('entry-images').getPublicUrl(path).data.publicUrl;
  };

  const save = async () => {
    setErr('');
    if (!title.trim()) { setErr('Title is required'); return; }
    if (!systems.length) { setErr('Select at least one system'); return; }

    setSaving(true);

    try {
      // Step 1: upload images
      let urls = [];
      if (images.length > 0) {
        setSaveStatus('Uploading images…');
        urls = await Promise.all(images.map(uploadImage));
      }

      // Step 2: save entry
      setSaveStatus('Saving entry…');
      const rows = systems.map(sys => ({
        user_id: userId,
        system: sys,
        title: title.trim(),
        notes: notes.trim(),
        difficulty,
        images: urls,
        review_count: 0,
        last_reviewed: null,
        pinned: false,
        highlights: []
      }));

      const { data, error } = await supabase
        .from('entries')
        .insert(rows)
        .select();

      if (error) throw new Error(`Save failed: ${error.message}`);

      setSaveStatus('Saved ✓');
      clearDraft(activeSystem);

      // Brief pause so user sees confirmation
      setTimeout(() => onSaved(data), 400);

    } catch (e) {
      setErr(e.message);
      setSaving(false);
      setSaveStatus('');
    }
  };

  const hasDraft = !!(draft?.title || draft?.notes);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', fontFamily: 'Inter,sans-serif' }}>

      {/* Header */}
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

        {/* Title */}
        <Field label="TITLE *">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Digoxin toxicity — ECG changes"
            style={inp}
            autoFocus
            disabled={saving}
          />
        </Field>

        {/* Systems */}
        <Field label="SYSTEMS (select all that apply)">
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {systems.map(s => {
                const sys = (userSystems || []).find(u => u.name === s);
                const c = sys?.color || '#2563eb';
                return (
                  <span key={s} onClick={() => !saving && toggleSys(s)} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600,
                    background: `${c}15`, color: c,
                    border: `1px solid ${c}40`,
                    borderRadius: 5, padding: '3px 10px',
                    cursor: saving ? 'default' : 'pointer'
                  }}>
                    {s} {!saving && <span style={{ fontSize: 10 }}>✕</span>}
                  </span>
                );
              })}
              {!saving && (
                <button onClick={() => setSysOpen(p => !p)} style={{
                  fontSize: 12, background: '#f3f4f6', border: '1px solid #e5e7eb',
                  borderRadius: 5, padding: '3px 12px', cursor: 'pointer',
                  color: '#374151', fontWeight: 600, fontFamily: 'Inter,sans-serif'
                }}>{sysOpen ? '▲ Close' : '+ Add System'}</button>
              )}
            </div>

            {sysOpen && !saving && (
              <div style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: 12, display: 'flex', flexWrap: 'wrap', gap: 6,
                maxHeight: 200, overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,.08)'
              }}>
                {(userSystems || []).map(s => {
                  const sel = systems.includes(s.name);
                  const c = s.color || '#2563eb';
                  return (
                    <button key={s.name} onClick={() => toggleSys(s.name)} style={{
                      fontSize: 12, fontWeight: sel ? 600 : 400,
                      background: sel ? `${c}15` : '#f9fafb',
                      color: sel ? c : '#374151',
                      border: `1px solid ${sel ? c + '50' : '#e5e7eb'}`,
                      borderRadius: 5, padding: '5px 12px',
                      cursor: 'pointer', fontFamily: 'Inter,sans-serif'
                    }}>{s.name}</button>
                  );
                })}
              </div>
            )}
          </div>
        </Field>

        {/* Difficulty */}
        <Field label="DIFFICULTY">
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {DIFFICULTY.map(d => (
              <button key={d} onClick={() => !saving && setDiff(d)} style={{
                padding: '7px 16px', borderRadius: 6,
                border: `1px solid ${difficulty === d ? DIFF_COLOR[d] : '#e5e7eb'}`,
                cursor: saving ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
                background: difficulty === d ? `${DIFF_COLOR[d]}12` : '#fff',
                color: difficulty === d ? DIFF_COLOR[d] : '#6b7280',
                fontFamily: 'Inter,sans-serif'
              }}>{d}</button>
            ))}
          </div>
        </Field>

        {/* Notes */}
        <Field label="REVIEW NOTES">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Key concepts, mnemonics, clinical pearls, high-yield facts…"
            rows={8}
            disabled={saving}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }}
          />
        </Field>

        {/* Images */}
        <Field label="SCREENSHOTS / IMAGES">
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); loadFiles(e.dataTransfer.files); }}
              onClick={() => !saving && fileRef.current?.click()}
              style={{
                flex: 1, minWidth: 120,
                border: `2px dashed ${dragOver ? color : '#d1d5db'}`,
                borderRadius: 8, padding: '20px 14px', textAlign: 'center',
                cursor: saving ? 'default' : 'pointer',
                background: dragOver ? `${color}08` : '#f9fafb'
              }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>🖼️</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Drag & Drop</div>
            </div>
            <div
              onClick={() => !saving && galRef.current?.click()}
              style={{
                flex: 1, minWidth: 120, border: '2px dashed #d1d5db',
                borderRadius: 8, padding: '20px 14px', textAlign: 'center',
                cursor: saving ? 'default' : 'pointer', background: '#f9fafb'
              }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>From Gallery</div>
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*" multiple
            style={{ display: 'none' }} onChange={e => loadFiles(e.target.files)} />
          <input ref={galRef} type="file" accept="image/*" multiple
            style={{ display: 'none' }} onChange={e => loadFiles(e.target.files)} />

          {images.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img.preview} alt="" style={{
                    width: 100, height: 76, objectFit: 'cover',
                    borderRadius: 7, border: '1px solid #e5e7eb'
                  }} />
                  {!saving && (
                    <button onClick={() => setImages(p => p.filter((_, j) => j !== i))} style={{
                      position: 'absolute', top: -7, right: -7, background: '#dc2626',
                      border: 'none', borderRadius: '50%', width: 20, height: 20,
                      fontSize: 10, color: '#fff', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
            ℹ️ Text is auto-saved as draft. Images need to be re-added if you switch apps.
          </div>
        </Field>

        {/* Error */}
        {err && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#dc2626'
          }}>
            <strong>Error:</strong> {err}
            <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>
              Your text is saved as a draft. Try again or check your connection.
            </div>
          </div>
        )}

        {/* Save button */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: saving ? '#93c5fd' : color,
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '12px 28px', fontSize: 14, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'Inter,sans-serif',
              minWidth: 160,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}>
            {saving ? (
              <>
                <span style={{
                  display: 'inline-block', width: 14, height: 14,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTop: '2px solid #fff', borderRadius: '50%',
                  animation: 'spin .7s linear infinite'
                }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                {saveStatus || 'Saving…'}
              </>
            ) : `✓ Save to ${systems.length} system${systems.length !== 1 ? 's' : ''}`}
          </button>

          {!saving && (
            <button onClick={() => { clearDraft(activeSystem); onCancel(); }} style={{
              background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
              borderRadius: 8, padding: '12px 20px', fontSize: 14,
              cursor: 'pointer', fontFamily: 'Inter,sans-serif'
            }}>Cancel</button>
          )}
        </div>

      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: '#9ca3af', letterSpacing: .8,
        fontWeight: 600, textTransform: 'uppercase'
      }}>{label}</div>
      {children}
    </div>
  );
}

const inp = {
  display: 'block', width: '100%', marginTop: 8,
  background: '#fff', border: '1px solid #d1d5db',
  borderRadius: 8, color: '#111827', padding: '10px 12px',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'Inter,sans-serif'
};
