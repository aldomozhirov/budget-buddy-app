import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type BrowserContext } from '@playwright/test';

const password = 'correct horse battery staple';

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-checkin-e2e-'),
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async () => {
  const requestsMadeOffOrigin = externalRequests;
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => undefined);
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  server = undefined;
  dataDirectory = undefined;
  expect(requestsMadeOffOrigin).toEqual([]);
});

test('profiles save balances together, close automatically, and return from summary home', async ({
  browser,
  page,
}, testInfo) => {
  const contextA = page.context();
  const contextB = await browser.newContext({
    viewport:
      testInfo.project.name === 'iphone'
        ? { width: 390, height: 844 }
        : { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const pageB = await contextB.newPage();
  pageB.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  try {
    await setupFamily(contextA, ['Alex', 'Blair'], 1);
    await signInProfile(contextB, 2);
    await createAccount(contextA, 'Alex Everyday', 1, '198630');
    await createAccount(contextA, 'Alex Savings', 1, '214055');
    await createAccount(contextA, 'Alex Wallet', 1, '5000');
    await createAccount(contextA, 'Blair Everyday', 2, '95400');
    await createAccount(contextA, 'Blair Savings', 2, '42000');
    const opened = await contextA.request.post(`${origin}/api/checkins`, {
      headers: { Origin: origin },
      data: {},
    });
    expect(opened.status()).toBe(201);

    await page.goto(`${origin}/check-in`);
    await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
    await expect(
      page.getByText(/^Started by Alex today, \d{2}:\d{2}$/u),
    ).toBeVisible();
    const memberTabsA = page.getByRole('tablist', { name: 'Whose accounts' });
    await expect(
      memberTabsA.getByRole('tab', { name: 'You 3 left' }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('0 of 5', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your accounts to check · 3' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('button', {
          name: 'Enter new balance for Alex Everyday EUR',
        })
        .getByText(/^Last €1,986\.30 on \d{2}\/\d{2}\/\d{4}$/u),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Closes by itself when everyone is in. Next reminder in 2 days.',
        { exact: true },
      ),
    ).toBeVisible();

    if (testInfo.project.name === 'iphone') {
      await mkdir('test-results/screens', { recursive: true });
      await page.screenshot({
        path: 'test-results/screens/CheckIn.png',
        scale: 'css',
      });
    }

    await page
      .getByRole('button', { name: 'Alex Everyday EUR unchanged' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Your accounts to check · 2' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Enter new balance for Alex Savings EUR' })
      .click();
    const amountGroup = page.getByRole('group', {
      name: 'New balance for Alex Savings',
    });
    const amountSheet = page.getByRole('dialog', {
      name: 'New balance for Alex Savings',
    });
    await expect(
      amountSheet.getByRole('button', { name: 'Start from last' }),
    ).toBeVisible();
    await expect(
      amountSheet.getByRole('button', { name: 'Unchanged', exact: true }),
    ).toBeVisible();
    await amountSheet.getByRole('button', { name: 'Start from last' }).click();
    await expect(
      amountGroup.getByText('€2,140.55', { exact: true }),
    ).toBeVisible();
    await amountSheet.getByRole('button', { name: 'Plus' }).click();
    for (const digit of ['1', '2', '0']) {
      await amountSheet
        .getByRole('button', { name: digit, exact: true })
        .click();
    }
    await expect(
      amountGroup.getByText('€2,260.55', { exact: true }),
    ).toBeVisible();
    await amountSheet.getByRole('button', { name: 'Save & next' }).click();
    await expect(
      page.getByRole('dialog', { name: 'New balance for Alex Wallet' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Enter an amount' }),
    ).toBeDisabled();

    await pageB.goto(`${origin}/check-in`);
    await expect(
      pageB.getByRole('heading', { name: 'Check-in' }),
    ).toBeVisible();
    await pageB.reload();
    const memberTabsB = pageB.getByRole('tablist', { name: 'Whose accounts' });
    const alexTab = memberTabsB.getByRole('tab', { name: 'Alex 1 left' });
    await expect(alexTab).toBeVisible();
    await expect(alexTab).not.toHaveAttribute('aria-selected', 'true');
    await expect(
      pageB.getByRole('heading', { name: 'Your accounts to check · 2' }),
    ).toBeVisible();

    await pageB
      .getByRole('button', { name: 'Blair Everyday EUR unchanged' })
      .click();
    await expect(
      pageB.getByRole('heading', { name: 'Your accounts to check · 1' }),
    ).toBeVisible();
    await pageB
      .getByRole('button', { name: 'Blair Savings EUR unchanged' })
      .click();
    await expect(
      pageB.getByText('Your accounts are in', { exact: true }),
    ).toBeVisible();
    await expect(
      memberTabsB.getByRole('tab', { name: 'You Done' }),
    ).toBeVisible();
    await expect(
      pageB.getByRole('button', { name: 'Fill in Alex’s' }),
    ).toBeVisible();
    await pageB.getByRole('button', { name: 'Fill in Alex’s' }).click();
    await expect(
      memberTabsB.getByRole('tab', { name: 'Alex 1 left' }),
    ).toHaveAttribute('aria-selected', 'true');
    const alexSavings = pageB.getByRole('button', {
      name: 'Change balance of Alex Savings EUR',
    });
    await expect(alexSavings).toContainText('€2,260.55');
    await expect(alexSavings).toContainText('▲ €120.00');
    await pageB
      .getByRole('button', { name: 'Alex Wallet EUR unchanged' })
      .click();
    await expect(
      pageB.getByRole('heading', { name: 'Check-in complete' }),
    ).toBeVisible();
    await expect(
      pageB.getByRole('button', { name: 'See summary' }),
    ).toBeVisible();
    await expect(
      pageB.getByRole('button', { name: 'Back home' }),
    ).toBeVisible();

    await pageB.getByRole('button', { name: 'See summary' }).click();
    await expect(
      pageB.getByRole('heading', { name: 'Check-in summary' }),
    ).toBeVisible();
    const backToHome = pageB.getByRole('button', { name: 'Back to home' });
    await expect(backToHome).toBeVisible();
    await backToHome.click();
    await expect(
      pageB.getByRole('heading', { name: 'Hi, Blair' }),
    ).toBeVisible();
  } finally {
    await contextB.close();
  }
});

test('Close now explains carried-forward accounts and Keep it open preserves the check-in', async ({
  page,
}) => {
  await setupFamily(page.context(), ['Alex', 'Blair'], 1);
  for (let index = 1; index <= 4; index += 1) {
    await createAccount(page.context(), `Account ${index}`, 1, `${index}0000`);
  }
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);

  await page.goto(`${origin}/check-in`);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Account 1 EUR unchanged' }).click();
  await page.getByRole('button', { name: 'Close now' }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Close the check-in now?',
  });
  await expect(confirmation).toContainText(
    '3 accounts without a value will keep the last balance, marked as “wasn’t changed”.',
  );
  await confirmation.getByRole('button', { name: 'Keep it open' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close now' })).toBeVisible();
});

test('a failed save leaves its row pending and offers Try again', async ({
  page,
}) => {
  await setupFamily(page.context(), ['Alex'], 1);
  await createAccount(page.context(), 'Emergency fund', 1, '123450');
  await createAccount(page.context(), 'Cash', 1, '5000');
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);

  let failedOnce = false;
  await page.route('**/api/checkins/*/values/*', async (route) => {
    if (!failedOnce && route.request().method() === 'PUT') {
      failedOnce = true;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'temporarily_unavailable' } },
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`${origin}/check-in`);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Emergency fund EUR unchanged' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Could not save this balance. Try again.',
  );
  await expect(
    page.getByRole('button', {
      name: 'Enter new balance for Emergency fund EUR',
    }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Change balance of Emergency fund EUR' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(failedOnce).toBe(true);
});

test('a failed edit of a completed row marks it not saved and can be retried', async ({
  page,
}) => {
  await setupFamily(page.context(), ['Alex'], 1);
  await createAccount(page.context(), 'Emergency fund', 1, '123450');
  await createAccount(page.context(), 'Cash', 1, '5000');
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);

  await page.goto(`${origin}/check-in`);
  await page
    .getByRole('button', { name: 'Emergency fund EUR unchanged' })
    .click();

  let failedOnce = false;
  await page.route('**/api/checkins/*/values/*', async (route) => {
    if (!failedOnce && route.request().method() === 'PUT') {
      failedOnce = true;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'temporarily_unavailable' } },
      });
      return;
    }
    await route.continue();
  });
  const completedRow = page.getByRole('button', {
    name: 'Change balance of Emergency fund EUR',
  });
  await expect(completedRow).toContainText('€1,234.50');
  await completedRow.click();

  const amountSheet = page.getByRole('dialog', {
    name: 'New balance for Emergency fund',
  });
  await amountSheet.getByRole('button', { name: 'Start from last' }).click();
  await amountSheet.getByRole('button', { name: 'Plus' }).click();
  for (const digit of ['1', '2', '0']) {
    await amountSheet.getByRole('button', { name: digit, exact: true }).click();
  }
  await amountSheet.getByRole('button', { name: 'Save & next' }).click();

  await expect(completedRow).toContainText('Not saved');
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Could not save this balance. Try again.',
  );
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(completedRow).toContainText('€1,354.50');
  await expect(completedRow).toContainText('▲ €120.00');
  await expect(completedRow).not.toContainText('Not saved');
  expect(failedOnce).toBe(true);
});

