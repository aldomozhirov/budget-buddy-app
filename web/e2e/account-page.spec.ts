import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Account } from '@budget-buddy/shared';

const now = Date.parse('2026-10-08T12:00:00.000Z');
const members = [
  { id: 1, name: 'Alex', active: true },
  { id: 2, name: 'Max', active: true },
];
let currencyConfirmations = 0;
let correctionPayload: { amount: string; date?: string } | undefined;

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
  let history = Array.from({ length: 7 }, (_, index) =>
    snapshot(index + 1, String(198630 - index * 1000), {
      source: index === 0 ? 'opening' : 'checkin',
      takenAt: now - index * 30 * 24 * 60 * 60 * 1000,
    }),
  );
  currencyConfirmations = 0;
  correctionPayload = undefined;
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
      const item = snapshot(8, body.amount, {
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
      const body = route.request().postDataJSON() as {
        amount: string;
        date?: string;
      };
      correctionPayload = body;
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
        item.id === 1
          ? {
              ...item,
              amount: body.amount,
              ...(body.date
                ? {
                    takenAt: Date.parse(`${body.date}T23:00:00.000Z`),
                  }
                : {}),
            }
          : item,
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
    if (body.confirm) {
      currencyConfirmations += 1;
      currentAccount = { ...currentAccount, currency: body.currency };
    }
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
}, testInfo) => {
  if (testInfo.project.name === 'iphone') {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  await page.goto('/accounts/1');
  const historyRows = page
    .getByRole('heading', { name: 'Balance history · tap to correct' })
    .locator('..')
    .getByRole('button');
  const historyHeading = page.getByRole('heading', {
    name: 'Balance history · tap to correct',
  });
  await expect(historyHeading).toHaveCSS('font-size', '13px');
  await expect(historyHeading).toHaveCSS('font-weight', '500');
  await expect(historyRows.first()).toHaveJSProperty('offsetHeight', 58);
  await expect(
    historyRows.first().locator('.history-left > .num'),
  ).toHaveCSS('font-weight', '500');
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€1,986.30', { exact: true }),
  ).toBeVisible();
  const balanceCard = page.getByRole('region', { name: 'Current balance' });
  await expect(balanceCard).toHaveCSS('border-radius', '20px');
  await expect(balanceCard).toHaveCSS('row-gap', '4px');
  await expect(page.getByText('Opening · Alex')).toBeVisible();
  await expect(historyRows.last()).toContainText('First balance');
  await expect(
    page.getByRole('button', { name: /Opening · Alex/ }),
  ).toContainText('▲ €10.00');
  await expect(
    page.getByRole('img', { name: /Account balance from/u }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Account balance from/u }).locator('..'),
  ).toHaveCSS('margin-top', '12px');
  await expect(page.getByText('High €1,986.30')).toBeVisible();
  await expect(page.getByText('Low €1,926.30')).toBeVisible();
  await expect(page.getByText('Apr 26', { exact: true })).toBeVisible();
  await expect(page.getByText('Oct 26', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Transactions' })).toHaveCount(
    0,
  );
  const chartLine = page
    .getByRole('img', { name: /Account balance from/u })
    .locator('polyline');
  await expect(chartLine).toHaveCount(1);
  const animationName = await chartLine.evaluate(
    (element) => getComputedStyle(element).animationName,
  );
  expect(animationName).toMatch(
    testInfo.project.name === 'iphone' ? /^none$/u : /^chart-draw(?:-|$)/u,
  );
  await expect(page.getByRole('tab', { name: '1 Y' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const range of ['3 M', '1 Y', 'All']) {
    const bounds = await page
      .getByRole('tab', { name: range })
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      });
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
  }
  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/AccountDetail.png',
      scale: 'css',
    });
  }
  await page.getByRole('tab', { name: '3 M' }).click();
  await expect(page.getByRole('tab', { name: '3 M' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('tab', { name: 'All' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
  await expect(historyRows.first()).toContainText('By hand · Alex');
  await expect(historyRows.first()).toContainText('€2,106.30');
  await expect(historyRows.first()).toContainText('▲ €120.00');

  await page.getByRole('button', { name: /Opening · Alex/ }).click();
  const correction = page.getByRole('dialog');
  await expect(
    correction.getByRole('button', { name: 'Save correction' }),
  ).toBeVisible();
  await expect(
    correction.getByRole('button', { name: 'Delete', exact: true }).last(),
  ).toBeVisible();
  await correction.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Opening · Alex/ }),
  ).toContainText('€1,986.30');

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
  await expect(
    page.getByRole('button', { name: /Opening · Alex/ }),
  ).toContainText('€2,000.00');
  expect(correctionPayload).toEqual({ amount: '200000' });
  await page.getByRole('button', { name: /Opening · Alex/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Changed by Max');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();

  await page.getByRole('button', { name: 'Account settings' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('ING Girokonto');
  await expect(page.getByLabel('Owner')).toHaveValue('1');
  await expect(page.getByLabel('Type')).toHaveValue('bank');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByRole('button', { name: 'Change currency' }).click();
  const relabelWarning =
    'All 8 stored amounts are relabelled, not converted: €1,986.30 becomes $1,986.30. Use this only to fix a wrong currency.';
  await expect(page.getByText(relabelWarning, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Relabel as USD' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€2,106.30', { exact: true }),
  ).toBeVisible();
  expect(currencyConfirmations).toBe(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€2,106.30', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Change currency' })
    .click();
  await expect(page.getByText(relabelWarning, { exact: true })).toBeVisible();
  expect(currencyConfirmations).toBe(0);
  await page.getByRole('button', { name: 'Relabel as USD' }).click();
  expect(currencyConfirmations).toBe(1);
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('$2,106.30', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Deactivate account' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'This account will become inactive. Its balance history stays, and its balance becomes zero from today.',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep account active' })
    .click();
  await expect(page.getByText('Inactive')).toHaveCount(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deactivate account' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deactivate account' })
    .click();
  await expect(page.getByText('Inactive')).toBeVisible();
  expect(
    await page
      .getByText('Inactive', { exact: true })
      .evaluate((element) => element.tagName),
  ).toBe('SPAN');

  await page.goto('/accounts/2');
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('−€500.00', { exact: true }),
  ).toBeVisible();
});

