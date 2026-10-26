// Regression/coverage test for the entry-image upload performance fix:
// AddEntry.js/DetailView.js used to upload a photo at its original,
// full-device-camera resolution (often several MB), which then got
// reused everywhere that entry's images are displayed — including a
// 96x64px list thumbnail and a 100x76px edit-mode thumbnail — downloading
// and decoding the full original just to paint a few thousand pixels,
// repeated per entry in a scrollable list.
//
// compressImage() downscales/re-encodes via canvas before upload. These
// tests mock createImageBitmap/canvas (jsdom has no real image decoding)
// to exercise the DECISION logic — skip small files, skip GIFs, resize
// oversized ones, and never let a failure anywhere in the pipeline throw
// or lose the image — rather than pixel-level image output, which isn't
// meaningfully testable without a real browser's canvas.
import { compressImage } from '../lib/imageCompress';

function fakeFile({ name = 'photo.jpg', type = 'image/jpeg', size = 1024 }) {
  const file = new File([new Uint8Array(size)], name, { type });
  // jsdom's File doesn't always report .size from content reliably across
  // versions — set it explicitly so the "skip under threshold" branch is
  // exercised deterministically regardless of that.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function mockBitmap(width, height) {
  global.createImageBitmap = jest.fn(() => Promise.resolve({ width, height, close: jest.fn() }));
}

function mockCanvasToBlob(resultSize) {
  const ctx = { drawImage: jest.fn() };
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
  HTMLCanvasElement.prototype.toBlob = jest.fn(function (cb) {
    cb(resultSize == null ? null : new Blob([new Uint8Array(resultSize)], { type: 'image/jpeg' }));
  });
  return ctx;
}

const realCreateImageBitmap = global.createImageBitmap;
afterEach(() => {
  global.createImageBitmap = realCreateImageBitmap;
  jest.restoreAllMocks();
});

test('a small file is returned untouched — not worth re-encoding', async () => {
  const file = fakeFile({ size: 50 * 1024 }); // 50KB, under the 300KB floor
  const result = await compressImage(file);
  expect(result).toBe(file);
});

test('a GIF is returned untouched — re-encoding would collapse its animation', async () => {
  const file = fakeFile({ type: 'image/gif', name: 'anim.gif', size: 2 * 1024 * 1024 });
  const result = await compressImage(file);
  expect(result).toBe(file);
});

test('an oversized photo is downscaled to the max dimension and re-encoded smaller', async () => {
  mockBitmap(4032, 3024); // typical phone-camera resolution
  mockCanvasToBlob(400 * 1024); // "compressed" result, smaller than original
  const file = fakeFile({ size: 4 * 1024 * 1024 }); // 4MB original

  const result = await compressImage(file, { maxDimension: 1600 });

  expect(result).not.toBe(file);
  expect(result.type).toBe('image/jpeg');
  expect(result.size).toBeLessThan(file.size);
  // Canvas was sized down to fit within maxDimension on the long edge,
  // preserving aspect ratio (4032x3024 -> 1600x1200).
  const canvasEl = HTMLCanvasElement.prototype.getContext.mock.instances[0];
  expect(canvasEl.width).toBe(1600);
  expect(canvasEl.height).toBe(1200);
});

test('falls back to the original file if the "compressed" result is not actually smaller', async () => {
  mockBitmap(4032, 3024);
  mockCanvasToBlob(10 * 1024 * 1024); // larger than the original — a bad trade
  const file = fakeFile({ size: 4 * 1024 * 1024 });

  const result = await compressImage(file);
  expect(result).toBe(file);
});

test('falls back to the original file if canvas/decode fails for any reason — never throws', async () => {
  global.createImageBitmap = jest.fn(() => Promise.reject(new Error('decode failed')));
  const file = fakeFile({ size: 4 * 1024 * 1024 });

  await expect(compressImage(file)).resolves.toBe(file);
});

test('a large unoptimized PNG still gets re-encoded even when already within the dimension bound', async () => {
  mockBitmap(1200, 800); // already under maxDimension
  mockCanvasToBlob(500 * 1024);
  const file = fakeFile({ type: 'image/png', name: 'screenshot.png', size: 3 * 1024 * 1024 });

  const result = await compressImage(file, { maxDimension: 1600 });
  expect(result).not.toBe(file);
  expect(result.size).toBeLessThan(file.size);
});
