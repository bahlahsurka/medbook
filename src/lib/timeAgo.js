// Shared relative-time formatter (Dashboard's "studied Xd ago" and, as of
// batch 4, Sidebar's compact recently-studied captions use the same one).
export function timeAgo(date) {
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
}
