import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
    path.join(os.tmpdir(), 'budget-buddy-back-e2e-'),
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

/** Creates the family and signs the first profile in. */
async function seedFamily(context: BrowserContext): Promise<void> {
  await post(context, '/api/setup', {
    password,
    passwordConfirmation: password,
    profiles: ['Alena', 'Max'],
  });
  await post(context, '/api/auth/profile', { memberId: 1, remember: true });
}

test('/check-in opened with none open has a Back button that returns Home', async ({
  page,
}, testInfo) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/check-in`);
  await expect(
    page.getByRole('heading', { name: 'No check-in is open' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Go to Check-ins' }),
  ).toBeVisible();
  const back = page.getByRole('button', { name: 'Back to home' });
  await expect(back).toBeVisible();
  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/CheckIn-none-open.png',
      scale: 'css',
    });
  }
  const box = await back.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.y).toBeGreaterThanOrEqual(0);
  await back.click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
});

test('the check-in screen’s load-error state has a Back button that works', async ({
  page,
}, testInfo) => {
  await seedFamily(page.context());
  await page.route('**/api/checkins/current', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.goto(`${origin}/check-in`);
  await expect(page.getByRole('alert')).toContainText(
    'Could not load the check-in.',
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/CheckIn-load-error.png',
      scale: 'css',
    });
  }
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(`${origin}/`);
});

test('the check-in screen’s loading state has a Back button that works', async ({
  page,
}) => {
  await seedFamily(page.context());
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/checkins/current', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${origin}/check-in`, { waitUntil: 'commit' });
  await expect(page.getByText('Loading check-in…')).toBeVisible();
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(`${origin}/`);
  release();
});

/** Screens and states that once had no way back (sweep of 2026-10-13). */
const states: {
  name: string;
  path: string;
  failing?: string;
  parent: string;
  back: string;
}[] = [
  {
    name: 'Account not found',
    path: '/accounts/9999',
    parent: '/accounts',
    back: 'Back to accounts',
  },
  {
    name: 'Account load error',
    path: '/accounts/9999',
    failing: '**/api/accounts/9999*',
    parent: '/accounts',
    back: 'Back to accounts',
  },
  {
    name: 'Summary not found',
    path: '/check-ins/9999',
    parent: '/check-ins',
    back: 'Back to check-ins',
  },
  {
    name: 'Check-ins load error',
    path: '/check-ins',
    failing: '**/api/checkins',
    parent: '/',
    back: 'Back to home',
  },
  {
    name: 'Accounts load error',
    path: '/accounts',
    failing: '**/api/accounts',
    parent: '/',
    back: 'Back to home',
  },
  {
    name: 'New account load error',
    path: '/accounts/new',
    failing: '**/api/members',
    parent: '/accounts',
    back: 'Back to accounts',
  },
  {
    name: 'Settings load error',
    path: '/settings',
    failing: '**/api/members',
    parent: '/',
    back: 'Back to home',
  },
];

for (const state of states) {
  test(`${state.name} has a Back button that works`, async ({ page }) => {
    await seedFamily(page.context());
    if (state.failing) {
      await page.route(state.failing, (route) =>
        route.fulfill({ status: 503, json: { error: 'unavailable' } }),
      );
    }
    await page.goto(`${origin}${state.path}`);
    const back = page.getByRole('button', { name: state.back });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(`${origin}${state.parent}`);
  });
}

async function post(
  context: BrowserContext,
  url: string,
  data: unknown,
): Promise<{ account: { id: number }; checkin: { id: number } }> {
  const response = await context.request.post(`${origin}${url}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.status(), `POST ${url}`).toBeLessThan(300);
  return response.json();
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
