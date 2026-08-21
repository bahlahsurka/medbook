// components/ImportedDecks/ImportWizard.js
//
// Phases H1 (entry point) → H2 (upload) → H3 (options) → H4 (progress) →
// H5 (failure UX). One state machine, one modal, matching the visual
// language of DeckBrowser's own Modal.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../lib/theme';
import * as api from '../../lib/importedDecks/api';
import { uploadApkg, createImportJob, startProcessing } from '../../lib/importedDecks/upload';

// job.status -> human label (Phase H4's required state names). 'uploading'
// is a front-end-only step before any import_jobs row exists yet.
const STAGE_LABEL = {
  uploading: 'Uploading',
  pending: 'Processing',
  processing_metadata: 'Processing',
  importing_cards: 'Importing cards',
  importing_media: 'Importing media',
  verifying: 'Finalizing',
  completed: 'Complete',
  failed: 'Failed',
};

const POLL_MS = 3000;

export default function ImportWizard({ userId, onClose, onImported }) {
  const { t } = useTheme();
  // step: 'pick' | 'options' | 'uploading' | 'processing' | 'failed' | 'complete'
  const [step, setStep] = useState('pick');
  const [file, setFile] = useState(null);
  const [importMedia, setImportMedia] = useState(true);
  const [progressPct, setProgressPct] = useState(0);
  const [job, setJob] = useState(null);
  const [err, setErr] = useState('');
  const abortRef = useRef(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  // Phase H4: recover an active job on mount rather than resetting the UI —
  // covers refresh/navigation during an active import.
  useEffect(() => {
    let cancelled = false;
    api.getActiveImportJob(userId).then(active => {
      if (cancelled || !active) return;
      setJob(active);
      setStep(active.status === 'failed' ? 'failed' : 'processing');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const stopPolling = useCallback(() => { clearInterval(pollRef.current); pollRef.current = null; }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (step !== 'processing' || !job?.id) return;
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const result = await api.getImportJob(job.id);
        setJob(result);
        if (result.status === 'completed') { stopPolling(); setStep('complete'); onImported?.(); }
        else if (result.status === 'failed') { stopPolling(); setStep('failed'); }
      } catch { /* transient network hiccup — next tick retries */ }
    }, POLL_MS);
    return stopPolling;
  }, [step, job?.id, stopPolling, onImported]);

  const pickFile = (f) => {
    if (!f) return;
    if (!/\.apkg$/i.test(f.name)) { setErr('Please choose a .apkg file exported from Anki.'); return; }
    setFile(f); setErr(''); setStep('options');
  };

  const startUpload = async () => {
    setStep('uploading'); setErr(''); setProgressPct(0);
    abortRef.current = new AbortController();
    try {
      const blob = await uploadApkg(file, {
        onProgress: ({ percentage }) => setProgressPct(Math.round(percentage)),
        signal: abortRef.current.signal,
      });
      const created = await createImportJob({ userId, blobUrl: blob.url, importMedia });
      setJob(created);
      setStep('processing');
      startProcessing(created.id);
    } catch (e) {
      if (e.cancelled) { setStep('options'); return; }
      setErr(e.message || 'Upload failed'); setStep('failed');
    }
  };

  const cancelUpload = () => abortRef.current?.abort();

  const retry = async () => {
    if (!job?.id) { setStep('pick'); return; }
    setErr('');
    try {
      await startProcessing(job.id);
      setStep('processing');
    } catch (e) { setErr(e.message || 'Retry failed'); }
  };

  const B = (bg, color = '#fff') => ({ background: bg, color, border: 'none', borderRadius: 8,
    padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif' });

  return (
    <div onClick={step === 'pick' ? onClose : undefined} style={{ position: 'fixed', inset: 0,
      background: t.overlay, zIndex: 300, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surface, borderRadius: 16,
        padding: 28, maxWidth: 460, width: '100%', boxShadow: `0 8px 32px ${t.shadowStrong}`,
        fontFamily: 'Inter,sans-serif', maxHeight: '90vh', overflowY: 'auto' }}>

        {step === 'pick' && <PickStep t={t} B={B} err={err} onClose={onClose}
          fileInputRef={fileInputRef} onPick={pickFile} />}

        {step === 'options' && <OptionsStep t={t} B={B} file={file}
          importMedia={importMedia} setImportMedia={setImportMedia}
          onBack={() => setStep('pick')} onStart={startUpload} />}

        {step === 'uploading' && <UploadingStep t={t} B={B} file={file}
          pct={progressPct} onCancel={cancelUpload} />}

        {step === 'processing' && <ProcessingStep t={t} job={job} onClose={onClose} />}

        {step === 'failed' && <FailedStep t={t} B={B} job={job} err={err}
          onRetry={retry} onClose={onClose} />}

        {step === 'complete' && <CompleteStep t={t} B={B} job={job} onClose={onClose} />}
      </div>
    </div>
  );
}

/* ── Phase H1 — entry point, tablet-friendly file selection ────────── */
function PickStep({ t, B, err, onClose, fileInputRef, onPick }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <>
      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 6 }}>Import Anki Deck</div>
      <div style={{ fontSize: 13, color: t.text3, marginBottom: 18 }}>
        Choose a .apkg file exported from Anki.
      </div>

      {/* Large tap target — works from a tablet's native file picker (Files /
          Photos-style sheet), not a desktop-only drag-and-drop-only widget. */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); onPick(e.dataTransfer.files?.[0]); }}
        style={{ border: `2px dashed ${dragOver ? t.accent : t.borderStrong}`, borderRadius: 12,
          padding: '40px 20px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? t.navActiveBg : t.surface2, marginBottom: 16,
          transition: 'all .15s' }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>📥</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 4 }}>
          Tap to choose a .apkg file
        </div>
        <div style={{ fontSize: 12, color: t.text4 }}>or drag one here</div>
      </div>
      <input ref={fileInputRef} type="file" accept=".apkg" style={{ display: 'none' }}
        onChange={e => onPick(e.target.files?.[0])} />

      {err && <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 14 }}>{err}</div>}

      <button onClick={onClose} style={{ ...B(t.surface3, t.text2), width: '100%' }}>Cancel</button>
    </>
  );
}