test.describe('currency metadata failure', () => {
  test.use({ serviceWorkers: 'block' });

  test('keeps raw minor units hidden and can recover', async ({ page }) => {
    await setupFamily(page.context(), ['Alex'], 1);
    await createAccount(page.context(), 'Emergency fund', 1, '123450');
    const opened = await page.context().request.post(`${origin}/api/checkins`, {
      headers: { Origin: origin },
      data: {},
    });
    expect(opened.status()).toBe(201);

    let failMetadata = true;
    let metadataFailureInjected = false;
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/currencies') {
        if (failMetadata) {
          metadataFailureInjected = true;
          await route.fulfill({
            status: 503,
            json: { error: { code: 'temporarily_unavailable' } },
          });
          return;
        }
      }
      await route.continue();
    });
    await page.goto(`${origin}/check-in`);
    await expect(page.getByRole('alert')).toHaveText(
      'Could not load the check-in. Check your connection and try again.',
    );
    expect(metadataFailureInjected).toBe(true);
    await expect(page.getByText('123450', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Enter new balance for Emergency fund EUR',
      }),
    ).toHaveCount(0);

    failMetadata = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: 'Enter new balance for Emergency fund EUR',
      }),
    ).toContainText('Last €1,234.50');
    await page
      .getByRole('button', { name: 'Enter new balance for Emergency fund EUR' })
      .click();
    const amountSheet = page.getByRole('dialog', {
      name: 'New balance for Emergency fund',
    });
    await amountSheet.getByRole('button', { name: 'Start from last' }).click();
    await expect(
      page
        .getByRole('group', { name: 'New balance for Emergency fund' })
        .getByText('€1,234.50', { exact: true }),
    ).toBeVisible();
    await expect(
      amountSheet.getByRole('button', { name: 'Save & next' }),
    ).toBeEnabled();
  });
});

