import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const schemes = ['light', 'dark'] as const;

for (const scheme of schemes) {
  test(`component gallery matches the ${scheme} appearance`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      if (
        new URL(request.url()).origin !==
        new URL(testInfo.project.use.baseURL as string).origin
      ) {
        externalRequests.push(request.url());
      }
    });

    await page.goto('/dev/components');
    await expect(
      page.getByRole('heading', { name: `Components · ${scheme}` }),
    ).toBeVisible();

    if (scheme === 'light') {
      const screenshotDirectory = 'web/test-results/screens';
      await mkdir(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: `${screenshotDirectory}/Components-${testInfo.project.name}.png`,
        scale: 'css',
      });
    }

    await expect(page).toHaveScreenshot(`components-${scheme}.png`, {
      fullPage: true,
      animations: 'disabled',
      mask: [page.locator('input[type="password"]')],
      maskColor: '#ff00ff',
    });
    expect(externalRequests).toEqual([]);
  });
}

test('the gallery makes every icon-only button accessible', async ({
  page,
}) => {
  await page.goto('/dev/components');
  await expect(
    page.getByRole('heading', { name: 'Components · light' }),
  ).toBeVisible();

  const buttons = page.getByRole('button');
  const count = await buttons.count();
  let iconOnlyCount = 0;
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const isIconOnly = await button.evaluate(
      (element) => element.textContent?.trim() === '',
    );
    if (isIconOnly) {
      iconOnlyCount += 1;
      await expect(button).toHaveAccessibleName(/\S+/);
    }
  }

  expect(iconOnlyCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Open sheet preview' }).click();
  const sheet = page.getByRole('dialog', { name: 'Close the check-in now?' });
  await expect(sheet).toBeVisible();
  for (const button of await sheet.getByRole('button').all()) {
    await expect(button).toHaveAccessibleName(/\S+/);
  }
  for (const name of ['Close', 'Close check-in', 'Keep it open']) {
    await expect(
      sheet.getByRole('button', { name, exact: true }),
    ).toHaveAccessibleName(name);
  }
});

test('the gallery touch targets are at least 44 by 44 CSS pixels', async ({
  page,
}) => {
  await page.goto('/dev/components');
  await expect(
    page.getByRole('heading', { name: 'Components · light' }),
  ).toBeVisible();

  const targets = page.locator(
    'button, a[href], input:not([type="hidden"]), [role="tab"], [role="radio"], [role="switch"]',
  );
  const undersized = await targets.evaluateAll((elements) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44
        ? [
            `${element.tagName.toLowerCase()}${element.getAttribute('aria-label') ? `[${element.getAttribute('aria-label')}]` : ''}: ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`,
          ]
        : [];
    }),
  );

  expect(undersized).toEqual([]);

  await page.getByRole('button', { name: 'Open sheet preview' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const sheetUndersized = await targets.evaluateAll((elements) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width >= 44 && rect.height >= 44) return [];
      return [
        `${element.tagName.toLowerCase()}${element.getAttribute('aria-label') ? `[${element.getAttribute('aria-label')}]` : ''}: ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`,
      ];
    }),
  );
  expect(sheetUndersized).toEqual([]);

  for (const name of ['Close', 'Close check-in', 'Keep it open']) {
    const control = page
      .getByRole('dialog')
      .getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    const bounds = await control.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
    expect(bounds.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(bounds.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
});

test('a sheet has no transition when reduced motion is requested', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/components');
  await page.getByRole('button', { name: 'Open sheet preview' }).click();

  const sheet = page.getByRole('dialog', { name: 'Close the check-in now?' });
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      sheet.evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toBe('0s');
  await expect
    .poll(() => sheet.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('none');
  const pseudoTransitionDuration = await page.evaluate(() => {
    const field = document.createElement('div');
    field.className = 'field';
    field.setAttribute('aria-expanded', 'false');
    document.querySelector('.bb')?.append(field);
    const duration = getComputedStyle(field, '::after').transitionDuration;
    field.remove();
    return duration;
  });
  expect(pseudoTransitionDuration).toBe('0s');
});
