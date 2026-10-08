import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/setup', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { needed: false } })
      : route.continue(),
  );
});

test('the production app opens at the configured viewport', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  const expectedViewport =
    testInfo.project.name === 'iphone'
      ? { width: 390, height: 844 }
      : { width: 820, height: 1180 };
  await expect.poll(() => page.viewportSize()).toEqual(expectedViewport);

  const screenshotDirectory = 'test-results/screens';
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: `${screenshotDirectory}/Placeholder-${testInfo.project.name}.png`,
    scale: 'css',
  });
});
