import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';

const password = 'correct horse battery staple';

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-followup-e2e-'),
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
  const setup = await page.context().request.post(`${origin}/api/setup`, {
    headers: { Origin: origin },
    data: {
      password,
      passwordConfirmation: password,
      profiles: ['Alex', 'Max'],
    },
  });
  expect(setup.status()).toBe(201);
  const selected = await page
    .context()
    .request.post(`${origin}/api/auth/profile`, {
      headers: { Origin: origin },
      data: { memberId: 1, remember: true },
    });
  expect(selected.status()).toBe(200);
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

/** Opens a check-in with one account to check for Alex. */
async function openCheckin(page: Page): Promise<void> {
  const account = await page.context().request.post(`${origin}/api/accounts`, {
    headers: { Origin: origin },
    data: {
      name: 'Everyday',
      ownerMemberId: 1,
      type: 'bank',
      currency: 'EUR',
      openingBalance: '198630',
    },
  });
  expect(account.status()).toBe(201);
  const opened = await page.context().request.post(`${origin}/api/checkins`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(opened.status()).toBe(201);
}

async function setFollowupDays(page: Page, days: number): Promise<void> {
  const response = await page
    .context()
    .request.patch(`${origin}/api/settings`, {
      headers: { Origin: origin },
      data: { followupDays: days },
    });
  expect(response.status()).toBe(200);
}

test('the follow-up sheet changes how often reminders go out and keeps it', async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/settings`);
  const row = page.getByRole('button', { name: /^Follow-up reminders/u });
  await expect(row).toContainText('To profiles with accounts left');
  await expect(row).toContainText('Every 2 days');

  await row.click();
  const sheet = page.getByRole('dialog', { name: 'Follow-up reminders' });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: 'Every 2 days' }),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Every day', 'Every 3 days', 'Every 7 days', 'Off']) {
    await expect(sheet.getByRole('button', { name })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  }

  await sheet.getByRole('button', { name: 'Every 3 days' }).click();
  await expect(sheet.getByRole('status')).toHaveText(
    'Every 3 days while a check-in is open, a reminder goes to each profile with accounts left. It never shows amounts.',
  );

  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/SettingsFollowUp.png',
      scale: 'css',
    });
  }

  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText('Every 3 days');
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Follow-up reminders/u }),
  ).toContainText('Every 3 days');
});

test('Close discards a change and Off turns reminders off', async ({
  page,
}) => {
  await page.goto(`${origin}/settings`);
  const row = page.getByRole('button', { name: /^Follow-up reminders/u });
  await row.click();
  let sheet = page.getByRole('dialog', { name: 'Follow-up reminders' });
  await sheet.getByRole('button', { name: 'Every day' }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText('Every 2 days');

  await row.click();
  sheet = page.getByRole('dialog', { name: 'Follow-up reminders' });
  await sheet.getByRole('button', { name: 'Off' }).click();
  await expect(sheet.getByRole('status')).toHaveText(
    'No reminders. The banner still shows an open check-in.',
  );
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('Off');
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Follow-up reminders/u }),
  ).toContainText('Off');
});

test('the check-in footer says when the next reminder is due', async ({
  page,
}) => {
  await openCheckin(page);
  await page.goto(`${origin}/check-in`);
  await expect(
    page.getByText(
      'Closes by itself when everyone is in. Next reminder in 2 days.',
      { exact: true },
    ),
  ).toBeVisible();

  await setFollowupDays(page, 1);
  await page.reload();
  await expect(
    page.getByText(
      'Closes by itself when everyone is in. Next reminder tomorrow.',
      { exact: true },
    ),
  ).toBeVisible();

  await setFollowupDays(page, 7);
  await page.reload();
  await expect(
    page.getByText(
      'Closes by itself when everyone is in. Next reminder in 7 days.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('the check-in footer leaves the reminder out when reminders are off', async ({
  page,
}) => {
  await setFollowupDays(page, 0);
  await openCheckin(page);
  await page.goto(`${origin}/check-in`);
  await expect(
    page.getByText('Closes by itself when everyone is in.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Next reminder/u)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close now' })).toBeVisible();
});

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