test('keeps month tick labels from overlapping for irregular histories', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-10T12:00:00.000Z') });
  const dates = [
    '2026-01-15',
    '2026-02-15',
    '2026-03-15',
    '2026-04-15',
    '2026-05-15',
    '2026-06-15',
    '2026-07-15',
    '2026-08-15',
    '2026-09-15',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
  ];
  const irregularHistory = dates
    .map((date, index) =>
      snapshot(index + 1, String(198630 - index * 1000), {
        source: index === 0 ? 'opening' : 'checkin',
        takenAt: Date.parse(`${date}T12:00:00.000Z`),
      }),
    )
    .reverse();
  await page.route('**/api/accounts/1/snapshots', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { snapshots: irregularHistory } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/accounts/1');

  await expect(
    page.getByRole('img', { name: /Account balance from/u }),
  ).toBeVisible();
  const monthTicks = page.locator('.chart-month-ticks span');
  await expect(monthTicks).toHaveCount(10);
  const visibleTickBounds = await monthTicks
    .evaluateAll((labels) =>
      labels
        .filter((label) => getComputedStyle(label).visibility !== 'hidden')
        .map((label) => {
          const rect = label.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
    );
  expect(visibleTickBounds.length).toBeGreaterThan(1);
  for (let index = 1; index < visibleTickBounds.length; index += 1) {
    expect(visibleTickBounds[index]!.left).toBeGreaterThanOrEqual(
      visibleTickBounds[index - 1]!.right + 3,
    );
  }
});

test('explains why an account with history cannot be deleted', async ({
  page,
}) => {
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Account settings' }).click();

  const settings = page.getByRole('dialog');
  await expect(settings).toContainText(
    'This account has balance history and cannot be deleted. Deactivate it to keep its history.',
  );
  await expect(
    settings.getByRole('button', { name: 'Delete account' }),
  ).toHaveCount(0);
});

test('saves a balance with an earlier date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-10T12:00:00.000Z') });
  let submittedDate: string | undefined;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/accounts/1/snapshots') &&
      request.method() === 'POST'
    ) {
      submittedDate = (request.postDataJSON() as { date?: string }).date;
    }
  });
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: /Today · Change date/ }).click();
  await page.getByLabel('Earlier date…').fill('2026-10-09');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Plus' }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Save balance' }).click();

  await expect.poll(() => submittedDate).toBe('2026-10-09');
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€1,987.30', { exact: true }),
  ).toBeVisible();
});

