// TEMPORARY diagnostic endpoint — answers one question ("does this specific
// Vercel Blob object still exist?") for a since-deleted repo branch, then
// gets removed. Not part of the app; never referenced by any component.
// See the removal commit right after this one.
import { head } from '@vercel/blob';

export default async function handler(req, res) {
  const url = req.query?.url;
  if (!url) return res.status(400).json({ error: 'url query param required' });
  try {
    const meta = await head(url, { access: 'private' });
    return res.status(200).json({ exists: true, size: meta.size, uploadedAt: meta.uploadedAt, contentType: meta.contentType });
  } catch (e) {
    return res.status(200).json({ exists: false, error: e.message, name: e.name });
  }
}
