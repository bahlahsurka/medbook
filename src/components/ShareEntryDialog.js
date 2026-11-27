// components/ShareEntryDialog.js
//
// Owner side of entry sharing: opening it creates (or reuses) the entry's
// share link — a snapshot of the entry — and offers Copy / Share. When the
// entry has changed since the snapshot, "Update shared copy" refreshes it
// (the same link then serves the new version).
import { useEffect, useRef, useState } from 'react';
import { useTheme, SPACE, RADIUS, FONT, Z } from '../lib/theme';
import { IconX, IconCheck, IconShare } from '../lib/icons';
import { buildSnapshot, getShare, createShare, updateShare, sameSnapshot, shareUrl } from '../lib/entrySharing';

export default function ShareEntryDialog({ entryId, entryTitle, userId, color, onClose }) {
  const { t } = useTheme();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [share, setShare] = useState(null);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updated, setUpdated] = useState(false);
  const inputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [existing, snapshot] = await Promise.all([getShare(entryId), buildSnapshot(entryId, color)]);
        const row = existing || await createShare(entryId, userId, snapshot);
        if (cancelled) return;
        setShare(row); setCurrent(snapshot); setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Could not create a share link.'); setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, userId, color]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const url = share ? shareUrl(share.token) : '';
  const stale = status === 'ready' && !!share && !!current && !sameSnapshot(share.snapshot, current);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inputRef.current?.select();
      try { document.execCommand('copy'); } catch { /* selection left for manual copy */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const nativeShare = async () => {
    try { await navigator.share({ title: entryTitle || 'MedBook entry', url }); } catch { /* dismissed */ }
  };

  const refresh = async () => {
    if (!share || busy) return;
    setBusy(true); setError('');
    try {
      const snapshot = await buildSnapshot(entryId, color);
      const row = await updateShare(share.token, snapshot);
      setShare(row); setCurrent(snapshot); setUpdated(true);
      setTimeout(() => setUpdated(false), 2200);
    } catch (e) {
      setError(e?.message || 'Could not update the shared copy.');
    }
    setBusy(false);
  };

  const btn = (primary) => ({
    height: 40, padding: '0 16px', borderRadius: RADIUS.md, cursor: 'pointer', whiteSpace: 'nowrap',
    fontFamily: 'Inter,sans-serif', fontSize: FONT.size.base, fontWeight: FONT.weight.semibold,
    display: 'inline-flex', alignItems: 'center', gap: 7, boxSizing: 'border-box',
    background: primary ? t.accent : t.surface2, color: primary ? '#fff' : t.text2,
    border: `1px solid ${primary ? t.accent : t.borderStrong}`,
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Share entry" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: Z.modalStack, background: t.overlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.lg, fontFamily: 'Inter,sans-serif' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: t.surface,
        border: `1px solid ${t.border}`, borderRadius: RADIUS.lg, padding: SPACE.xl, boxSizing: 'border-box',
        boxShadow: `0 16px 48px -12px ${t.shadowStrong}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: SPACE.lg }}>
          <IconShare size={16} style={{ color: t.text3, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: FONT.size.lg, fontWeight: FONT.weight.bold, color: t.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Share entry</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: t.text4,
            cursor: 'pointer', width: 32, height: 32, borderRadius: RADIUS.sm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconX size={16} />
          </button>
        </div>

        {status === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: t.text3, fontSize: FONT.size.base, padding: '8px 0' }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${t.border}`,
              borderTop: `2px solid ${t.text3}`, borderRadius: RADIUS.circle, animation: 'medbook-spin .7s linear infinite' }} />
            Creating link…
          </div>
        )}

        {status === 'error' && (
          <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: RADIUS.md,
            padding: '10px 14px', fontSize: FONT.size.base, color: t.danger }}>{error}</div>
        )}

        {status === 'ready' && (
          <>
            <input ref={inputRef} readOnly value={url} aria-label="Share link" onFocus={e => e.target.select()}
              style={{ width: '100%', boxSizing: 'border-box', height: 42, padding: '0 12px', borderRadius: RADIUS.md,
                border: `1px solid ${t.borderStrong}`, background: t.surface2, color: t.text, fontSize: FONT.size.base,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: SPACE.md, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={copy} style={btn(true)}>
                {copied ? <><IconCheck size={14} /> Copied</> : 'Copy link'}
              </button>
              {canNativeShare && <button onClick={nativeShare} style={btn(false)}><IconShare size={14} /> Share…</button>}
              {(stale || updated) && (
                <button onClick={refresh} disabled={busy || updated} style={{ ...btn(false), cursor: busy || updated ? 'default' : 'pointer' }}>
                  {updated ? <><IconCheck size={14} /> Updated</> : busy ? 'Updating…' : 'Update shared copy'}
                </button>
              )}
            </div>
            {error && <div style={{ marginTop: SPACE.md, fontSize: FONT.size.sm, color: t.danger }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
