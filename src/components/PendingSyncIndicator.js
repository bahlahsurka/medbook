// components/PendingSyncIndicator.js
//
// Instant ratings (lib/ratingOutbox.js), section 6 — "no spinner on rate.
// A tiny, non-intrusive indicator only when something is pending for a
// long time or failing... never a blocking dialog." Mounted once, app-
// wide, right alongside useRatingOutboxSync (App.js) — not per study
// screen, since a rating made in one screen can still be unsynced after
// the user has navigated elsewhere.
//
// Deliberately NOT shown the instant something is queued: an ordinary
// rating is picked up and flushed within a fraction of a second, and
// surfacing UI for that would be exactly the "spinner on rate" the brief
// says not to add. SHOW_AFTER_MS is the "pending for a long time" half of
// section 6; a flush that has actually failed at least once (`failing`)
// shows immediately regardless, since that's no longer just normal
// in-flight latency.
import { useEffect, useRef, useState } from 'react';
import { subscribePendingCount } from '../lib/ratingOutbox';
import { useTheme, SPACE, Z, elevation } from '../lib/theme';

const SHOW_AFTER_MS = 8000;

export default function PendingSyncIndicator({ userId }) {
  const { t } = useTheme();
  const [status, setStatus] = useState({ count: 0, failing: false });
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!userId) return;
    return subscribePendingCount(userId, setStatus);
  }, [userId]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (status.count === 0) { setVisible(false); return; }
    if (status.failing) { setVisible(true); return; }
    timerRef.current = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timerRef.current);
  }, [status.count, status.failing]);

  if (!visible || !status.count) return null;

  return (
    // Top-right — the two other persistent/toast-like fixed overlays
    // App.js already has (the "Update available" banner, bottom-left; the
    // dismissable toast, bottom-right) both live in the bottom corners, so
    // this uses the one corner neither can ever collide with.
    <div role="status" style={{
      position: 'fixed', top: 'max(16px, env(safe-area-inset-top, 0px))', right: SPACE.xl, zIndex: Z.toast,
      background: status.failing ? t.dangerBg : t.surface2,
      border: `1px solid ${status.failing ? t.dangerBorder : t.border}`,
      color: status.failing ? t.danger : t.text3,
      borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600,
      fontFamily: 'Inter,sans-serif', boxShadow: elevation(t, 'lg'),
      pointerEvents: 'none', maxWidth: 240,
    }}>
      {status.count} rating{status.count === 1 ? '' : 's'} not synced{status.failing ? ' — will retry' : ''}
    </div>
  );
}