/* ── Phase H3 — import options ───────────────────────────────────────── */
function OptionsStep({ t, B, file, importMedia, setImportMedia, onBack, onStart }) {
  const row = (label, checked, onChange, note, locked) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
      borderBottom: `1px solid ${t.border}` }}>
      <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, flexShrink: 0,
        marginTop: 1, opacity: locked ? 0.6 : 1 }}>
        <input type="checkbox" checked={checked} disabled={locked}
          onChange={e => onChange?.(e.target.checked)}
          style={{ opacity: 0, width: '100%', height: '100%', position: 'absolute', margin: 0,
            cursor: locked ? 'default' : 'pointer' }} />
        <span style={{ position: 'absolute', inset: 0, borderRadius: 22,
          background: checked ? t.accent : t.surface3, transition: 'background .15s' }} />
        <span style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
      </label>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{label}</div>
        {note && <div style={{ fontSize: 11.5, color: t.text4, marginTop: 2, lineHeight: 1.5 }}>{note}</div>}
      </div>
    </div>
  );

  return (
    <>
      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 4 }}>Import Options</div>
      <div style={{ fontSize: 12.5, color: t.text4, marginBottom: 16, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file?.name} · {file ? (file.size / 1024 / 1024).toFixed(1) : '0'} MB
      </div>

      {row('Import media', importMedia, setImportMedia,
        'Images and audio referenced by cards. Turning this off imports notes/cards only, much faster for a quick preview.')}
      {row('Preserve hierarchy', true, null,
        'Always on — the importer preserves your Anki deck structure.', true)}
      {row('Preserve tags', true, null,
        'Always on — every note keeps its original Anki tags.', true)}
      {row('Import scheduling history', false, null,
        'Not supported — a shared/imported deck always starts fresh rather than inheriting someone else’s review intervals.', true)}

      <div style={{ fontSize: 12, color: t.text4, lineHeight: 1.6, margin: '16px 0' }}>
        The original .apkg is temporary — it's automatically deleted once the import is verified.
        If the import fails, it's kept so you don't have to re-upload.
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onStart} style={B(t.accent)}>Start Import</button>
        <button onClick={onBack} style={B(t.surface3, t.text2)}>Back</button>
      </div>
    </>
  );
}

