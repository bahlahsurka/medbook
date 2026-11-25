import { planReviewLayout, arrangeGallery, LAYOUT } from '../lib/reviewImageLayout';

const VH = 900; // maxH = 702
const plan = (dims, containerWidth, hasKeyPoints = false) =>
  planReviewLayout({ dims, count: dims.length, containerWidth, viewportHeight: VH, hasKeyPoints });
const items = (p) => p.gallery.rows.flatMap(r => r.items);
const ratioOk = (it, d) => Math.abs(it.width / it.height - d.w / d.h) < 0.02;

describe('planReviewLayout', () => {
  test('a table that fits gets exactly its real width beside the text', () => {
    const d = [{ w: 820, h: 520 }];
    const p = plan(d, 1480);
    expect(p.mode).toBe('side');
    expect(p.sideWidth).toBe(820); // exactly what the image needs, no more
    const [it] = items(p);
    expect(it.width).toBe(820);
    expect(ratioOk(it, d[0])).toBe(true);
    expect(p.textWidth).toBeLessThanOrEqual(LAYOUT.textMax);
  });

  test('a large table balances: text keeps a comfortable width while the image stays >= 70%', () => {
    const d = [{ w: 1100, h: 620 }];
    const p = plan(d, 1495);
    expect(p.mode).toBe('side');
    expect(p.textWidth).toBe(LAYOUT.textPref);
    expect(items(p)[0].width / 1100).toBeGreaterThanOrEqual(LAYOUT.minScale);
  });

  test('the same table moves below the text when the sidebar leaves too little room', () => {
    const d = [{ w: 1400, h: 700 }];
    const p = plan(d, 1100);
    expect(p.mode).toBe('below');
    const [it] = items(p);
    expect(it.width).toBe(1100); // full width, still not upscaled past 1400
    expect(ratioOk(it, d[0])).toBe(true);
  });

  test('small images are never enlarged; the image column shrinks and text gets the room', () => {
    const d = [{ w: 220, h: 180 }];
    const p = plan(d, 1480);
    expect(p.mode).toBe('side');
    expect(items(p)[0].width).toBe(220);
    expect(p.sideWidth).toBe(LAYOUT.sideMin);
    expect(p.textWidth).toBe(LAYOUT.textMax);
  });

  test('tall diagrams are limited by the viewport height, keeping their proportions', () => {
    const d = [{ w: 900, h: 2400 }];
    const p = plan(d, 1480);
    const [it] = items(p);
    expect(it.height).toBeLessThanOrEqual(Math.floor(VH * LAYOUT.maxHeightRatio));
    expect(ratioOk(it, d[0])).toBe(true);
    expect(p.mode).toBe('side');
  });

  test('narrow content areas stack in one column', () => {
    const p = plan([{ w: 1200, h: 800 }], 600, true);
    expect(p.mode).toBe('stacked');
    expect(items(p)[0].width).toBeLessThanOrEqual(600);
  });

  test('Key Points widen the right column minimum', () => {
    const p = plan([{ w: 200, h: 200 }], 1480, true);
    expect(p.sideWidth).toBe(LAYOUT.sideMinWithKP);
  });

  test('in "below" mode with Key Points, Key Points keep a right column', () => {
    const p = plan([{ w: 2400, h: 900 }], 1200, true);
    expect(p.mode).toBe('below');
    expect(p.sideWidth).toBeGreaterThanOrEqual(LAYOUT.kpBelowMin);
    expect(p.textWidth + LAYOUT.gap + p.sideWidth).toBeLessThanOrEqual(1200);
  });

  test('unknown dimensions fall back safely', () => {
    const p = plan([null, undefined], 1400);
    expect(['side', 'below']).toContain(p.mode);
    expect(items(p)).toHaveLength(2);
  });
});

describe('arrangeGallery', () => {
  test('wide images get their own row; portrait/square images pair at one shared height', () => {
    const d = [{ w: 1200, h: 600 }, { w: 600, h: 900 }, { w: 700, h: 700 }, { w: 500, h: 800 }];
    const g = arrangeGallery(d, 900, 700);
    expect(g.rows.map(r => r.items.length)).toEqual([1, 2, 1]);
    const [a, b] = g.rows[1].items;
    expect(a.height).toBe(b.height);
    expect(a.width + b.width + LAYOUT.imgGap).toBeLessThanOrEqual(900);
    g.rows.flatMap(r => r.items).forEach(it => expect(ratioOk(it, d[it.index])).toBe(true));
  });

  test('never upscales any image', () => {
    const d = [{ w: 300, h: 400 }, { w: 320, h: 420 }, { w: 400, h: 200 }];
    const g = arrangeGallery(d, 1600, 900);
    g.rows.flatMap(r => r.items).forEach(it => expect(it.width).toBeLessThanOrEqual(d[it.index].w));
    expect(g.minScale).toBeLessThanOrEqual(1);
  });

  test('does not pair when the cells would be too narrow', () => {
    const g = arrangeGallery([{ w: 400, h: 600 }, { w: 400, h: 600 }], 280, 700);
    expect(g.rows.map(r => r.items.length)).toEqual([1, 1]);
  });
});
