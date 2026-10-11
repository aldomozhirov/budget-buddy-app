/**
 * Renders web/icon-source/icon.html to the app icons (spec 01, task 27):
 * web/public/icons/icon-192.png, icon-512.png and apple-touch-icon.png (180).
 * Uses the WebKit that Playwright already installs for the tests, so no
 * package is added. Run `pnpm icons` after changing the source, and commit
 * the PNGs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webkit } from '@playwright/test';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = path.join(root, 'web/icon-source/icon.html');
const publicDir = path.join(root, 'web/public');
const targets = [
  { file: 'icons/icon-192.png', size: 192 },
  { file: 'icons/icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

await mkdir(path.join(publicDir, 'icons'), { recursive: true });
const browser = await webkit.launch();
try {
  for (const { file, size } of targets) {
    // The source is 512 px square; the scale factor makes the PNG `size` px.
    const context = await browser.newContext({
      viewport: { width: 512, height: 512 },
      deviceScaleFactor: size / 512,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(source).href);
    await page.evaluate(() => document.fonts.ready);
    await writeFile(path.join(publicDir, file), await page.screenshot());
    await context.close();
  }
} finally {
  await browser.close();
}