/* ── Phase H2 — upload progress ──────────────────────────────────────── */
function UploadingStep({ t, B, file, pct, onCancel }) {
  return (
    <>
      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 4 }}>Uploading…</div>
      <div style={{ fontSize: 12.5, color: t.text4, marginBottom: 20 }}>{file?.name}</div>
      <div style={{ height: 8, background: t.surface3, borderRadius: 6, marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: t.accent, borderRadius: 6,
          width: `${pct}%`, transition: 'width .2s' }} />
      </div>
      <div style={{ fontSize: 13, color: t.text3, marginBottom: 20 }}>{pct}%</div>
      <button onClick={onCancel} style={{ ...B(t.surface3, t.text2), width: '100%' }}>Cancel Upload</button>
    </>
  );
}

/* ── Phase H4 — real processing progress, real counts, no fake % ───────── */
function ProcessingStep({ t, job, onClose }) {
  const stage = STAGE_LABEL[job?.status] || 'Processing';
  const notesLine = job?.total_notes
    ? `${(job.imported_notes || 0).toLocaleString()} / ${job.total_notes.toLocaleString()}` : null;
  const mediaLine = job?.total_media
    ? `${(job.imported_media || 0).toLocaleString()} / ${job.total_media.toLocaleString()}` : null;

  return (
    <>
      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 4 }}>Importing Deck</div>
      <div style={{ fontSize: 13, color: t.accent, fontWeight: 600, marginBottom: 18 }}>{stage}…</div>

      {job?.status === 'importing_cards' && notesLine && (
        <ProgressLine t={t} label="Importing cards" value={notesLine} />
      )}
      {job?.status === 'importing_media' && mediaLine && (
        <ProgressLine t={t} label="Importing media" value={mediaLine} />
      )}
      {!['importing_cards', 'importing_media'].includes(job?.status) && (
        <div style={{ fontSize: 12.5, color: t.text4, marginBottom: 16 }}>
          Working — this can take a few minutes for a large deck.
        </div>
      )}

      <div style={{ fontSize: 11.5, color: t.text4, lineHeight: 1.6, marginBottom: 18 }}>
        You can safely close this and come back — the import keeps running, and reopening
        Import will pick up right where it left off.
      </div>

      <button onClick={onClose} style={{ background: t.surface3, color: t.text2, border: 'none',
        borderRadius: 8, padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        fontFamily: 'Inter,sans-serif', width: '100%' }}>
        Close (keep importing in background)
      </button>
    </>
  );
}

function ProgressLine({ t, label, value }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, color: t.text3, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: t.text }}>{value}</div>
    </div>
  );
}

/* ── Phase H5 — failure UX ───────────────────────────────────────────── */
function FailedStep({ t, B, job, err, onRetry, onClose }) {
  // Human-readable only — the raw error_detail.stack is intentionally
  // never rendered here (dev builds can still see it in Vercel logs).
  const message = err || job?.error_message || 'The import could not be completed.';
  const canRetry = !!job?.id;
  return (
    <>
      <div style={{ fontSize: 34, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 6 }}>Import Failed</div>
      {job?.status && (
        <div style={{ fontSize: 12, color: t.text4, marginBottom: 12 }}>
          Stopped at: {STAGE_LABEL[job.status] || job.status}
        </div>
      )}
      <div style={{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}`, borderRadius: 8,
        padding: '10px 14px', fontSize: 13, color: t.danger, marginBottom: 18, lineHeight: 1.6 }}>
        {message}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {canRetry && <button onClick={onRetry} style={B(t.accent)}>Retry</button>}
        <button onClick={onClose} style={B(t.surface3, t.text2)}>← Imported Decks</button>
      </div>
    </>
  );
}

/* ── Complete ─────────────────────────────────────────────────────────── */
function CompleteStep({ t, B, job, onClose }) {
  return (
    <>
      <div style={{ fontSize: 40, marginBottom: 12, textAlign: 'center' }}>✅</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 6, textAlign: 'center' }}>
        Import Complete
      </div>
      <div style={{ fontSize: 13, color: t.text3, marginBottom: 20, textAlign: 'center' }}>
        {job?.imported_notes ? `${job.imported_notes.toLocaleString()} notes imported. ` : ''}
        The original .apkg has been deleted.
      </div>
      <button onClick={onClose} style={{ ...B(t.accent), width: '100%' }}>Go to Imported Decks</button>
    </>
  );
}
