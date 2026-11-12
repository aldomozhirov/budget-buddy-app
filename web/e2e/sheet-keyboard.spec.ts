import { expect, test, type Page } from '@playwright/test';
import { create, startFamily } from './support/family.js';

/** Made-up height of the on-screen keyboard. */
const KEYBOARD = 336;

declare global {
  interface Window {
    /** Test hook: shrinks the stubbed visual viewport by `height` px. */
    __setKeyboard: (height: number, offsetTop?: number) => void;
  }
}

/**
 * Replaces `window.visualViewport` with a stub, since WebKit under test
 * shows no real keyboard. `__setKeyboard(h)` shrinks it and fires `resize`.
 */
async function stubVisualViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stub = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      width: window.innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: stub,
    });
    window.__setKeyboard = (height: number, offsetTop = 0) => {
      stub.height = window.innerHeight - height - offsetTop;
      stub.offsetTop = offsetTop;
      stub.dispatchEvent(new Event('resize'));
    };
  });
}

/** Sets the simulated keyboard height (0 closes it). */
async function setKeyboard(
  page: Page,
  height: number,
  offsetTop = 0,
): Promise<void> {
  await page.evaluate(
    ([h, o]) => window.__setKeyboard(h!, o),
    [height, offsetTop],
  );
}

/** Fails unless the box lies fully above the stubbed keyboard's top. */
async function expectAboveKeyboard(
  page: Page,
  box: { y: number; height: number } | null,
): Promise<void> {
  expect(box).not.toBeNull();
  const visibleBottom = page.viewportSize()!.height - KEYBOARD;
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(visibleBottom);
}

test.beforeEach(async ({ page }) => {
  await stubVisualViewport(page);
});

test('the Merchant sheet and its search input sit above the keyboard', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await create(family, '/api/members', { name: 'Max' });
    await page.goto(`${family.origin}/add`);
    await page.getByRole('button', { name: 'Add merchant' }).click();
    const sheet = page.getByRole('dialog', { name: 'Merchant' });
    const search = sheet.getByLabel('Search or type a merchant');
    await search.focus();
    // Let the slide-in finish: the sheet rests on the bottom edge.
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box!.y + box!.height;
      })
      .toBe(page.viewportSize()!.height);
    const closedBottom = (await sheet.boundingBox())!;

    await setKeyboard(page, KEYBOARD);
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box!.y + box!.height;
      })
      .toBeLessThanOrEqual(page.viewportSize()!.height - KEYBOARD);
    await expectAboveKeyboard(page, await search.boundingBox());
    await expectAboveKeyboard(page, await sheet.boundingBox());

    // Closing the keyboard puts the sheet back at the bottom, as it was.
    await setKeyboard(page, 0);
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box!.y + box!.height;
      })
      .toBe(page.viewportSize()!.height);
    const reopened = (await sheet.boundingBox())!;
    expect(reopened.height).toBeCloseTo(closedBottom.height, 0);
    expect(reopened.y).toBeCloseTo(closedBottom.y, 0);
  });
});

test('the Note sheet text box sits above the keyboard', async ({ page }) => {
  await startFamily(page, async (family) => {
    await create(family, '/api/members', { name: 'Max' });
    await page.goto(`${family.origin}/add`);
    await page.getByRole('button', { name: 'Add note' }).click();
    const sheet = page.getByRole('dialog', { name: 'Note' });
    const note = sheet.getByLabel('Note');
    await note.focus();

    await setKeyboard(page, KEYBOARD);
    await expect
      .poll(async () => {
        const box = await note.boundingBox();
        return box!.y + box!.height;
      })
      .toBeLessThanOrEqual(page.viewportSize()!.height - KEYBOARD);
    await expectAboveKeyboard(page, await note.boundingBox());
  });
});

test('a scrolled visual viewport keeps the whole sheet on screen', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await create(family, '/api/members', { name: 'Max' });
    await page.goto(`${family.origin}/add`);
    await page.getByRole('button', { name: 'Add merchant' }).click();
    const sheet = page.getByRole('dialog', { name: 'Merchant' });
    await sheet.getByLabel('Search or type a merchant').focus();

    // iOS scrolls the visual viewport up when the field is under the keyboard.
    const offsetTop = 100;
    await setKeyboard(page, KEYBOARD, offsetTop);
    const visibleBottom = page.viewportSize()!.height - KEYBOARD;
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box!.y + box!.height;
      })
      .toBe(visibleBottom);
    expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(offsetTop);
  });
});
