import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path, { resolve } from 'node:path';
import process from 'node:process';

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
  {
    id: 6,
    name: 'Car loan',
    ownerMemberId: 1,
    ownerName: 'Alex',
    ownerActive: true,
    type: 'we_owe',
    currency: 'EUR',
    active: true,
    deactivatedAt: null,
    balance: '-640000',
    balanceTakenAt: Date.parse('2026-09-01T12:00:00Z'),
    balanceSource: 'checkin',
    balanceUpdatedBy: 1,
    stale: true,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
    updatedAt: 1,
  },
  {
    id: 7,
    name: 'Loan to a friend',
    ownerMemberId: 1,
    ownerName: 'Alex',
    ownerActive: true,
    type: 'owed_to_us',
    currency: 'EUR',
    active: true,
    deactivatedAt: null,
    balance: '50000',
    balanceTakenAt: Date.parse('2026-09-20T12:00:00Z'),
    balanceSource: 'manual',
    balanceUpdatedBy: 1,
    stale: false,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
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

test('filters accounts by owner and groups them by profile', async ({
  page,
}, testInfo) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yours' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Max’s' })).toBeVisible();
  const ownerTrack = page.getByRole('tablist', { name: 'Owner' });
  const ownerTabs = ownerTrack.getByRole('tab');
  await expect(ownerTabs).toHaveText(['Everyone', 'You', 'Max', 'Sofia']);
  for (const label of ['Everyone', 'You', 'Max', 'Sofia']) {
    const tab = ownerTrack.getByRole('tab', { name: label, exact: true });
    const visibleLabel = tab.getByText(label, { exact: true });
    await expect(visibleLabel).toBeVisible();
    const labelLayer = await visibleLabel.evaluate(
      (element) => Number(getComputedStyle(element).zIndex),
    );
    const pillLayer = await tab.evaluate(
      (element) => Number(getComputedStyle(element, '::before').zIndex),
    );
    expect(labelLayer).toBeGreaterThan(pillLayer);
    expect((await tab.boundingBox())?.height).toBe(44);
  }
  await expect(
    ownerTrack.getByRole('tab', { name: 'Everyone', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const trackBounds = await ownerTrack.boundingBox();
  expect(trackBounds?.height).toBe(42);
  expect(trackBounds?.y).toBe(104);
  const firstAccountBounds = await page
    .getByRole('link', { name: /ING Girokonto · EUR/ })
    .boundingBox();
  expect(Math.round(firstAccountBounds?.y ?? Number.NaN)).toBe(232);

  if (testInfo.project.name === 'iphone') {
    const screenshotDirectory = resolve('test-results/screens');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, 'Accounts.png'),
      scale: 'css',
    });
  }

  const maxRequest = page.waitForRequest(/\/api\/accounts\?owner=2/u);
  await page.getByRole('tab', { name: 'Max' }).click();
  await maxRequest;
  await expect(page.getByRole('heading', { name: 'Max’s' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yours' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /Max savings · USD/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /ING Girokonto/ })).toHaveCount(
    0,
  );

  const youRequest = page.waitForRequest(/\/api\/accounts\?owner=1/u);
  await page.getByRole('tab', { name: 'You' }).click();
  await youRequest;
  await expect(
    page.getByRole('link', { name: /ING Girokonto · EUR/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Max savings/ })).toHaveCount(0);

  const sofiaRequest = page.waitForRequest(/\/api\/accounts\?owner=3/u);
  await page.getByRole('tab', { name: 'Sofia' }).click();
  await sofiaRequest;
  await expect(
    page.getByText('No accounts match these filters.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yours' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Max’s' })).toHaveCount(0);
});

test('filters accounts by type and currency', async ({ page }) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Yours' })).toBeVisible();

  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Cash' }).click();
  await expect(
    page.getByRole('link', { name: /Cash EUR · EUR/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Cash USD · USD/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /ING Girokonto/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('link', { name: /Max savings/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'USD' }).click();
  await expect(
    page.getByRole('link', { name: /Cash USD · USD/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Cash EUR · EUR/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('link', { name: /ING Girokonto/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('link', { name: /Max savings/ })).toHaveCount(0);
});

test('shows inactive accounts only when requested', async ({ page }) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Yours' })).toBeVisible();
  const inactiveAccount = page.getByRole('link', { name: /Max old account/ });
  await expect(inactiveAccount).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Show inactive' }),
  ).toHaveAttribute('aria-pressed', 'false');

  const showInactiveRequest = page.waitForRequest(
    /\/api\/accounts\?inactive=true/u,
  );
  await page.getByRole('button', { name: 'Show inactive' }).click();
  await showInactiveRequest;
  await expect(inactiveAccount).toBeVisible();
  await expect(inactiveAccount.getByText('Inactive')).toBeVisible();

  const hideInactiveRequest = page.waitForRequest(/\/api\/accounts$/u);
  await page.getByRole('button', { name: 'Show inactive' }).click();
  await hideInactiveRequest;
  await expect(inactiveAccount).toHaveCount(0);
});

test('marks old balances stale and labels balance details', async ({
  page,
}) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Yours' })).toBeVisible();
  const staleCash = page.getByRole('link', { name: /Cash EUR · EUR/ });
  await expect(staleCash).toContainText('Cash · By hand 01/09/2026');
  await expect(staleCash).toContainText('€240.00');
  await expect(staleCash.getByText('Stale')).toBeVisible();
  const staleRowBounds = await staleCash.boundingBox();
  expect(staleRowBounds?.height).toBe(65);
  await expect(page.getByRole('link', { name: /Car loan · EUR/ })).toContainText(
    'We owe · Check-in 01/09/2026',
  );
  await expect(
    page.getByRole('link', { name: /Loan to a friend · EUR/ }),
  ).toContainText('Owed to us · By hand 20/09/2026');

  const freshCash = page.getByRole('link', { name: /Cash USD · USD/ });
  await expect(freshCash).toContainText('Cash · Opening 07/10/2026');
  await expect(freshCash.getByText('Stale')).toHaveCount(0);
  await expect(
    page.getByText(
      'Stale means the balance is older than the monthly check-in.',
    ),
  ).toBeVisible();

  const negativeAmount = page.getByText('−€6,400.00', { exact: true });
  const warningColor = await staleCash
    .getByText('Stale')
    .evaluate((element) => getComputedStyle(element).color);
  await expect(negativeAmount).toHaveCSS('color', warningColor);
});

test('marks a real account stale when its balance exceeds the cadence', async ({
  page,
}) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-accounts-stale-e2e-'),
  );
  const server = spawn(process.execPath, ['server/dist/index.js'], {
    env: {
      ...process.env,
      APP_ORIGIN: origin,
      BACKUP_DIR: path.join(dataDirectory, 'backups'),
      DATA_DIR: dataDirectory,
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      PORT: String(port),
      RATES_FEED: 'fixture',
    },
    stdio: 'ignore',
  });

  try {
    await waitForServer(`${origin}/api/health`, server);
    const api = page.context().request;
    const setup = await api.post(`${origin}/api/setup`, {
      headers: { Origin: origin },
      data: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alex'],
      },
    });
    expect(setup.status()).toBe(201);

    // Cadence settings are not exposed by the current API.
    const Sqlite = createRequire(path.resolve('server/package.json'))(
      'better-sqlite3',
    ) as new (filePath: string) => {
      prepare(sql: string): { run(): unknown };
      close(): void;
    };
    const database = new Sqlite(path.join(dataDirectory, 'budget-buddy.sqlite'));
    database
      .prepare("UPDATE family SET cadence_kind = 'monthly' WHERE id = 1")
      .run();
    database.close();

    const staleCreation = await api.post(`${origin}/api/accounts`, {
      headers: { Origin: origin },
      data: {
        name: 'Old balance',
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '12000',
        openingDate: dateDaysAgo(60),
      },
    });
    expect(staleCreation.status()).toBe(201);
    const freshCreation = await api.post(`${origin}/api/accounts`, {
      headers: { Origin: origin },
      data: {
        name: 'Current balance',
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '24000',
      },
    });
    expect(freshCreation.status()).toBe(201);

    const response = await api.get(`${origin}/api/accounts`);
    expect(response.status()).toBe(200);
    const { accounts: serverAccounts } = (await response.json()) as {
      accounts: Array<{ name: string; stale: boolean }>;
    };
    expect(serverAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Old balance', stale: true }),
        expect.objectContaining({ name: 'Current balance', stale: false }),
      ]),
    );

    await page.goto(`${origin}/accounts`);
    const staleAccount = page.getByRole('link', { name: /Old balance · EUR/ });
    await expect(staleAccount.getByText('Stale')).toBeVisible();
    const freshAccount = page.getByRole('link', {
      name: /Current balance · EUR/,
    });
    await expect(freshAccount.getByText('Stale')).toHaveCount(0);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit').catch(() => undefined);
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

function dateDaysAgo(days: number): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(
    Date.UTC(getPart('year'), getPart('month') - 1, getPart('day') - days),
  )
    .toISOString()
    .slice(0, 10);
}

async function availablePort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a port');
  }
  await new Promise<void>((resolvePromise, reject) =>
    listener.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}
