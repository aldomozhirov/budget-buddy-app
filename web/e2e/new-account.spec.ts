import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';

let externalRequests: string[] = [];
let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-new-account-e2e-'),
  );
  server = spawn(process.execPath, ['server/dist/index.js'], {
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
  await waitForServer(`${origin}/api/health`, server);

  externalRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  const setup = await page.context().request.post(`${origin}/api/setup`, {
    headers: { Origin: origin },
    data: {
      password: 'correct horse battery staple',
      passwordConfirmation: 'correct horse battery staple',
      profiles: ['Alex', 'Blair'],
    },
  });
  expect(setup.status()).toBe(201);
});

test.afterEach(async () => {
  const requestsMadeOffOrigin = externalRequests;
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => undefined);
  }
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
  server = undefined;
  dataDirectory = undefined;
  expect(requestsMadeOffOrigin).toEqual([]);
});

test('creates an account with today’s opening balance and reads its saved snapshot', async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  if (testInfo.project.name === 'iphone') {
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
    .getByRole('button', { name: 'Opening balance', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByText('€1,986.30', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Opening balance date' }),
  ).toHaveText('Today ▾');

  const createResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounts' &&
      response.request().method() === 'POST',
  );
  const snapshotsResponsePromise = page.waitForResponse(
    (response) =>
      /^\/api\/accounts\/\d+\/snapshots$/u.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === 'GET',
  );
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const { account } = (await createResponse.json()) as {
    account: { id: number; name: string; type: string; currency: string };
  };
  expect(account).toMatchObject({
    name: 'ING Girokonto',
    type: 'bank',
    currency: 'EUR',
  });
  const createBody = createResponse.request().postDataJSON() as Record<
    string,
    unknown
  >;
  expect(createBody).toMatchObject({
    name: 'ING Girokonto',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '198630',
    openingDate: todayInTimeZone('Europe/Berlin'),
  });

  await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}$`, 'u'));
  const snapshotsResponse = await snapshotsResponsePromise;
  expect(new URL(snapshotsResponse.url()).pathname).toBe(
    `/api/accounts/${account.id}/snapshots`,
  );
  expect(snapshotsResponse.status()).toBe(200);
  const { snapshots } = (await snapshotsResponse.json()) as {
    snapshots: Array<{ amount: string; source: string }>;
  };
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({ amount: '198630', source: 'opening' });
});

test('uses the segmented owner choice and submits its selected member', async ({
  page,
}) => {
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();

  const owner = page.getByRole('radiogroup', { name: 'Owner' });
  const alex = owner.getByRole('radio', { name: 'Alex' });
  const blair = owner.getByRole('radio', { name: 'Blair' });
  await expect(alex).toHaveAttribute('aria-checked', 'true');
  await expect(alex).toHaveAttribute('tabindex', '0');
  await alex.press('ArrowRight');
  await expect(blair).toHaveAttribute('aria-checked', 'true');
  await expect(blair).toHaveAttribute('tabindex', '0');
  await blair.press('ArrowRight');
  await expect(alex).toHaveAttribute('aria-checked', 'true');
  await alex.press('ArrowRight');
  await expect(blair).toHaveAttribute('aria-checked', 'true');

  await page.getByLabel('Name').fill('Blair’s savings');
  const createResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounts' &&
      response.request().method() === 'POST',
  );
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const { account } = (await createResponse.json()) as {
    account: { id: number; ownerMemberId: number };
  };
  expect(account.ownerMemberId).toBe(2);
  expect(createResponse.request().postDataJSON()).toMatchObject({
    name: 'Blair’s savings',
    ownerMemberId: 2,
  });
  await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}$`, 'u'));
});

