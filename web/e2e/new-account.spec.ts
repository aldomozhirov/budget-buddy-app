import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/setup', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { needed: false } })
      : route.continue(),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        member: { id: 1, name: 'Alex' },
        profiles: [{ id: 1, name: 'Alex' }],
        device: { defaultMemberId: 1, hasPasskey: false },
      },
    }),
  );
  await page.route('**/api/members', (route) =>
    route.fulfill({
      json: { members: [{ id: 1, name: 'Alex', active: true }] },
    }),
  );
  await page.route('**/api/settings', (route) =>
    route.fulfill({
      json: { commonCurrency: 'EUR', timeZone: 'Europe/Berlin' },
    }),
  );
  await page.route('**/api/currencies', (route) =>
    route.fulfill({
      json: {
        currencies: [
          { code: 'EUR', name: 'Euro', decimals: 2, kind: 'fiat', symbol: '€' },
          {
            code: 'USD',
            name: 'US Dollar',
            decimals: 2,
            kind: 'fiat',
            symbol: '$',
          },
          {
            code: 'RUB',
            name: 'Russian Ruble',
            decimals: 2,
            kind: 'fiat',
            symbol: '₽',
          },
          {
            code: 'BTC',
            name: 'Bitcoin',
            decimals: 8,
            kind: 'coin',
            symbol: 'BTC',
          },
          {
            code: 'USDT',
            name: 'Tether',
            decimals: 8,
            kind: 'coin',
            symbol: 'USDT',
          },
        ],
        coins: [
          { code: 'BTC', name: 'Bitcoin', decimals: 8, inUse: false },
          { code: 'USDT', name: 'Tether', decimals: 8, inUse: false },
        ],
      },
    }),
  );
});

test('creates an account with a dated opening balance and opens its page', async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route('**/api/accounts', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: {
        account: {
          id: 42,
          name: 'ING Girokonto',
          ownerMemberId: 1,
          ownerName: 'Alex',
          ownerActive: true,
          type: 'bank',
          currency: 'EUR',
          active: true,
          deactivatedAt: null,
          balance: '198630',
          balanceTakenAt: 1,
          balanceSource: 'opening',
          balanceUpdatedBy: 1,
          stale: false,
          createdBy: 1,
          createdAt: 1,
          updatedBy: 1,
          updatedAt: 1,
        },
      },
    });
  });

  await page.goto('/accounts/new');
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  if (test.info().project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/NewAccount.png',
      scale: 'css',
    });
  }
  await page.getByLabel('Name').fill('ING Girokonto');
  await page
    .getByRole('button', { name: 'Opening balance', exact: true })
    .click();
  for (const digit of ['1', '9', '8', '6']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Decimal point' }).click();
  await page.getByRole('button', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: '0', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page
    .locator('footer')
    .getByRole('button', { name: 'Save', exact: true })
    .click();

  await expect(page).toHaveURL(/\/accounts\/42$/);
  expect(requestBody).toMatchObject({
    name: 'ING Girokonto',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '198630',
  });
  expect(requestBody?.openingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
});

test('shows debt guidance, stores debt as negative, and offers coins under Other', async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route('**/api/accounts', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: {
        account: {
          id: 43,
          name: 'Money we owe',
          ownerMemberId: 1,
          ownerName: 'Alex',
          ownerActive: true,
          type: 'we_owe',
          currency: 'EUR',
          active: true,
          deactivatedAt: null,
          balance: '-50000',
          balanceTakenAt: 1,
          balanceSource: 'opening',
          balanceUpdatedBy: 1,
          stale: false,
          createdBy: 1,
          createdAt: 1,
          updatedBy: 1,
          updatedAt: 1,
        },
      },
    });
  });

  await page.goto('/accounts/new');
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill('Money we owe');
  await page.getByRole('radio', { name: 'Money we owe' }).click();
  await expect(
    page.getByText(
      'Type what you owe as a positive number. It’s stored as a negative balance.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Other currency or coin' }).click();
  await page.getByRole('button', { name: /USDT · Tether/ }).click();
  await page.getByRole('button', { name: 'EUR', exact: true }).click();
  await page
    .getByRole('button', { name: 'Opening balance', exact: true })
    .click();
  for (const digit of ['5', '0', '0']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page
    .locator('footer')
    .getByRole('button', { name: 'Save', exact: true })
    .click();

  await expect(page).toHaveURL(/\/accounts\/43$/);
  expect(requestBody).toMatchObject({
    type: 'we_owe',
    currency: 'EUR',
    openingBalance: '-50000',
  });
});
