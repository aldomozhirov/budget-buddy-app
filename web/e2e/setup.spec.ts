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
    await page.route('**/api/auth/me', (route) =>
      setupCompleted
        ? route.fulfill({
            json: {
              member: { id: 1, name: 'Alex' },
              profiles: [{ id: 1, name: 'Alex' }],
              device: { defaultMemberId: 1, hasPasskey: false },
            },
          })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'unauthenticated' } },
          }),
    );
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
  await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();
  await saveScreenshot(page, `Setup-form-${testInfo.project.name}.png`);
  if (testInfo.project.name === 'iphone') {
    await saveScreenshot(page, 'Setup.png');
  }

  // Tapping Create on an incomplete form explains what is missing.
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await expect(page.getByText('Repeat the family password.')).toBeVisible();
  await expect(page.getByText('Enter a profile name.')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Family password', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Family password', exact: true })
    .fill('short');
  await page
    .getByRole('textbox', { name: 'Repeat family password', exact: true })
    .fill('different');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();

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
    await expect(page.getByRole('heading', { name: 'Hi, Alex' })).toBeVisible();
  } else {
    await page.getByRole('link', { name: 'Later, go to Home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Hi, Alex' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Hi, Alex' })).toBeVisible();
  }
});

test('a failed setup check retries before exposing the setup flow', async ({
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