test('shows debt guidance before saving and reads the negative opening snapshot', async ({
  page,
}) => {
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill('Money we owe');
  const debtType = page.getByRole('radio', { name: 'Money we owe' });
  await debtType.click();
  const debtHint = page.getByText(
    'Type what you owe as a positive number. It’s stored as a negative balance.',
  );
  await expect(debtHint).toBeVisible();
  await page
    .getByRole('button', { name: 'Opening balance', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Minus', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');

  // Switching away from debt hides its guidance; switching back restores it.
  await page.getByRole('radio', { name: 'Bank' }).click();
  await expect(debtHint).toHaveCount(0);
  await debtType.click();
  await expect(debtHint).toBeVisible();

  await page.getByRole('button', { name: 'Other currency or coin' }).click();
  const search = page.getByRole('textbox', {
    name: 'Search currencies and coins',
  });
  await search.fill('not a currency or coin');
  await expect(page.getByRole('button', { name: /USDT · Tether/ })).toHaveCount(
    0,
  );
  await search.fill('Tether');
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

  const createResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounts' &&
      response.request().method() === 'POST',
  );
  const snapshotsResponsePromise = page.waitForResponse(
    (response) =>
      /^\/api\/accounts\/\d+\/snapshots$/u.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === 'GET',
  );
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const { account } = (await createResponse.json()) as {
    account: { id: number };
  };
  const createBody = createResponse.request().postDataJSON() as Record<
    string,
    unknown
  >;
  expect(createBody).toMatchObject({
    name: 'Money we owe',
    type: 'we_owe',
    currency: 'EUR',
    openingBalance: '-50000',
  });
  const snapshotsResponse = await snapshotsResponsePromise;
  expect(new URL(snapshotsResponse.url()).pathname).toBe(
    `/api/accounts/${account.id}/snapshots`,
  );
  expect(snapshotsResponse.status()).toBe(200);
  const { snapshots } = (await snapshotsResponse.json()) as {
    snapshots: Array<{ amount: string; source: string }>;
  };
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({ amount: '-50000', source: 'opening' });
});

test('Other currency or coin searches and saves a coin from the full list', async ({
  page,
}) => {
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill('Ethereum wallet');
  await page.getByRole('radio', { name: 'Crypto' }).click();
  await page.getByRole('button', { name: 'Other currency or coin' }).click();
  await page
    .getByRole('textbox', { name: 'Search currencies and coins' })
    .fill('Ethereum');
  await page.getByRole('button', { name: 'ETH · Ethereum' }).click();
  await expect(
    page.getByRole('button', { name: 'ETH', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Other currency or coin' }).click();
  const ethereumOption = page.getByRole('button', { name: 'ETH · Ethereum' });
  await expect(ethereumOption).toHaveAttribute('aria-pressed', 'true');
  await ethereumOption.click();

  const createResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounts' &&
      response.request().method() === 'POST',
  );
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const { account } = (await createResponse.json()) as {
    account: { id: number };
  };
  const createBody = createResponse.request().postDataJSON() as Record<
    string,
    unknown
  >;
  expect(createBody).toMatchObject({
    name: 'Ethereum wallet',
    type: 'crypto',
    currency: 'ETH',
  });
  await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}$`, 'u'));
});

test('keeps the form open and reports an unavailable account service', async ({
  page,
}) => {
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: 'Account service is unavailable.' } },
    }),
  );
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill('Offline account');
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Account service is unavailable.',
  );
  await expect(page).toHaveURL(/\/accounts\/new$/u);
});

test('clears an opening amount when its currency changes', async ({ page }) => {
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill('Japanese account');
  await page
    .getByRole('button', { name: 'Opening balance', exact: true })
    .click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: '0', exact: true }).click();
  await page.getByRole('button', { name: '0', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();

  await page.getByRole('button', { name: 'Other currency or coin' }).click();
  await page
    .getByRole('textbox', { name: 'Search currencies and coins' })
    .fill('Japanese yen');
  await page.getByRole('button', { name: 'JPY · Japanese Yen' }).click();
  await expect(
    page.getByRole('button', { name: 'Opening balance', exact: true }),
  ).toHaveText(/¥0/u);

  const createResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/accounts' &&
      response.request().method() === 'POST',
  );
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createBody = createResponse.request().postDataJSON() as Record<
    string,
    unknown
  >;
  expect(createBody).toMatchObject({ currency: 'JPY' });
  expect(createBody).not.toHaveProperty('openingBalance');
});

test('rejects a negative amount if an account is changed to Money we owe', async ({
  page,
}) => {
  const accountCreateRequests: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/api/accounts' &&
      request.method() === 'POST'
    ) {
      accountCreateRequests.push(request.url());
    }
  });
  await page.goto(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
  await page.getByLabel('Name').fill('Debt account');
  await page
    .getByRole('button', { name: 'Opening balance', exact: true })
    .click();
  const keypad = page.getByRole('dialog').getByRole('group', {
    name: 'Amount keypad',
  });
  await keypad.getByRole('button', { name: 'Minus', exact: true }).click();
  await keypad.getByRole('button', { name: '5', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Money we owe' }).click();
  await page.locator('footer').getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Enter what you owe as a positive number.',
  );
  await expect(page).toHaveURL(/\/accounts\/new$/u);
  expect(accountCreateRequests).toEqual([]);
});

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function availablePort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a port');
  }
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}