test('keeps an earlier balance date when the account stays open overnight', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-08T21:59:00.000Z') });
  let submittedDate: string | undefined;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/accounts/1/snapshots') &&
      request.method() === 'POST'
    ) {
      submittedDate = (request.postDataJSON() as { date?: string }).date;
    }
  });
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: /Today · Change date/ }).click();
  await expect(page.getByLabel('Earlier date…')).toHaveValue('2026-10-08');

  await page.clock.fastForward(2 * 60 * 1000);
  await expect(page.getByLabel('Earlier date…')).toHaveAttribute(
    'max',
    '2026-10-09',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('button', { name: '08/10/2026 · Change date' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Save balance' }).click();

  await expect.poll(() => submittedDate).toBe('2026-10-08');
});

test('sends the formerly-Today date explicitly after a midnight rollover', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-08T21:59:40.000Z') });
  let submittedDate: string | undefined;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/accounts/1/snapshots') &&
      request.method() === 'POST'
    ) {
      submittedDate = (request.postDataJSON() as { date?: string }).date;
    }
  });

  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await expect(
    page.getByRole('button', { name: 'Today · Change date' }),
  ).toBeVisible();
  await page.clock.fastForward(30_000);
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Save balance' }).click();

  await expect.poll(() => submittedDate).toBe('2026-10-08');
});

test('opens Set balance with the new Today date after midnight', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-08T21:59:40.000Z') });
  await page.goto('/accounts/1');
  await page.clock.fastForward(30_000);

  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: 'Today · Change date' }).click();
  await expect(page.getByLabel('Earlier date…')).toHaveValue('2026-10-09');
});

test('opens correction with the refreshed date limit after midnight', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-08T21:59:40.000Z') });
  await page.goto('/accounts/1');
  await page.clock.fastForward(30_000);

  await page.getByRole('button', { name: /Opening · Alex/u }).click();

  await expect(page.locator('#correction-date')).toHaveAttribute(
    'max',
    '2026-10-09',
  );
});

test('choosing Today after midnight omits the balance date from the request', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-08T21:59:40.000Z') });
  let submittedBody: { amount: string; date?: string } | undefined;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/accounts/1/snapshots') &&
      request.method() === 'POST'
    ) {
      submittedBody = request.postDataJSON() as {
        amount: string;
        date?: string;
      };
    }
  });

  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: 'Today · Change date' }).click();
  await expect(page.getByLabel('Earlier date…')).toHaveValue('2026-10-08');
  await page.clock.fastForward(30_000);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Today · Change date' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Save balance' }).click();

  await expect.poll(() => submittedBody).toEqual({ amount: '198630' });
});

test('returns to Today if the earlier date is cleared', async ({ page }) => {
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: /Today · Change date/ }).click();
  await page.getByLabel('Earlier date…').fill('');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.getByRole('button', { name: 'Today · Change date' }),
  ).toBeVisible();
});

test('keeps the entered amount while choosing an earlier date', async ({
  page,
}) => {
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Plus' }).click();
  for (const key of ['1', '2', '0'])
    await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: /Today · Change date/ }).click();
  await page.getByLabel('Earlier date…').fill('2026-10-07');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(
    page.getByRole('group', { name: 'Account balance' }).getByText('€2,106.30'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Account balance' })
      .getByText('1986.30+120'),
  ).toBeVisible();
});

