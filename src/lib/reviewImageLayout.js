// Review Queue: image-aware layout planning (pure, no DOM).
//
// Decides, from each image's real (intrinsic) size, the space actually
// available to the review content (which already accounts for the sidebar),
// the viewport height and whether Key Points are shown:
//   - 'side'    text left, Key Points + images in a right column sized to
//               the images (never wider than they need, never upscaled);
//   - 'below'   images would have to shrink below MIN_SCALE of their real
//               size beside the text, so they go full width under it;
//   - 'stacked' narrow content area: one readable column.
// and lays the images out as an adaptive gallery: wide images get a row of
// their own, portrait/square images pair up at a shared height. Every image
// keeps its aspect ratio and is shown at most at its real size.

export const LAYOUT = {
  gap: 28,            // gutter between the text and image columns
  textMin: 480,       // narrowest reading column beside images
  textPref: 600,      // reading width the text gets first, if images can spare it
  textMax: 760,       // widest reading column (line length)
  sideMin: 260,       // narrowest image column
  sideMinWithKP: 340, // narrowest right column when it also holds Key Points
  kpBelowMin: 320,    // Key Points column width range in 'below' mode
  kpBelowMax: 420,
  stackBelow: 720,    // content width under which everything stacks
  minScale: 0.7,      // images beside the text must keep >= 70% of real size
  imgGap: 12,         // gap between images in the gallery
  maxHeightRatio: 0.78, // tallest an image may be, as a share of the viewport
  pairMinCell: 150,   // a paired image cell must be at least this wide
};

const FALLBACK = { w: 4, h: 3, unknown: true };
const WIDE_RATIO = 1.25;

export function isWide(d) { return d.w / d.h >= WIDE_RATIO; }

/** Largest width an image should get: its real width, reduced so its height fits maxH. */
export function desiredWidth(d, maxH) {
  return Math.max(1, Math.min(d.w, d.w * (maxH / d.h)));
}

function normDims(dims, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = dims && dims[i];
    out.push(d && d.w > 0 && d.h > 0 ? d : FALLBACK);
  }
  return out;
}

/**
 * Arranges images into rows within `width`. Wide images take a row each;
 * consecutive non-wide images pair up at one shared height. Never upscales.
 * Returns { rows: [{ items: [{ index, width, height, scale }] }], naturalWidth, minScale }.
 */
export function arrangeGallery(dims, width, maxH, { imgGap = LAYOUT.imgGap, pairMinCell = LAYOUT.pairMinCell } = {}) {
  const rows = [];
  let naturalWidth = 0;
  let minScale = 1;
  const push = (items) => {
    for (const it of items) minScale = Math.min(minScale, it.scale);
    rows.push({ items });
  };
  const single = (d, index) => {
    const want = desiredWidth(d, maxH);
    const w = Math.min(want, width);
    naturalWidth = Math.max(naturalWidth, want);
    push([{ index, width: Math.floor(w), height: Math.floor(w * d.h / d.w), scale: w / want }]);
  };
  for (let i = 0; i < dims.length; i++) {
    const a = dims[i];
    const b = dims[i + 1];
    const canPair = b && !isWide(a) && !isWide(b) && (width - imgGap) / 2 >= pairMinCell;
    if (!canPair) { single(a, i); continue; }
    const arA = a.w / a.h; const arB = b.w / b.h;
    const wantHA = desiredWidth(a, maxH) / arA;
    const wantHB = desiredWidth(b, maxH) / arB;
    const h0 = Math.min(wantHA, wantHB); // shared height, never above either image's own
    naturalWidth = Math.max(naturalWidth, h0 * (arA + arB) + imgGap);
    const hFit = (width - imgGap) / (arA + arB);
    const h = Math.min(h0, hFit);
    push([
      { index: i, width: Math.floor(h * arA), height: Math.floor(h), scale: (h * arA) / desiredWidth(a, maxH) },
      { index: i + 1, width: Math.floor(h * arB), height: Math.floor(h), scale: (h * arB) / desiredWidth(b, maxH) },
    ]);
    i++;
  }
  return { rows, naturalWidth: Math.ceil(naturalWidth), minScale };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {{ dims: Array<{w,h}|null>, count: number, containerWidth: number,
 *           viewportHeight: number, hasKeyPoints: boolean }} input
 * @returns {{ mode: 'side'|'below'|'stacked', textWidth: number|null,
 *             sideWidth: number|null, galleryWidth: number, gallery: object,
 *             totalWidth: number }}
 */
export function planReviewLayout({ dims, count, containerWidth, viewportHeight, hasKeyPoints }) {
  const L = LAYOUT;
  const W = Math.max(0, Math.floor(containerWidth || 0));
  const maxH = Math.max(240, Math.floor((viewportHeight || 800) * L.maxHeightRatio));
  const d = normDims(dims, count);

  if (W < L.stackBelow) {
    return { mode: 'stacked', textWidth: null, sideWidth: null, galleryWidth: W,
      gallery: arrangeGallery(d, W, maxH), totalWidth: W };
  }

  const sideMin = hasKeyPoints ? L.sideMinWithKP : L.sideMin;
  const maxSide = W - L.gap - L.textMin;
  if (maxSide >= sideMin) {
    // Image column: exactly what the images need at real size when that
    // fits; otherwise balance — give the text a comfortable width first as
    // long as the images keep >= minScale of real size, and only then
    // narrow the text (down to textMin) for the images.
    const natural = arrangeGallery(d, Number.MAX_SAFE_INTEGER, maxH).naturalWidth;
    let C;
    if (natural <= maxSide) C = Math.max(natural, sideMin);
    else C = clamp(W - L.gap - L.textPref, natural * L.minScale, maxSide);
    C = Math.floor(clamp(C, sideMin, maxSide));
    const gallery = arrangeGallery(d, C, maxH);
    if (gallery.minScale >= L.minScale) {
      const textWidth = Math.floor(Math.min(L.textMax, W - L.gap - C));
      return { mode: 'side', textWidth, sideWidth: C, galleryWidth: C, gallery,
        totalWidth: textWidth + L.gap + C };
    }
  }

  // Images too wide to sit beside the text legibly: full width below it.
  const gallery = arrangeGallery(d, W, maxH);
  let textWidth; let sideWidth = null;
  if (hasKeyPoints) {
    sideWidth = Math.floor(clamp(W * 0.3, L.kpBelowMin, L.kpBelowMax));
    textWidth = Math.floor(Math.min(L.textMax, W - L.gap - sideWidth));
  } else {
    textWidth = Math.min(L.textMax, W);
  }
  return { mode: 'below', textWidth, sideWidth, galleryWidth: W, gallery, totalWidth: W };
}