test('focus refresh after another profile saves preserves the open amount draft', async ({
  browser,
  page,
}, testInfo) => {
  const contextA = page.context();
  const contextB = await browser.newContext({
    viewport:
      testInfo.project.name === 'iphone'
        ? { width: 390, height: 844 }
        : { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const pageB = await contextB.newPage();
  pageB.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  try {
    await setupFamily(contextA, ['Alex', 'Blair'], 1);
    await signInProfile(contextB, 2);
    await createAccount(contextA, 'Alex Savings', 1, '214055');
    await createAccount(contextA, 'Alex Wallet', 1, '5000');
    await createAccount(contextA, 'Blair Everyday', 2, '95400');
    const opened = await contextA.request.post(`${origin}/api/checkins`, {
      headers: { Origin: origin },
      data: {},
    });
    expect(opened.status()).toBe(201);

    await page.goto(`${origin}/check-in`);
    await page
      .getByRole('button', { name: 'Enter new balance for Alex Savings EUR' })
      .click();
    const amountSheet = page.getByRole('dialog', {
      name: 'New balance for Alex Savings',
    });
    const amountGroup = page.getByRole('group', {
      name: 'New balance for Alex Savings',
    });
    await amountSheet.getByRole('button', { name: 'Start from last' }).click();
    await amountSheet.getByRole('button', { name: 'Plus' }).click();
    for (const digit of ['1', '2', '0']) {
      await amountSheet
        .getByRole('button', { name: digit, exact: true })
        .click();
    }
    await expect(
      amountGroup.getByText('€2,260.55', { exact: true }),
    ).toBeVisible();

    await pageB.goto(`${origin}/check-in`);
    await pageB
      .getByRole('button', { name: 'Blair Everyday EUR unchanged' })
      .click();
    await expect(
      pageB.getByRole('tablist', { name: 'Whose accounts' }).getByRole('tab', {
        name: 'You Done',
      }),
    ).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('tablist', { name: 'Whose accounts' }).getByRole('tab', {
        name: 'Blair Done',
      }),
    ).toBeVisible();
    await expect(amountSheet).toBeVisible();
    await expect(
      amountGroup.getByText('€2,260.55', { exact: true }),
    ).toBeVisible();
    await expect(
      amountSheet.getByRole('button', { name: 'Save & next' }),
    ).toBeEnabled();
  } finally {
    await contextB.close();
  }
});

test('a stale focus refresh cannot overwrite a save that closes the check-in', async ({
  page,
}) => {
  await setupFamily(page.context(), ['Alex'], 1);
  await createAccount(page.context(), 'Reserve', 1, '123450');
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);

  let capturedResolve!: () => void;
  let releaseResolve!: () => void;
  let currenciesCapturedResolve!: () => void;
  let releaseCurrenciesResolve!: () => void;
  let staleRefreshUrl = '';
  let currenciesRefreshUrl = '';
  let holdCurrenciesRefresh = false;
  const staleCaptured = new Promise<void>((resolve) => {
    capturedResolve = resolve;
  });
  const releaseStale = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  const currenciesCaptured = new Promise<void>((resolve) => {
    currenciesCapturedResolve = resolve;
  });
  const releaseCurrencies = new Promise<void>((resolve) => {
    releaseCurrenciesResolve = resolve;
  });
  await page.route('**/api/checkins/*', async (route) => {
    const request = route.request();
    if (
      request.method() === 'GET' &&
      /^\/api\/checkins\/\d+$/u.test(new URL(request.url()).pathname)
    ) {
      staleRefreshUrl = request.url();
      const response = await route.fetch();
      const body = await response.body();
      capturedResolve();
      await releaseStale;
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body,
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/currencies', async (route) => {
    if (!holdCurrenciesRefresh) {
      await route.continue();
      return;
    }
    holdCurrenciesRefresh = false;
    currenciesRefreshUrl = route.request().url();
    const response = await route.fetch();
    const body = await response.body();
    currenciesCapturedResolve();
    await releaseCurrencies;
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body,
    });
  });

  try {
    await page.goto(`${origin}/check-in`);
    await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
    holdCurrenciesRefresh = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await Promise.all([staleCaptured, currenciesCaptured]);

    await page.getByRole('button', { name: 'Reserve EUR unchanged' }).click();
    await expect(
      page.getByRole('heading', { name: 'Check-in complete' }),
    ).toBeVisible();

    const staleRefreshResponsePromise = page.waitForResponse(
      (response) =>
        response.url() === staleRefreshUrl &&
        response.request().method() === 'GET',
    );
    const currenciesRefreshResponsePromise = page.waitForResponse(
      (response) =>
        response.url() === currenciesRefreshUrl &&
        response.request().method() === 'GET',
    );
    releaseResolve();
    releaseCurrenciesResolve();
    const [staleRefreshResponse, currenciesRefreshResponse] = await Promise.all(
      [staleRefreshResponsePromise, currenciesRefreshResponsePromise],
    );
    expect(staleRefreshResponse.status()).toBe(200);
    expect(currenciesRefreshResponse.status()).toBe(200);
    expect(await staleRefreshResponse.finished()).toBeNull();
    expect(await currenciesRefreshResponse.finished()).toBeNull();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole('heading', { name: 'Check-in complete' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'See summary' }),
    ).toBeVisible();
  } finally {
    releaseResolve();
    releaseCurrenciesResolve();
  }
});

