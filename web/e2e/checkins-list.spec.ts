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
    path.join(os.tmpdir(), 'budget-buddy-checkins-list-e2e-'),
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

test('an open check-in shows its time and each member’s remaining progress', async ({
  browser,
  page,
}, testInfo) => {
  const ownerContext = page.context();
  await setupFamily(ownerContext, ['Alex', 'Max', 'Sofia'], 1);
  await createAccount(ownerContext, 'Alex current', 1);
  const maxAccount = await createAccount(ownerContext, 'Max current', 2);
  await createAccount(ownerContext, 'Sofia current', 3);

  const started = await ownerContext.request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(started.status()).toBe(201);
  const checkinId = (await started.json()).checkin.id as number;

  const maxContext = await browser.newContext({
    viewport:
      testInfo.project.name === 'iphone'
        ? { width: 390, height: 844 }
        : { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  addExternalRequestGuard(maxContext);
  try {
    await signInProfile(maxContext, 2);
    const saved = await maxContext.request.put(
      `${origin}/api/checkins/${checkinId}/values/${maxAccount}`,
      {
        headers: { Origin: origin },
        data: { same: true },
      },
    );
    expect(saved.status()).toBe(200);

    await page.goto(`${origin}/check-ins`);
    await expect(
      page.getByRole('heading', { name: 'Check-ins', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/^Open now · since .+, \d{2}:\d{2}$/u),
    ).toBeVisible();
    await expect(
      page.getByText('1 of 3 accounts · you 1 left · Max done · Sofia 1 left', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('progressbar', { name: 'Check-in progress' }),
    ).toHaveAttribute('aria-valuenow', '1');

    await expectDeferredTask22And24ContentAbsent(page);
    await expect(page.getByText('No closed check-ins yet.')).toBeVisible();

    if (testInfo.project.name === 'iphone') {
      await mkdir('test-results/screens', { recursive: true });
      await page.screenshot({
        path: 'test-results/screens/CheckIns.png',
        scale: 'css',
      });
    }
  } finally {
    await maxContext.close();
  }
});

test('starting from an empty list creates and opens a check-in', async ({
  page,
}) => {
  const context = page.context();
  await setupFamily(context, ['Alex'], 1);
  await createAccount(context, 'Everyday account', 1);

  await page.goto(`${origin}/check-ins`);
  await expect(
    page.getByRole('heading', { name: 'Check-ins', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start a check-in now' }),
  ).toBeVisible();
  await expect(page.getByText('Everyone gets a notification.')).toBeVisible();
  await expect(page.getByText('No closed check-ins yet.')).toBeVisible();
  await expectDeferredTask22And24ContentAbsent(page);

  await page.route('**/api/checkins', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Start a check-in now' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Could not start a check-in. Check your connection and try again.',
  );
  await expect(page).toHaveURL(`${origin}/check-ins`);
  await page.unroute('**/api/checkins');

  await page.getByRole('button', { name: 'Start a check-in now' }).click();
  await expect(page).toHaveURL(`${origin}/check-in`);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  const current = await context.request.get(`${origin}/api/checkins/current`);
  expect(current.status()).toBe(200);
  expect((await current.json()).checkin).not.toBeNull();
});

test('closed rows show the date, closer and carried-forward count', async ({
  page,
}) => {
  const context = page.context();
  await setupFamily(context, ['Alex'], 1);
  const accountId = await createAccount(context, 'Everyday account', 1);

  const manuallyClosed = await startCheckin(context);
  const closeResponse = await context.request.post(
    `${origin}/api/checkins/${manuallyClosed}/close`,
    { headers: { Origin: origin }, data: {} },
  );
  expect(closeResponse.status()).toBe(200);

  const automaticallyClosed = await startCheckin(context);
  const saved = await context.request.put(
    `${origin}/api/checkins/${automaticallyClosed}/values/${accountId}`,
    { headers: { Origin: origin }, data: { same: true } },
  );
  expect(saved.status()).toBe(200);

  await page.goto(`${origin}/check-ins`);
  const manualRow = page.getByRole('link', {
    name: /\d{2}\/\d{2}\/\d{4} · Alex closed it · 1 wasn’t changed/u,
  });
  const automaticRow = page.getByRole('link', {
    name: /\d{2}\/\d{2}\/\d{4} · Closed by itself · everyone in/u,
  });
  await expect(manualRow).toBeVisible();
  await expect(automaticRow).toBeVisible();
  await expect(
    page.getByText(/^\d{2}\/\d{2}\/\d{4}$/u),
  ).toHaveCount(2);
  await expectDeferredTask22And24ContentAbsent(page);
  await expect(manualRow.getByRole('button')).toHaveCount(0);
  await expect(automaticRow.getByRole('button')).toHaveCount(0);
  await expect(page.getByText(/€|▲|▼|family total in/u)).toHaveCount(0);
});

async function expectDeferredTask22And24ContentAbsent(
  page: import('@playwright/test').Page,
): Promise<void> {
  await expect(page.getByText('Monthly on the 5th, 09:00')).toHaveCount(0);
  await expect(page.getByText(/Next scheduled/u)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /show|hide|reveal|amount|total|eye/iu }),
  ).toHaveCount(0);
}

async function setupFamily(
  context: BrowserContext,
  profiles: string[],
  memberId: number,
): Promise<void> {
  const response = await context.request.post(`${origin}/api/setup`, {
    headers: { Origin: origin },
    data: { password, passwordConfirmation: password, profiles },
  });
  expect(response.status()).toBe(201);
  const selected = await context.request.post(`${origin}/api/auth/profile`, {
    headers: { Origin: origin },
    data: { memberId, remember: true },
  });
  expect(selected.status()).toBe(200);
}

async function signInProfile(
  context: BrowserContext,
  memberId: number,
): Promise<void> {
  const signedIn = await context.request.post(`${origin}/api/auth/sign-in`, {
    headers: { Origin: origin },
    data: { password },
  });
  expect(signedIn.status()).toBe(200);
  const selected = await context.request.post(`${origin}/api/auth/profile`, {
    headers: { Origin: origin },
    data: { memberId, remember: true },
  });
  expect(selected.status()).toBe(200);
}

async function createAccount(
  context: BrowserContext,
  name: string,
  ownerMemberId: number,
): Promise<number> {
  const response = await context.request.post(`${origin}/api/accounts`, {
    headers: { Origin: origin },
    data: {
      name,
      ownerMemberId,
      type: 'bank',
      currency: 'EUR',
      openingBalance: '10000',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).account.id as number;
}

async function startCheckin(context: BrowserContext): Promise<number> {
  const response = await context.request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(response.status()).toBe(201);
  return (await response.json()).checkin.id as number;
}

function addExternalRequestGuard(context: BrowserContext): void {
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });
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
