import { expect, test } from '@playwright/test';
import type { Account } from '@budget-buddy/shared';

const now = Date.parse('2026-10-08T12:00:00.000Z');
const members = [
  { id: 1, name: 'Alex', active: true },
  { id: 2, name: 'Max', active: true },
];

function account(id: number, overrides: Partial<Account> = {}): Account {
  return {
    id,
    name: id === 1 ? 'ING Girokonto' : 'Money we owe',
    ownerMemberId: 1,
    ownerName: 'Alex',
    ownerActive: true,
    type: id === 1 ? 'bank' : 'we_owe',
    currency: 'EUR',
    active: true,
    deactivatedAt: null,
    balance: id === 1 ? '198630' : '-50000',
    balanceTakenAt: now,
    balanceSource: 'opening',
    balanceUpdatedBy: 1,
    stale: false,
    createdBy: 1,
    createdAt: now,
    updatedBy: 1,
    updatedAt: now,
    ...overrides,
  };
}

function snapshot(
  id: number,
  amount: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    accountId: 1,
    takenAt: now,
    amount,
    source: 'opening',
    checkinId: null,
    createdBy: 1,
    createdByName: 'Alex',
    createdAt: now,
    updatedBy: 1,
    updatedByName: 'Alex',
    updatedAt: now,
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  let currentAccount: Account = account(1);
  let history = [snapshot(1, '198630')];
  let revisions = [] as {
    id: number;
    snapshotId: number;
    accountId: number;
    action: 'update';
    oldAmount: string;
    oldTakenAt: number;
    changedBy: number;
    changedByName: string;
    changedAt: number;
  }[];
  await page.route('**/api/setup', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { needed: false } })
      : route.continue(),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        member: { id: 1, name: 'Alex' },
        profiles: members,
        device: { defaultMemberId: 1, hasPasskey: false },
      },
    }),
  );
  await page.route('**/api/members', (route) =>
    route.fulfill({ json: { members } }),
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
  await page.route('**/api/accounts/1/snapshots', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { snapshots: history } });
      return;
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        amount: string;
        date?: string;
      };
      const item = snapshot(2, body.amount, {
        takenAt: Date.parse(`${body.date ?? '2026-10-08'}T12:00:00.000Z`),
        source: 'manual',
      });
      history = [item, ...history];
      currentAccount = account(1, {
        balance: body.amount,
        balanceTakenAt: item.takenAt,
        balanceSource: 'manual',
      });
      await route.fulfill({ status: 201, json: { snapshot: item } });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/snapshots/1', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { amount: string };
      revisions = [
        {
          id: 1,
          snapshotId: 1,
          accountId: 1,
          action: 'update',
          oldAmount: history[0]?.amount ?? '198630',
          oldTakenAt: now,
          changedBy: 2,
          changedByName: 'Max',
          changedAt: now,
        },
      ];
      history = history.map((item) =>
        item.id === 1 ? { ...item, amount: body.amount } : item,
      );
      await route.fulfill({
        json: { snapshot: history.find((item) => item.id === 1) },
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/accounts/1/currency', async (route) => {
    const body = route.request().postDataJSON() as {
      currency: string;
      confirm?: boolean;
    };
    if (body.confirm)
      currentAccount = { ...currentAccount, currency: body.currency };
    await route.fulfill({
      json: {
        accountId: 1,
        fromCurrency: 'EUR',
        toCurrency: body.currency,
        requiresConfirmation: !body.confirm,
        example: {
          takenAt: now,
          beforeAmount: '198630',
          afterAmount: '198630',
        },
        precisionLosses: [],
      },
    });
  });
  await page.route('**/api/accounts/1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { account: currentAccount } });
    } else if (route.request().method() === 'PATCH') {
      currentAccount = {
        ...currentAccount,
        ...(route.request().postDataJSON() as object),
      };
      await route.fulfill({ json: { account: currentAccount } });
    } else {
      await route.continue();
    }
  });
  await page.route('**/api/accounts/1/deactivate', async (route) => {
    currentAccount = { ...currentAccount, active: false, deactivatedAt: now };
    await route.fulfill({ json: { account: currentAccount } });
  });
  await page.route('**/api/snapshots/*/revisions', (route) =>
    route.fulfill({ json: { revisions } }),
  );
  await page.route('**/api/accounts/2', (route) =>
    route.fulfill({ json: { account: account(2) } }),
  );
  await page.route('**/api/accounts/2/snapshots', (route) =>
    route.fulfill({
      json: { snapshots: [snapshot(2, '-50000', { accountId: 2 })] },
    }),
  );
});

test('shows opening balances and supports balance entry, settings and history', async ({
  page,
}) => {
  await page.goto('/accounts/1');
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€1,986.30'),
  ).toBeVisible();
  await expect(page.getByText('Opening · Alex')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();

  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Plus' }).click();
  for (const key of ['1', '2', '0'])
    await page.getByRole('button', { name: key, exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Account balance' }).getByText('€2,106.30'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save balance' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€2,106.30', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('By hand · Alex')).toBeVisible();

  await page.getByRole('button', { name: /Opening · Alex/ }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  for (const key of ['2', '0', '0', '0'])
    await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(
    page
      .getByRole('button', { name: /Opening · Alex/ })
      .getByText(/Changed by Max/),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByRole('button', { name: 'Change currency' }).click();
  await expect(
    page.getByText(/All 2 stored amounts are relabelled, not converted/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Relabel as USD' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Relabel as USD' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('$2,106.30', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Deactivate account' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'balance becomes zero from today.',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deactivate account' })
    .click();
  await expect(page.getByText('Inactive')).toBeVisible();

  await page.goto('/accounts/2');
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('−€500.00', { exact: true }),
  ).toBeVisible();
});
