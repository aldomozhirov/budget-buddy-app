import {
  feedbackScreenshotMaxBytes,
  type FeedbackScreenshot,
} from '@budget-buddy/shared';

/**
 * Turns a picked picture into the screenshot of a report (spec 8, O3): a
 * JPEG of at most 2048 px on the long side and at most 3 MB, as base64.
 * Drawing it anew also drops the photo's location and other metadata.
 */

/** Longest side of the picture sent, in pixels. */
export const SCREENSHOT_MAX_SIDE = 2048;

/** JPEG qualities tried in turn until the picture fits in 3 MB. */
export const SCREENSHOT_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

/** The canvas calls used, so tests can pass a stub. */
export interface ScreenshotCanvas {
  width: number;
  height: number;
  getContext(
    kind: '2d',
  ): Pick<
    CanvasRenderingContext2D,
    'drawImage' | 'fillRect' | 'fillStyle'
  > | null;
  toBlob(
    done: (blob: Blob | null) => void,
    type: string,
    quality: number,
  ): void;
}

/** Decoding and drawing, injectable for tests. */
export interface ScreenshotTools {
  decode(file: Blob): Promise<ImageBitmap>;
  canvas(width: number, height: number): ScreenshotCanvas;
}

const browserTools: ScreenshotTools = {
  decode: (file) => createImageBitmap(file),
  canvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

/**
 * Re-encodes a picture as described above.
 * @throws when the picture cannot be read, or does not fit in 3 MB even at
 * the lowest quality.
 */
export async function encodeScreenshot(
  file: Blob,
  tools: ScreenshotTools = browserTools,
): Promise<FeedbackScreenshot> {
  const bitmap = await tools.decode(file);
  const scale = Math.min(
    1,
    SCREENSHOT_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = tools.canvas(width, height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The picture cannot be drawn.');
    // JPEG has no transparency: a see-through PNG would turn black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  try {
    for (const quality of SCREENSHOT_QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (!blob) throw new Error('The picture cannot be encoded.');
      if (blob.size <= feedbackScreenshotMaxBytes) {
        return { type: 'image/jpeg', data: await toBase64(blob) };
      }
    }
    throw new Error('The picture is too large to send.');
  } finally {
    // Safari keeps a canvas's memory until its size is zero.
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // In slices, since one call with millions of arguments overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