test('the current profile is selected on first load even with an Unassigned tab', async ({
  page,
}) => {
  await setupFamily(page.context(), ['Alex', 'Blair'], 1);
  await createAccount(page.context(), 'Alex’s account', 1, '123450');
  await createAccount(page.context(), 'Shared account', null, '5000');
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);

  await page.goto(`${origin}/check-in`);
  const memberTabs = page.getByRole('tablist', { name: 'Whose accounts' });
  await expect(
    memberTabs.getByRole('tab', { name: 'You 1 left' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    memberTabs.getByRole('tab', { name: 'Unassigned 1 left' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your accounts to check · 1' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Enter new balance for Alex’s account EUR',
    }),
  ).toBeVisible();
});

test('a profile without accounts is prompted to create one at New account', async ({
  page,
}) => {
  await setupFamily(page.context(), ['Alex', 'Blair'], 1);
  await createAccount(page.context(), 'Blair’s account', 2, '9000');
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);

  await page.goto(`${origin}/check-in`);
  await expect(
    page.getByRole('heading', { name: 'No accounts yet' }),
  ).toBeVisible();
  await expect(
    page.getByText('Add an account to take part in the check-in.'),
  ).toBeVisible();
  const createAccountLink = page.getByRole('link', {
    name: 'Create an account',
  });
  await expect(createAccountLink).toHaveAttribute('href', '/accounts/new');
  await createAccountLink.click();
  await expect(page).toHaveURL(`${origin}/accounts/new`);
  await expect(
    page.getByRole('heading', { name: 'New account' }),
  ).toBeVisible();
});

