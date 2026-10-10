import { expect, test, type Locator, type Page } from '@playwright/test';

const externalRequestsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  externalRequestsByPage.set(page, externalRequests);
  page.on('request', (request) => {
    const origin = new URL(request.url()).origin;
    const appOrigin = new URL(testInfo.project.use.baseURL as string).origin;
    if (origin !== appOrigin && origin !== 'http://127.0.0.1:4174') {
      externalRequests.push(request.url());
    }
  });
  await page.goto('http://127.0.0.1:4174/e2e/fixtures/sheet.html');
  await expect(
    page.getByRole('heading', { name: 'Sheet interaction harness' }),
  ).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(externalRequestsByPage.get(page)).toEqual([]);
});

test('a touch swipe down from the handle closes through the close event', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY + 350);
  await dispatchTouch(handle, 'end', startY + 350);

  await expect(sheet).toBeHidden();
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 1',
  );
});

test('a quick short downward touch flick closes the sheet', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY + 30, 20);
  await dispatchTouch(handle, 'end', startY + 30, 20);

  await expect(sheet).toBeHidden();
});

test('a short touch drag from the handle snaps the sheet back', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY + 24);
  await expect
    .poll(() =>
      sheet.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe('none');
  const scrim = sheet.locator('xpath=../button');
  const scrimState = await scrim.evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    computedOpacity: Number.parseFloat(getComputedStyle(element).opacity),
    inlineOpacity: Number.parseFloat((element as HTMLElement).style.opacity),
    isDragging: element.classList.contains('scrim-dragging'),
  }));
  expect(scrimState.animationName).toBe('none');
  expect(scrimState.isDragging).toBe(true);
  expect(scrimState.computedOpacity).toBeLessThan(1);
  expect(scrimState.computedOpacity).toBe(scrimState.inlineOpacity);
  await dispatchTouch(handle, 'end', startY + 24);

  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 0',
  );
});

test('a touch drag from the sheet header closes it', async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const heading = sheet.getByRole('heading', { name: 'Swipe test sheet' });
  const bounds = await heading.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(heading, 'start', startY);
  await dispatchTouch(heading, 'move', startY + 350);
  await dispatchTouch(heading, 'end', startY + 350);

  await expect(sheet).toBeHidden();
});

test('a downward drag starting on a body button closes without clicking it', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const button = sheet.getByRole('button', { name: 'Open nested sheet' });
  const bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(button, 'start', startY);
  const moveWasCancelled = await dispatchTouch(button, 'move', startY + 350);
  expect(moveWasCancelled).toBe(true);
  await dispatchTouch(button, 'end', startY + 350);

  await expect(sheet).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Nested sheet' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('status', { name: 'Body button clicks' }),
  ).toHaveText('Body button clicks: 0');
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 1',
  );
});

test('a quick down-then-up reversal does not close the sheet', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY + 30, 20);
  await dispatchTouch(handle, 'move', startY + 25, 20);
  await dispatchTouch(handle, 'end', startY + 25, 20);

  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 0',
  );
});

test('a touch drag upward does not move or close the sheet', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY - 80);
  await dispatchTouch(handle, 'end', startY - 80);

  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 0',
  );
});

test('a non-closable sheet does not move or close on a touch drag', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open non-closable sheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  await expect(sheet).toBeVisible();
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY + 350);
  await dispatchTouch(handle, 'end', startY + 350);

  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 0',
  );
});

test('a touch drag in a scrolled body scrolls content instead of dismissing', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const body = page.getByRole('region', { name: 'Scrollable sheet body' });
  const firstItem = body.getByText('Body item 1', { exact: true });
  const firstItemBefore = await firstItem.boundingBox();
  expect(firstItemBefore).not.toBeNull();
  await body.evaluate((element) => {
    element.scrollTop = 120;
  });
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const firstItemAfterScroll = await firstItem.boundingBox();
  expect(firstItemAfterScroll).not.toBeNull();
  expect(firstItemAfterScroll!.y).toBeLessThan(firstItemBefore!.y);

  const item = body.getByText('Body item 4', { exact: true });
  const bounds = await item.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(item, 'start', startY);
  await dispatchTouch(item, 'move', startY + 350);
  await dispatchTouch(item, 'end', startY + 350);

  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 0',
  );
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const firstItemBeforeFurtherScroll = await firstItem.boundingBox();
  expect(firstItemBeforeFurtherScroll).not.toBeNull();
  await body.evaluate((element) => {
    element.scrollTop += 60;
  });
  const firstItemAfterFurtherScroll = await firstItem.boundingBox();
  expect(firstItemAfterFurtherScroll).not.toBeNull();
  expect(firstItemAfterFurtherScroll!.y).toBeLessThan(
    firstItemBeforeFurtherScroll!.y,
  );
});

test('a touch drag from an independently scrollable body at top closes the sheet', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const body = page.getByRole('region', { name: 'Scrollable sheet body' });
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(0);
  const item = body.getByText('Body item 1', { exact: true });
  const bounds = await item.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(item, 'start', startY);
  await dispatchTouch(item, 'move', startY + 350);
  await dispatchTouch(item, 'end', startY + 350);

  await expect(sheet).toBeHidden();
});

