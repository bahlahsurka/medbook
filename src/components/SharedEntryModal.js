// components/SharedEntryModal.js
//
// Recipient side of entry sharing: opened from a /s/<token> link once the
// user is signed in. Shows the shared entry and saves an independent copy
// into the user's own account (lib/entrySharing.js#saveSharedCopy). A link to
// the user's own entry just opens that entry instead (handled by the parent
// through onOpenOwn).
import { useEffect, useRef, useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../lib/theme';
import { IconX } from '../lib/icons';
import { SYS_COLOR } from '../lib/constants';
import { fetchSharedEntry, saveSharedCopy } from '../lib/entrySharing';
import { RenderedNotes } from './DetailView';

export default function SharedEntryModal({ token, userId, userSystems, onClose, onOpenOwn, onSaved }) {
  const { t } = useTheme();
  const [status, setStatus] = useState('loading'); // loading | missing | ready | error
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const cbRef = useRef({ onClose, onOpenOwn });
  cbRef.current = { onClose, onOpenOwn };

  useEffect(() => {
    let cancelled = false;
    fetchSharedEntry(token).then(data => {
      if (cancelled) return;
      if (!data) { setStatus('missing'); return; }
      if (data.isOwner) { cbRef.current.onOpenOwn(data.entryId); return; }
      setSnapshot(data.snapshot); setStatus('ready');
    }, e => {
      if (cancelled) return;
      setError(e?.message || 'Could not open this link.'); setStatus('error');
    });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || savingRef.current) return;
      e.stopPropagation(); cbRef.current.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const result = await saveSharedCopy(snapshot, userId, userSystems);
      onSaved(result);
    } catch (e) {
      setError(e?.message || 'Could not save this entry.');
      savingRef.current = false; setSaving(false);
    }
  };

  const color = snapshot?.systemColor || SYS_COLOR[snapshot?.system] || t.accent;
  const images = Array.isArray(snapshot?.images) ? snapshot.images : [];
  const close = () => { if (!savingRef.current) onClose(); };

  return (
    <div role="dialog" aria-modal="true" aria-label="Shared entry" onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: Z.modalStack, background: t.overlay, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: SPACE.lg, fontFamily: 'Inter,sans-serif' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: 'calc(100vh - 32px)',
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, boxSizing: 'border-box',
        boxShadow: `0 16px 48px -12px ${t.shadowStrong}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: `${SPACE.md}px ${SPACE.md}px 0` }}>
          <button onClick={close} aria-label="Close" style={{ background: 'none', border: 'none', color: t.text4, cursor: 'pointer',
            width: 32, height: 32, borderRadius: RADIUS.sm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `0 ${SPACE.xl}px ${SPACE.lg}px` }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: t.text3,
              fontSize: FONT.size.base, padding: '32px 0' }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${t.border}`,
                borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
              Opening…
            </div>
          )}
          {status === 'missing' && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: t.text2, fontSize: FONT.size.md }}>
              This link isn't available.
            </div>
          )}
          {status === 'error' && (
            <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: RADIUS.md,
              padding: '10px 14px', fontSize: FONT.size.base, color: t.danger, margin: '16px 0' }}>{error}</div>
          )}
          {status === 'ready' && snapshot && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: SPACE.sm }}>
                <span style={{ width: 8, height: 8, borderRadius: RADIUS.circle, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: FONT.size.xs, fontWeight: FONT.weight.bold, letterSpacing: .6,
                  textTransform: 'uppercase', color }}>{snapshot.system}</span>
              </div>
              <div style={{ fontSize: FONT.size.xl2, fontWeight: FONT.weight.bold, color: t.text, lineHeight: 1.3,
                marginBottom: SPACE.lg, overflowWrap: 'anywhere' }}>{snapshot.title}</div>
              {snapshot.notes && (
                <div style={{ fontSize: FONT.size.md, color: t.text2, lineHeight: 1.75, marginBottom: SPACE.lg }}>
                  <RenderedNotes text={snapshot.notes} highlights={Array.isArray(snapshot.highlights) ? snapshot.highlights : []} />
                </div>
              )}
              {images.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                  {images.map((src, i) => (
                    <img key={i} src={src} alt="" loading="lazy" style={{ width: '100%', height: 120, objectFit: 'cover',
                      borderRadius: RADIUS.md, border: `1px solid ${t.border}`, background: t.surface2 }} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {status === 'ready' && (
          <div style={{ borderTop: `1px solid ${t.border}`, padding: `${SPACE.md}px ${SPACE.xl}px`, display: 'flex',
            alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {error && <span style={{ flex: 1, minWidth: 180, fontSize: FONT.size.sm, color: t.danger }}>{error}</span>}
            <button onClick={close} disabled={saving} style={{ height: 40, padding: '0 16px', borderRadius: RADIUS.md,
              background: t.surface2, border: `1px solid ${t.borderStrong}`, color: t.text2, cursor: saving ? 'default' : 'pointer',
              fontFamily: 'Inter,sans-serif', fontSize: FONT.size.base, fontWeight: FONT.weight.semibold }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ height: 40, padding: '0 18px', borderRadius: RADIUS.md,
              background: saving ? t.surface3 : t.accent, border: `1px solid ${saving ? t.border : t.accent}`,
              color: saving ? t.text3 : '#fff', cursor: saving ? 'default' : 'pointer',
              fontFamily: 'Inter,sans-serif', fontSize: FONT.size.base, fontWeight: FONT.weight.semibold }}>
              {saving ? 'Saving…' : 'Save to my MedBook'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
