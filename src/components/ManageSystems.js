import { useState } from 'react';
import { SYS_COLOR } from '../lib/constants';

const PRESET_COLORS = [
  '#2563eb','#dc2626','#16a34a','#d97706','#7c3aed',
  '#db2777','#0891b2','#ea580c','#15803d','#be123c',
  '#0369a1','#92400e','#4338ca','#0f766e','#374151','#6d28d9'
];

export default function ManageSystems({ systems, onSave, onClose }) {
  const [list, setList]       = useState(systems.map(s => ({ ...s })));
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#2563eb');
  const [editIdx, setEditIdx] = useState(null);
  const [editName, setEditName] = useState('');
  const [err, setErr]         = useState('');

  const addSystem = () => {
    const name = newName.trim();
    if (!name) { setErr('Enter a system name'); return; }
    if (list.find(s => s.name.toLowerCase() === name.toLowerCase())) {
      setErr('System already exists'); return;
    }
    setList(p => [...p, { name, color: newColor, custom: true }]);
    setNewName('');
    setNewColor('#2563eb');
    setErr('');
  };

  const removeSystem = (idx) => {
    if (!window.confirm(`Remove "${list[idx].name}"? Entries in this system won't be deleted.`)) return;
    setList(p => p.filter((_, i) => i !== idx));
  };

  const startEdit = (idx) => {
    setEditIdx(idx);
    setEditName(list[idx].name);
  };

  const saveEdit = (idx) => {
    const name = editName.trim();
    if (!name) return;
    if (list.find((s, i) => i !== idx && s.name.toLowerCase() === name.toLowerCase())) {
      setErr('Name already taken'); return;
    }
    setList(p => p.map((s, i) => i === idx ? { ...s, name } : s));
    setEditIdx(null);
    setErr('');
  };

  const changeColor = (idx, color) => {
    setList(p => p.map((s, i) => i === idx ? { ...s, color } : s));
  };

  const moveUp = (idx) => {
    if (idx === 0) return;
    setList(p => { const a = [...p]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; return a; });
  };

  const moveDown = (idx) => {
    if (idx === list.length - 1) return;
    setList(p => { const a = [...p]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; return a; });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)'
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Manage Systems</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Add, rename, reorder or remove systems
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 20, color: '#9ca3af', cursor: 'pointer'
          }}>✕</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }}>
          {list.map((sys, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8, marginBottom: 4,
              background: '#f9fafb', border: '1px solid #e5e7eb'
            }}>
              {/* Color dot / picker */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: sys.color, cursor: 'pointer', border: '1px solid #e5e7eb'
                }} />
                <input type="color" value={sys.color}
                  onChange={e => changeColor(idx, e.target.value)}
                  style={{
                    position: 'absolute', opacity: 0, inset: 0,
                    width: '100%', height: '100%', cursor: 'pointer'
                  }} />
              </div>

              {/* Name / edit */}
              {editIdx === idx ? (
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(idx); if (e.key === 'Escape') setEditIdx(null); }}
                  autoFocus
                  style={{
                    flex: 1, border: '1px solid #2563eb', borderRadius: 6,
                    padding: '4px 8px', fontSize: 13, outline: 'none', color: '#111827'
                  }} />
              ) : (
                <span style={{ flex: 1, fontSize: 13, color: '#111827', fontWeight: 500 }}>
                  {sys.name}
                  {sys.custom && (
                    <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 6,
                      background: '#f3f4f6', borderRadius: 4, padding: '1px 5px' }}>custom</span>
                  )}
                </span>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {editIdx === idx ? (
                  <>
                    <Btn onClick={() => saveEdit(idx)} color="#16a34a">✓</Btn>
                    <Btn onClick={() => setEditIdx(null)} color="#6b7280">✕</Btn>
                  </>
                ) : (
                  <>
                    <Btn onClick={() => moveUp(idx)} color="#6b7280" disabled={idx === 0}>↑</Btn>
                    <Btn onClick={() => moveDown(idx)} color="#6b7280" disabled={idx === list.length - 1}>↓</Btn>
                    <Btn onClick={() => startEdit(idx)} color="#2563eb">✎</Btn>
                    <Btn onClick={() => removeSystem(idx)} color="#dc2626">🗑</Btn>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add new */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
          {err && (
            <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{err}</div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Color picker for new */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, background: newColor,
                border: '1px solid #e5e7eb', cursor: 'pointer'
              }} />
              <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer' }} />
            </div>
            <input value={newName} onChange={e => { setNewName(e.target.value); setErr(''); }}
              onKeyDown={e => e.key === 'Enter' && addSystem()}
              placeholder="New system name…"
              style={{
                flex: 1, border: '1px solid #d1d5db', borderRadius: 8,
                padding: '8px 12px', fontSize: 13, outline: 'none', color: '#111827'
              }} />
            <button onClick={addSystem} style={{
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 16px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', flexShrink: 0
            }}>+ Add</button>
          </div>

          {/* Preset colors */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {PRESET_COLORS.map(c => (
              <div key={c} onClick={() => setNewColor(c)} style={{
                width: 18, height: 18, borderRadius: '50%', background: c,
                cursor: 'pointer', border: newColor === c ? '2px solid #111827' : '1px solid #e5e7eb',
                flexShrink: 0
              }} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #e5e7eb',
          display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={() => onSave(list)} style={{
            flex: 1, background: '#2563eb', color: '#fff', border: 'none',
            borderRadius: 8, padding: '11px', fontSize: 14, fontWeight: 600, cursor: 'pointer'
          }}>Save Changes</button>
          <button onClick={onClose} style={{
            background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
            borderRadius: 8, padding: '11px 20px', fontSize: 14, cursor: 'pointer'
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, color, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: `${color}12`, color, border: `1px solid ${color}30`,
      borderRadius: 6, padding: '4px 8px', fontSize: 12,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1, fontWeight: 600
    }}>{children}</button>
  );
}