test('keeps the date editor focusable without hidden amount controls', async ({
  page,
}) => {
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: /Today · Change date/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Balance date' });
  const dateInput = page.getByLabel('Earlier date…');
  await expect(dateInput).toBeFocused();
  await dialog.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Today' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dateInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Today' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(dateInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dateChoice = page.getByRole('button', {
    name: /Today · Change date/,
  });
  await expect(dateChoice).toBeFocused();
  expect(
    await dateChoice.evaluate((element) => element.matches(':focus-visible')),
  ).toBe(true);
  await expect(dateChoice).toHaveCSS('outline-style', 'solid');
  await expect(dateChoice).toHaveCSS('outline-width', '2px');
});

test('keeps a currency preview tied to its requested currency', async ({
  page,
}) => {
  let releasePreview = () => {};
  const previewGate = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  const previewCurrencies: string[] = [];
  let confirmedCurrency: string | undefined;
  await page.route('**/api/accounts/1/currency', async (route) => {
    const body = route.request().postDataJSON() as {
      currency: string;
      confirm?: boolean;
    };
    if (body.confirm) {
      confirmedCurrency = body.currency;
      await route.fallback();
      return;
    }
    previewCurrencies.push(body.currency);
    await previewGate;
    await route.fallback();
  });
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Account settings' }).click();
  const currency = page.getByLabel('Currency');
  await currency.selectOption('USD');
  await page.getByRole('button', { name: 'Change currency' }).click();

  await expect(currency).toBeDisabled();
  await expect(currency).toHaveValue('USD');
  await expect(
    page.getByRole('button', { name: 'Relabel as USD' }),
  ).toHaveCount(0);
  expect(previewCurrencies).toEqual(['USD']);
  releasePreview();
  const warning =
    'All 7 stored amounts are relabelled, not converted: €1,986.30 becomes $1,986.30. Use this only to fix a wrong currency.';
  await expect(
    page.getByRole('dialog', { name: 'Relabel as USD?' }),
  ).toContainText(warning);
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Relabel as USD' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Relabel as USD' }).click();
  await expect.poll(() => confirmedCurrency).toBe('USD');
});

test('shows an actionable error when deactivation fails', async ({ page }) => {
  await page.route('**/api/accounts/1/deactivate', (route) => route.abort());
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Deactivate account' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Deactivate account' })
    .click();

  await expect(page.getByRole('alert')).toHaveText(
    'Could not update this account. Check your connection and try again.',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('renders stale state with the warning tag treatment', async ({ page }) => {
  await page.route('**/api/accounts/1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { account: account(1, { stale: true }) } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/accounts/1');

  const staleTag = page.getByText('Stale', { exact: true });
  await expect(staleTag).toBeVisible();
  await expect(staleTag).toHaveCSS('background-color', 'rgb(245, 226, 212)');
  expect(await staleTag.evaluate((element) => element.tagName)).toBe('SPAN');
});

test('shows an actionable error when snapshot deletion fails', async ({
  page,
}) => {
  await page.route('**/api/snapshots/1', (route) => route.abort());
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: /Opening · Alex/ }).click();
  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .last()
    .click();

  await expect(page.getByRole('alert')).toHaveText(
    'Could not delete this balance. Check your connection and try again.',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('shows account deletion as available only for an empty account', async ({
  page,
}) => {
  await page.route('**/api/accounts/3', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.abort();
      return;
    }
    await route.fulfill({
      json: {
        account: account(3, {
          name: 'Empty account',
          balance: '0',
          balanceTakenAt: null,
          balanceSource: null,
          balanceUpdatedBy: null,
        }),
      },
    });
  });
  await page.route('**/api/accounts/3/snapshots', (route) =>
    route.fulfill({ json: { snapshots: [] } }),
  );
  await page.goto('/accounts/3');
  await expect(
    page.getByText(/cannot be deleted while it has transactions/u),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'This account has no balance history and will be deleted.',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete account' })
    .click();
  await expect(page.getByRole('alert')).toHaveText(
    'Could not delete this account. Check your connection and try again.',
  );
});

test('does not send two balance saves while the first request is pending', async ({
  page,
}) => {
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requests = 0;
  await page.route('**/api/accounts/1/snapshots', async (route) => {
    if (route.request().method() === 'POST') {
      requests += 1;
      await responseGate;
      await route.fallback();
      return;
    }
    await route.fallback();
  });
  await page.goto('/accounts/1');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await page.getByRole('button', { name: 'Start from last' }).click();
  await page.getByRole('button', { name: 'Save balance' }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Save balance' }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  releaseResponse();
  await expect(
    page
      .getByRole('region', { name: 'Current balance' })
      .getByText('€1,986.30', { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
});
