// lib/imageCompress.js
//
// Downscales/compresses an entry image client-side BEFORE it's uploaded,
// via a plain <canvas> — no new dependency. A phone photo can easily be
// 3-5MB at 3000-4000px wide; that same file is what AddEntry.js/
// DetailView.js previously uploaded verbatim and then reused EVERYWHERE
// it's displayed, including a 96x64px list thumbnail (EntryCard.js) and a
// 100x76px edit-mode thumbnail (DetailView.js) — downloading and decoding
// the full original just to paint a few thousand pixels, repeated per
// entry in a scrollable list. Slow initial loads, scroll jank as images
// decode, and heavy mobile data usage, exactly where it's most felt.
//
// The one place a FULL-SIZE view of the image still matters is the
// lightbox (tap to expand) — so this doesn't shrink to thumbnail size,
// just to a sane upper bound that still looks sharp zoomed in on a phone
// screen while cutting a multi-megabyte original down dramatically.
//
// Deliberately conservative about when it's safe to skip or fall back to
// the original file untouched — an upload must never fail, or silently
// corrupt, because this optimization had a problem:
//   - Already-small files (under SKIP_UNDER_BYTES) aren't worth re-encoding.
//   - GIFs are skipped — re-encoding through canvas/toBlob would collapse
//     an animated GIF to its first frame.
//   - Any failure anywhere in the pipeline (decode error, canvas/toBlob
//     unsupported, the "compressed" result somehow not actually smaller)
//     resolves with the ORIGINAL file, never throws.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
const SKIP_UNDER_BYTES = 300 * 1024; // 300KB — not worth re-encoding

export async function compressImage(file, {
  maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY,
} = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    if (scale >= 1) {
      // Already within bounds — only worth re-encoding if that alone
      // would still shrink it meaningfully (e.g. an unoptimized PNG
      // screenshot); otherwise not worth the CPU/quality cost.
      if (file.type === 'image/png' && file.size > SKIP_UNDER_BYTES * 4) {
        return await encode(bitmap, width, height, file, quality);
      }
      closeBitmap(bitmap);
      return file;
    }

    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    return await encode(bitmap, targetW, targetH, file, quality);
  } catch {
    // Decode/canvas failure of any kind — upload the original rather than
    // blocking the save or losing the image.
    return file;
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  // Safari-era fallback: an <img> + its natural dimensions, close() is a no-op.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve; img.onerror = reject; img.src = url;
    });
    img.width = img.naturalWidth; img.height = img.naturalHeight;
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeBitmap(bitmap) { bitmap.close?.(); }

async function encode(bitmap, targetW, targetH, originalFile, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) { closeBitmap(bitmap); return originalFile; }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  closeBitmap(bitmap);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= originalFile.size) return originalFile; // no real win — keep the original
  const name = originalFile.name.replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