async function setupFamily(
  context: BrowserContext,
  profiles: string[],
  memberId: number,
): Promise<void> {
  const response = await context.request.post(`${origin}/api/setup`, {
    headers: { Origin: origin },
    data: {
      password,
      passwordConfirmation: password,
      profiles,
    },
  });
  expect(response.status()).toBe(201);
  await selectProfile(context, memberId);
}

async function signInProfile(
  context: BrowserContext,
  memberId: number,
): Promise<void> {
  const response = await context.request.post(`${origin}/api/auth/sign-in`, {
    headers: { Origin: origin },
    data: { password },
  });
  expect(response.status()).toBe(200);
  await selectProfile(context, memberId);
}

async function selectProfile(
  context: BrowserContext,
  memberId: number,
): Promise<void> {
  const response = await context.request.post(`${origin}/api/auth/profile`, {
    headers: { Origin: origin },
    data: { memberId, remember: true },
  });
  expect(response.status()).toBe(200);
}

async function createAccount(
  context: BrowserContext,
  name: string,
  ownerMemberId: number | null,
  openingBalance: string,
): Promise<void> {
  const response = await context.request.post(`${origin}/api/accounts`, {
    headers: { Origin: origin },
    data: {
      name,
      ownerMemberId,
      type: 'bank',
      currency: 'EUR',
      openingBalance,
    },
  });
  expect(response.status()).toBe(201);
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