test('reduced motion removes the snap-back transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const handle = sheet.locator('[aria-hidden="true"]').first();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + bounds!.height / 2;
  await dispatchTouch(handle, 'start', startY);
  await dispatchTouch(handle, 'move', startY + 24);
  await dispatchTouch(handle, 'end', startY + 24);

  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      sheet.evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toBe('0s');
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
});

test('a second touch cancels sheet dragging and leaves pinch zoom available', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const bounds = await sheet.boundingBox();
  expect(bounds).not.toBeNull();
  const startY = bounds!.y + 24;
  expect(await dispatchTouch(sheet, 'start', startY)).toBe(false);
  expect(await dispatchTouch(sheet, 'move', startY + 12)).toBe(true);
  await expect(sheet).toHaveClass(/sheet-dragging/);

  expect(
    await dispatchTouch(sheet, 'start', startY + 12, 100, 2),
  ).toBe(false);
  expect(
    await dispatchTouch(sheet, 'move', startY + 350, 100, 2),
  ).toBe(false);
  await dispatchTouch(sheet, 'end', startY + 350);

  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-dragging/);
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 0',
  );
});

test('a touchscreen tap on the dimmed area closes the sheet', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const bounds = await sheet.boundingBox();
  expect(bounds).not.toBeNull();
  await page.touchscreen.tap(12, Math.max(1, bounds!.y / 2));

  await expect(sheet).toBeHidden();
  await expect(page.getByRole('status', { name: 'Close events' })).toHaveText(
    'Close events: 1',
  );
});

test('page scrolling stays locked through stacked sheets and restores position', async ({
  page,
}) => {
  await page.evaluate(() => window.scrollTo(0, 460));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(460);
  await page
    .getByRole('button', { name: 'Open closable sheet' })
    .evaluate((element) => (element as HTMLButtonElement).click());
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const lockState = await page.evaluate(() => ({
    scrollY: window.scrollY,
    bodyPosition: document.body.style.position,
  }));
  expect(lockState).toEqual({
    scrollY: 0,
    bodyPosition: 'fixed',
  });
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Open nested sheet' }).click();
  const nested = page.getByRole('dialog', { name: 'Nested sheet' });
  await expect(nested).toBeVisible();
  await expect(
    page.getByRole('status', { name: 'Body button clicks' }),
  ).toHaveText('Body button clicks: 1');
  await tapScrim(page, nested);
  await expect(nested).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).position))
    .toBe('fixed');
  await tapScrim(page, sheet);
  await expect(sheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(460);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).position))
    .not.toBe('fixed');
});

test('locking a scrolled page keeps its content at the existing offset', async ({
  page,
}) => {
  await page.evaluate(() => window.scrollTo(0, 460));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(460);
  await page
    .getByRole('button', { name: 'Open closable sheet' })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(
    page.getByRole('dialog', { name: 'Swipe test sheet' }),
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.body.style.top))
    .toBe('-460px');
});

test('content in a tall sheet scrolls without chaining to the page', async ({
  page,
}) => {
  await openSheet(page);
  const sheet = page.getByRole('dialog', { name: 'Swipe test sheet' });
  const item = sheet.getByText('Sheet item 20', { exact: true });
  const itemBefore = await item.boundingBox();
  expect(itemBefore).not.toBeNull();
  await sheet.evaluate((element) => {
    element.scrollTop = 640;
  });
  await expect
    .poll(() => sheet.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const itemAfter = await item.boundingBox();
  expect(itemAfter).not.toBeNull();
  expect(itemAfter!.y).toBeLessThan(itemBefore!.y - 300);
  const atEnd = await sheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      scrollTop: element.scrollTop,
      maxScroll: element.scrollHeight - element.clientHeight,
      overscroll: getComputedStyle(element).overscrollBehaviorY,
    };
  });
  expect(atEnd.scrollTop).toBeGreaterThan(0);
  expect(atEnd.scrollTop).toBe(atEnd.maxScroll);
  expect(atEnd.overscroll).toBe('contain');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

async function openSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open closable sheet' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Swipe test sheet' }),
  ).toBeVisible();
}

async function dispatchTouch(
  target: Locator,
  phase: 'start' | 'move' | 'end',
  clientY: number,
  elapsedMs = 100,
  touchCount = 1,
): Promise<boolean> {
  const page = target.page();
  if (!clockedPages.has(page)) {
    await page.clock.install();
    clockedPages.add(page);
  }
  if (phase !== 'start') await page.clock.fastForward(elapsedMs);

  return target.evaluate(
    (element, { phase, clientY, touchCount }) => {
      const type = `touch${phase}`;
      const points = Array.from({ length: touchCount }, (_, index) => ({
        identifier: index + 1,
        target: element,
        clientX: 120 + index * 80,
        clientY: clientY + index * 40,
      }));
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: phase === 'end' ? [] : points },
        changedTouches: {
          value:
            phase === 'start' && touchCount > 1
              ? [points[touchCount - 1]]
              : [points[0]],
        },
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { phase, clientY, touchCount },
  );
}

async function tapScrim(page: Page, sheet: Locator): Promise<void> {
  const bounds = await sheet.boundingBox();
  expect(bounds).not.toBeNull();
  await page.touchscreen.tap(12, Math.max(1, bounds!.y / 2));
}

const clockedPages = new WeakSet<Page>();
