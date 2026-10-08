import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('a fresh install completes setup and offers the next steps', async ({
  page,
}, testInfo) => {
  const externalRequests: string[] = [];
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  // Keep the iPad run visual-only: the iPhone run exercises the fresh API once,
  // while both viewports capture the real rendered form and next-steps screen.
  if (testInfo.project.name === 'ipad') {
    let setupCompleted = false;
    await page.route('**/api/setup', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { needed: !setupCompleted } });
      }
      setupCompleted = true;
      return route.fulfill({ status: 201, json: { needed: false } });
    });
  }

  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole('heading', { name: 'Set up Budget Buddy' }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Family password', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', {
      name: 'Repeat family password',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '+ Add a profile' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
  await saveScreenshot(page, `Setup-form-${testInfo.project.name}.png`);
  if (testInfo.project.name === 'iphone') {
    await saveScreenshot(page, 'Setup.png');
  }

  await page
    .getByRole('textbox', { name: 'Family password', exact: true })
    .fill('family password 2026');
  await page
    .getByRole('textbox', { name: 'Repeat family password', exact: true })
    .fill('family password 2026');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: '+ Add a profile' }).click();
  await page.getByLabel('Profile 2 name').fill('Blair');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add your accounts' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Pick the check-in schedule' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Later, go to Home' }),
  ).toBeVisible();
  await saveScreenshot(page, `Setup-next-steps-${testInfo.project.name}.png`);
  expect(externalRequests).toEqual([]);

  if (testInfo.project.name === 'iphone') {
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  } else {
    await page.getByRole('link', { name: 'Later, go to Home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  }
});

test('a failed setup check stays unknown and can be retried', async ({
  page,
}) => {
  let statusChecks = 0;
  await page.route('**/api/setup', (route) => {
    statusChecks += 1;
    return statusChecks === 1
      ? route.fulfill({
          status: 503,
          json: { error: 'temporarily unavailable' },
        })
      : route.fulfill({ json: { needed: true } });
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole('heading', { name: 'Set up Budget Buddy' }),
  ).toBeVisible();
  expect(statusChecks).toBe(2);
});

test('a CSRF rejection does not complete a fresh setup', async ({
  page,
}, testInfo) => {
  let statusChecks = 0;
  let setupAttempts = 0;
  const externalRequests: string[] = [];
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });
  await page.route('**/api/setup', (route) => {
    if (route.request().method() === 'GET') {
      statusChecks += 1;
      return route.fulfill({ json: { needed: true } });
    }

    setupAttempts += 1;
    return setupAttempts === 1
      ? route.fulfill({
          status: 403,
          json: {
            error: {
              code: 'forbidden_state',
              message: 'Request not allowed.',
            },
          },
        })
      : route.fulfill({ status: 201, json: { needed: false } });
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page
    .getByRole('textbox', { name: 'Family password', exact: true })
    .fill('family password 2026');
  await page
    .getByRole('textbox', { name: 'Repeat family password', exact: true })
    .fill('family password 2026');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole('heading', { name: 'Set up Budget Buddy' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Request not allowed.');
  await expect(page.getByRole('heading', { name: 'Next steps' })).toHaveCount(
    0,
  );
  expect(statusChecks).toBe(2);

  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible();
  expect(setupAttempts).toBe(2);
  expect(externalRequests).toEqual([]);
});

async function saveScreenshot(page: Page, filename: string): Promise<void> {
  const directory = 'test-results/screens';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${filename}`, scale: 'css' });
}
