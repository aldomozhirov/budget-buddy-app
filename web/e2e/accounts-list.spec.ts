import { expect, test } from '@playwright/test';

const accounts = [
  {
    id: 1,
    name: 'ING Girokonto',
    ownerMemberId: 1,
    ownerName: 'Alex',
    ownerActive: true,
    type: 'bank',
    currency: 'EUR',
    active: true,
    deactivatedAt: null,
    balance: '198630',
    balanceTakenAt: Date.parse('2026-10-08T12:00:00Z'),
    balanceSource: 'checkin',
    balanceUpdatedBy: 1,
    stale: false,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
    updatedAt: 1,
  },
  {
    id: 2,
    name: 'Cash EUR',
    ownerMemberId: 1,
    ownerName: 'Alex',
    ownerActive: true,
    type: 'cash',
    currency: 'EUR',
    active: true,
    deactivatedAt: null,
    balance: '24000',
    balanceTakenAt: Date.parse('2026-09-01T12:00:00Z'),
    balanceSource: 'manual',
    balanceUpdatedBy: 1,
    stale: true,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
    updatedAt: 1,
  },
  {
    id: 3,
    name: 'Cash USD',
    ownerMemberId: 1,
    ownerName: 'Alex',
    ownerActive: true,
    type: 'cash',
    currency: 'USD',
    active: true,
    deactivatedAt: null,
    balance: '30000',
    balanceTakenAt: Date.parse('2026-10-07T12:00:00Z'),
    balanceSource: 'opening',
    balanceUpdatedBy: 1,
    stale: false,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
    updatedAt: 1,
  },
  {
    id: 4,
    name: 'Max savings',
    ownerMemberId: 2,
    ownerName: 'Max',
    ownerActive: true,
    type: 'bank',
    currency: 'USD',
    active: true,
    deactivatedAt: null,
    balance: '95000',
    balanceTakenAt: Date.parse('2026-10-06T12:00:00Z'),
    balanceSource: 'checkin',
    balanceUpdatedBy: 2,
    stale: false,
    createdBy: 2,
    createdAt: 1,
    updatedBy: 2,
    updatedAt: 1,
  },
  {
    id: 5,
    name: 'Max old account',
    ownerMemberId: 2,
    ownerName: 'Max',
    ownerActive: false,
    type: 'bank',
    currency: 'EUR',
    active: false,
    deactivatedAt: Date.parse('2026-10-01T12:00:00Z'),
    balance: '10000',
    balanceTakenAt: Date.parse('2026-09-01T12:00:00Z'),
    balanceSource: 'manual',
    balanceUpdatedBy: 2,
    stale: true,
    createdBy: 2,
    createdAt: 1,
    updatedBy: 2,
    updatedAt: 1,
  },
];

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
        profiles: [
          { id: 1, name: 'Alex' },
          { id: 2, name: 'Max' },
          { id: 3, name: 'Sofia' },
        ],
        device: { defaultMemberId: 1, hasPasskey: false },
      },
    }),
  );
  await page.route('**/api/members', (route) =>
    route.fulfill({
      json: {
        members: [
          { id: 1, name: 'Alex', active: true },
          { id: 2, name: 'Max', active: true },
          { id: 3, name: 'Sofia', active: true },
        ],
      },
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
        ],
        coins: [],
      },
    }),
  );
  await page.route('**/api/accounts*', (route) => {
    const url = new URL(route.request().url());
    const owner = url.searchParams.get('owner');
    const includeInactive = url.searchParams.get('inactive') === 'true';
    const responseAccounts = accounts.filter(
      (account) =>
        (owner === null || String(account.ownerMemberId) === owner) &&
        (includeInactive || account.active),
    );
    return route.fulfill({ json: { accounts: responseAccounts } });
  });
});

test('filters and groups accounts by owner, type and currency', async ({
  page,
}) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yours' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Max’s' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Cash EUR · EUR/ }),
  ).toContainText('Stale');

  const maxRequest = page.waitForRequest(/\/api\/accounts\?owner=2/u);
  await page.getByRole('tab', { name: 'Max' }).click();
  await maxRequest;
  await expect(page.getByRole('heading', { name: 'Max’s' })).toBeVisible();
  await expect(page.getByRole('link', { name: /ING Girokonto/ })).toHaveCount(
    0,
  );

  await page.getByRole('tab', { name: 'Everyone' }).click();
  await page.getByRole('button', { name: /Type/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: /Cash/ }).click();
  await expect(
    page.getByRole('link', { name: /Cash EUR · EUR/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Cash USD · USD/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /ING Girokonto/ })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: /Currency/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: /USD/ }).click();
  await expect(
    page.getByRole('link', { name: /Cash USD · USD/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Cash EUR · EUR/ })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: /Cash/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('radio', { name: /All types/ })
    .click();
  await page.getByRole('button', { name: /USD/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('radio', { name: /All currencies/ })
    .click();
  await page.getByRole('button', { name: 'Show inactive' }).click();
  await expect(
    page.getByRole('link', { name: /Max old account/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Max old account/ }).getByText('Inactive'),
  ).toBeVisible();
});
