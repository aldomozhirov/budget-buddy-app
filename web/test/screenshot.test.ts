import { describe, expect, it, vi } from 'vitest';
import { feedbackScreenshotMaxBytes } from '@budget-buddy/shared';
import {
  encodeScreenshot,
  type ScreenshotCanvas,
  type ScreenshotTools,
} from '../src/screens/settings/screenshot.js';

/** The screenshot helper of a report (spec 8, O3), over a canvas stub. */

function tools(
  size: { width: number; height: number },
  sizeAt: (quality: number) => number,
  data = new Uint8Array([1, 2, 3, 250, 251]),
) {
  const qualities: number[] = [];
  const made: ScreenshotCanvas[] = [];
  const close = vi.fn();
  const drawn: number[][] = [];
  const stub: ScreenshotTools = {
    decode: async () => ({ ...size, close }) as unknown as ImageBitmap,
    canvas(width, height) {
      const canvas: ScreenshotCanvas = {
        width,
        height,
        getContext: () =>
          ({
            fillStyle: '',
            fillRect: () => undefined,
            drawImage: (_b: unknown, ...args: number[]) =>
              void drawn.push(args),
          }) as never,
        toBlob(done, type, quality) {
          qualities.push(quality);
          expect(type).toBe('image/jpeg');
          const n = sizeAt(quality);
          const bytes = new Uint8Array(n);
          bytes.set(data.subarray(0, Math.min(n, data.length)));
          done(new Blob([bytes], { type }));
        },
      };
      made.push(canvas);
      return canvas;
    },
  };
  return { stub, qualities, made, close, drawn };
}

const small = () => 5;

describe('encodeScreenshot', () => {
  it('scales a 4000x3000 picture to 2048x1536', async () => {
    const t = tools({ width: 4000, height: 3000 }, small);
    await encodeScreenshot(new Blob(['x']), t.stub);
    expect(t.drawn[0]).toEqual([0, 0, 2048, 1536]);
    expect(t.made[0]!.width).toBe(0); // released after use
  });

  it('scales a tall picture by its height', async () => {
    const t = tools({ width: 3000, height: 6000 }, small);
    await encodeScreenshot(new Blob(['x']), t.stub);
    expect(t.drawn[0]).toEqual([0, 0, 1024, 2048]);
  });

  it('does not enlarge a small picture', async () => {
    const t = tools({ width: 390, height: 844 }, small);
    await encodeScreenshot(new Blob(['x']), t.stub);
    expect(t.drawn[0]).toEqual([0, 0, 390, 844]);
  });

  it('returns a JPEG whose base64 round-trips', async () => {
    const t = tools({ width: 10, height: 10 }, small);
    const result = await encodeScreenshot(new Blob(['x']), t.stub);
    expect(result.type).toBe('image/jpeg');
    expect([...Buffer.from(result.data, 'base64')]).toEqual([
      1, 2, 3, 250, 251,
    ]);
    expect(t.qualities).toEqual([0.85]);
    expect(t.close).toHaveBeenCalled();
  });

  it('keeps the data of a large result intact beyond one slice', async () => {
    const n = 100_000;
    const t = tools({ width: 10, height: 10 }, () => n);
    const result = await encodeScreenshot(new Blob(['x']), t.stub);
    expect(Buffer.from(result.data, 'base64')).toHaveLength(n);
  });

  it('lowers the quality until the picture fits in 3 MB', async () => {
    const t = tools({ width: 4000, height: 3000 }, (q) =>
      q >= 0.75 ? feedbackScreenshotMaxBytes + 1 : 1000,
    );
    const result = await encodeScreenshot(new Blob(['x']), t.stub);
    expect(t.qualities).toEqual([0.85, 0.75, 0.65]);
    expect(Buffer.from(result.data, 'base64')).toHaveLength(1000);
  });

  it('accepts exactly 3 MB', async () => {
    const t = tools(
      { width: 10, height: 10 },
      () => feedbackScreenshotMaxBytes,
    );
    await expect(
      encodeScreenshot(new Blob(['x']), t.stub),
    ).resolves.toBeDefined();
  });

  it('throws when it is always too big, and releases the canvas', async () => {
    const t = tools(
      { width: 4000, height: 3000 },
      () => feedbackScreenshotMaxBytes + 1,
    );
    await expect(encodeScreenshot(new Blob(['x']), t.stub)).rejects.toThrow();
    expect(t.qualities.length).toBeGreaterThan(1);
    expect(t.made[0]!.height).toBe(0);
  });

  it('throws when the picture cannot be decoded or encoded', async () => {
    await expect(
      encodeScreenshot(new Blob(['x']), {
        decode: async () => {
          throw new Error('bad');
        },
        canvas: () => {
          throw new Error('unused');
        },
      }),
    ).rejects.toThrow();
    const t = tools({ width: 10, height: 10 }, small);
    t.stub.canvas = (w, h) => ({
      width: w,
      height: h,
      getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
      toBlob: (done) => done(null),
    });
    await expect(encodeScreenshot(new Blob(['x']), t.stub)).rejects.toThrow();
  });
});
