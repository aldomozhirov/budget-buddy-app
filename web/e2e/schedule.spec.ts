import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';

const password = 'correct horse battery staple';
const previewDate =
  /\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December)/u;

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-schedule-e2e-'),
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

test('the schedule sheet sets a monthly day and time and previews it in words', async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/settings`);
  const scheduleRow = page.getByRole('button', { name: /^Schedule/u });
  await expect(scheduleRow).toContainText('Off');

  await scheduleRow.click();
  const sheet = page.getByRole('dialog', { name: 'Check-in schedule' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radio', { name: 'Off' })).toBeChecked();
  await expect(sheet.getByText('Day of the month')).toHaveCount(0);

  await sheet.getByRole('radio', { name: 'Monthly' }).click();
  await expect(sheet.getByText('Day of the month')).toBeVisible();
  await sheet.getByRole('button', { name: '5', exact: true }).click();
  await sheet.getByRole('button', { name: '09:00', exact: true }).click();
  await expect(
    sheet.getByRole('button', { name: '5', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const preview = sheet.getByRole('status');
  await expect(preview).toHaveText(
    new RegExp(
      `^Next check-in opens on 5 [A-Z][a-z]+ at 09:00\\. Everyone gets a notification\\.$`,
      'u',
    ),
  );

  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/SettingsSchedule.png',
      scale: 'css',
    });
  }

  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(scheduleRow).toContainText('Monthly, 5th, 09:00');
  await page.reload();
  await expect(page.getByRole('button', { name: /^Schedule/u })).toContainText(
    'Monthly, 5th, 09:00',
  );
});

test('the sheet offers the last day and every N weeks on a weekday', async ({
  page,
}) => {
  await page.goto(`${origin}/settings`);
  await page.getByRole('button', { name: /^Schedule/u }).click();
  const sheet = page.getByRole('dialog', { name: 'Check-in schedule' });

  await sheet.getByRole('radio', { name: 'Monthly' }).click();
  await sheet.getByRole('button', { name: 'Last day' }).click();
  await sheet.getByRole('button', { name: '19:00', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText(
    new RegExp(
      `^Next check-in opens on ${previewDate.source} at 19:00\\. Everyone gets a notification\\.$`,
      'u',
    ),
  );

  await sheet.getByRole('radio', { name: 'Every N weeks' }).click();
  await expect(sheet.getByText('Day of the month')).toHaveCount(0);
  await sheet.getByRole('button', { name: '3', exact: true }).click();
  await sheet.getByRole('button', { name: 'Friday' }).click();
  await sheet.getByRole('button', { name: '08:00', exact: true }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Schedule/u })).toContainText(
    'Every 3 weeks, Fri, 08:00',
  );

  await page.getByRole('button', { name: /^Schedule/u }).click();
  const reopened = page.getByRole('dialog', { name: 'Check-in schedule' });
  await expect(
    reopened.getByRole('radio', { name: 'Every N weeks' }),
  ).toBeChecked();
  await expect(
    reopened.getByRole('button', { name: 'Friday' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await reopened.getByRole('radio', { name: 'Monthly' }).click();
  await expect(
    reopened.getByRole('button', { name: 'Last day' }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('turning the schedule off says so and Close keeps the old one', async ({
  page,
}) => {
  await putCadence(page, { kind: 'monthly', day: 12, time: '12:00' });
  await page.goto(`${origin}/settings`);
  const row = page.getByRole('button', { name: /^Schedule/u });
  await expect(row).toContainText('Monthly, 12th, 12:00');

  await row.click();
  let sheet = page.getByRole('dialog', { name: 'Check-in schedule' });
  await sheet.getByRole('radio', { name: 'Off' }).click();
  await expect(sheet.getByRole('status')).toHaveText(
    'No check-in opens by itself. Start one from Check-ins.',
  );
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText('Monthly, 12th, 12:00');

  await row.click();
  sheet = page.getByRole('dialog', { name: 'Check-in schedule' });
  await sheet.getByRole('radio', { name: 'Off' }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(row).toContainText('Off');
});

test('a failed save keeps the sheet open with a message', async ({ page }) => {
  await page.goto(`${origin}/settings`);
  await page.getByRole('button', { name: /^Schedule/u }).click();
  const sheet = page.getByRole('dialog', { name: 'Check-in schedule' });
  await sheet.getByRole('radio', { name: 'Monthly' }).click();
  await page.route('**/api/settings', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.continue(),
  );
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    'Could not save the schedule. Try again.',
  );
  await expect(sheet).toBeVisible();
});

test('Check-ins shows the cadence in the header and the next scheduled date', async ({
  page,
}) => {
  await page.goto(`${origin}/check-ins`);
  await expect(page.getByText('Schedule off', { exact: true })).toBeVisible();
  await expect(page.getByText('Everyone gets a notification.')).toBeVisible();
  await expect(page.getByText(/Next scheduled/u)).toHaveCount(0);

  await putCadence(page, { kind: 'monthly', day: 5, time: '09:00' });
  await page.reload();
  await expect(
    page.getByText('Monthly on the 5th, 09:00', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Start a check-in' }).locator('p'),
  ).toHaveText(
    /^Everyone gets a notification\. Next scheduled: 5 [A-Z][a-z]+\.$/u,
  );

  await putCadence(page, {
    kind: 'weeks',
    every: 2,
    weekday: 5,
    time: '08:00',
  });
  await page.reload();
  await expect(
    page.getByText('Every 2 weeks on Friday, 08:00', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Next scheduled: /u)).toBeVisible();

  await putCadence(page, { kind: 'monthly', day: 'last', time: '09:00' });
  await page.reload();
  await expect(
    page.getByText('Monthly on the last day, 09:00', { exact: true }),
  ).toBeVisible();

  await putCadence(page, { kind: 'off' });
  await page.reload();
  await expect(page.getByText('Schedule off', { exact: true })).toBeVisible();
  await expect(page.getByText(/Next scheduled/u)).toHaveCount(0);
});

test('the next date under "Start a check-in now" matches the sheet preview', async ({
  page,
}) => {
  await page.goto(`${origin}/settings`);
  await page.getByRole('button', { name: /^Schedule/u }).click();
  const sheet = page.getByRole('dialog', { name: 'Check-in schedule' });
  await sheet.getByRole('radio', { name: 'Monthly' }).click();
  await sheet.getByRole('button', { name: '14', exact: true }).click();
  const preview = (await sheet.getByRole('status').textContent()) ?? '';
  const date = /opens on (.+) at/u.exec(preview)?.[1];
  expect(date).toBeTruthy();
  await sheet.getByRole('button', { name: 'Done' }).click();

  await page.goto(`${origin}/check-ins`);
  await expect(
    page.getByText(`Everyone gets a notification. Next scheduled: ${date}.`),
  ).toBeVisible();
});

test('the sheet shows the server’s next slot while the cadence is unchanged', async ({
  page,
}) => {
  // Every 2 weeks on tomorrow's weekday, counted from 6 days ago: the next
  // slot is 8 days away, though tomorrow is the coming such weekday.
  const tomorrow = berlinDate(1);
  await putCadence(page, {
    kind: 'weeks',
    every: 2,
    weekday: isoWeekday(tomorrow),
    time: '09:00',
  });
  withDatabase((database) =>
    database
      .prepare('UPDATE family SET cadence_anchor_date = ? WHERE id = 1')
      .run(berlinDate(-6)),
  );
  const real = dayMonth(berlinDate(8));
  const fromToday = dayMonth(tomorrow);
  const opens = (day: string, time: string) =>
    `Next check-in opens on ${day} at ${time}. Everyone gets a notification.`;

  await page.goto(`${origin}/check-ins`);
  await expect(
    page.getByRole('region', { name: 'Start a check-in' }).locator('p'),
  ).toHaveText(`Everyone gets a notification. Next scheduled: ${real}.`);

  await page.goto(`${origin}/settings`);
  await page.getByRole('button', { name: /^Schedule/u }).click();
  const sheet = page.getByRole('dialog', { name: 'Check-in schedule' });
  await expect(sheet.getByRole('status')).toHaveText(opens(real, '09:00'));

  // A different time is a changed cadence: it will count from today.
  await sheet.getByRole('button', { name: '12:00', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText(opens(fromToday, '12:00'));
  await sheet.getByRole('button', { name: '09:00', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText(opens(real, '09:00'));

  // Done with nothing changed keeps the server's slot.
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto(`${origin}/check-ins`);
  await expect(
    page.getByRole('region', { name: 'Start a check-in' }).locator('p'),
  ).toHaveText(`Everyone gets a notification. Next scheduled: ${real}.`);
});

/** Saves a cadence through the API, as the sheet's Done would. */
async function putCadence(page: Page, cadence: object): Promise<void> {
  const response = await page
    .context()
    .request.patch(`${origin}/api/settings`, {
      headers: { Origin: origin },
      data: { cadence },
    });
  expect(response.status()).toBe(200);
}

/** The date `offset` days from today in Berlin, as YYYY-MM-DD. */
function berlinDate(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
  }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday to 7 = Sunday, of a YYYY-MM-DD date. */
function isoWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

/** A YYYY-MM-DD date as "5 November". */
function dayMonth(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`));
}

type TestDatabase = {
  prepare(sql: string): { run(...values: unknown[]): unknown };
  close(): void;
};

/** Opens the server's database for a change no API makes. */
function withDatabase(change: (database: TestDatabase) => unknown): void {
  const Sqlite = createRequire(path.resolve('server/package.json'))(
    'better-sqlite3',
  ) as new (filePath: string) => TestDatabase;
  const database = new Sqlite(path.join(dataDirectory!, 'budget-buddy.sqlite'));
  try {
    change(database);
  } finally {
    database.close();
  }
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
