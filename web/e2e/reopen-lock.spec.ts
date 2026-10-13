import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';

/**
 * Sign in again when the app is re-opened (MEM-7, SEC-9) against a real
 * server. The page's clock is Playwright's; the server's clock is real, so
 * "five minutes away" is made by moving the session's last-foreground mark
 * back in the database, the one thing a test cannot reach through the API.
 * The server rule itself is tested with a fake clock in
 * `server/test/reopen-lock.test.ts`.
 *
 * Playwright's WebKit has no virtual authenticator, so the Face ID prompt
 * cannot be completed here: the test covers what the page does around it.
 */
const password = 'correct horse battery staple';
const minute = 60_000;
const presencePath = '/api/session/presence';

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-reopen-e2e-'),
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
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  server = undefined;
  dataDirectory = undefined;
  expect(requestsMadeOffOrigin).toEqual([]);
});

test('coming back after more than 5 minutes asks to sign in and returns to the same screen', async ({
  page,
}) => {
  await page.clock.install();
  await openAccounts(page);

  await away(page, 6 * minute);
  await expect(page).toHaveURL(`${origin}/sign-in?next=/accounts`);
  await expect(
    page.getByText('Locked after more than 5 minutes away.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toHaveCount(0);
  // The server agrees, for a request from anywhere on this device.
  const refused = await page.context().request.get(`${origin}/api/accounts`);
  expect(refused.status()).toBe(401);
  expect((await refused.json()).error.code).toBe('session_locked');

  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/accounts`);
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
});

test('events that arrive with a return send one presence call, and a lock holds through them and a reload', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === presencePath) {
      calls.push(request.postData() ?? '');
    }
  });
  await page.clock.install();
  await openAccounts(page);
  await hide(page);
  backdate(10 * minute);
  await page.clock.fastForward(10 * minute);

  // The connection comes back while the app is still in the background: no
  // call, and the absence is not cut short.
  const beforeReturn = calls.length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(300);
  expect(calls.length).toBe(beforeReturn);

  await setVisibility(page, 'visible');
  await expect(page).toHaveURL(`${origin}/sign-in?next=/accounts`);
  // The events that come with a return from the background.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true }),
    );
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  expect(calls.slice(beforeReturn)).toHaveLength(1);
  expect(JSON.parse(calls[beforeReturn]!).awayMs).toBeGreaterThan(5 * minute);

  // Reloading the page does not open the app without a password.
  await page.reload();
  await expect(page).toHaveURL(`${origin}/sign-in?next=/accounts`);
  const refused = await page.context().request.get(`${origin}/api/auth/me`);
  expect(refused.status()).toBe(401);
});

test('a wrong password on the lock screen counts toward the lockout', async ({
  page,
}) => {
  await page.clock.install();
  await openAccounts(page);
  await away(page, 6 * minute);
  await expect(page).toHaveURL(/\/sign-in/u);
  await page.getByRole('textbox', { name: 'Family password' }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').first()).toHaveText(
    'That password doesn’t match. 2 tries before a short wait.',
  );
});

test('a short absence does not lock', async ({ page }) => {
  await page.clock.install();
  await openAccounts(page);

  await away(page, 4 * minute);
  await expect(page).toHaveURL(`${origin}/accounts`);
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  const still = await page.context().request.get(`${origin}/api/auth/me`);
  expect(still.status()).toBe(200);
});

test('a fresh load follows the same five minutes, measured from the last time in the foreground', async ({
  page,
}) => {
  await openAccounts(page);

  // A reload in the middle of use, and one after four minutes away.
  await page.reload();
  await expect(page).toHaveURL(`${origin}/accounts`);
  await accountsLoaded(page);
  await hide(page);
  backdate(4 * minute);
  await page.reload();
  await expect(page).toHaveURL(`${origin}/accounts`);
  await accountsLoaded(page);

  // After six minutes the load shows sign-in, where the Home Screen app
  // starts (Home) or where it was opened (a path).
  await hide(page);
  backdate(6 * minute);
  await page.goto(`${origin}/check-ins`);
  await expect(page).toHaveURL(`${origin}/sign-in?next=/check-ins`);
  await expect(
    page.getByText('Locked after more than 5 minutes away.'),
  ).toBeVisible();
});

test('a Home Screen start at Home returns to the screen the app was left on', async ({
  page,
}) => {
  await openAccounts(page);
  await hide(page);
  backdate(8 * minute);
  // iOS starts an installed app at its start URL, not where it was left.
  await page.goto(`${origin}/`);
  await expect(page).toHaveURL(`${origin}/sign-in?next=/accounts`);
  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/accounts`);
});

test('a visible app reports every 30 seconds and is not locked however long it stays', async ({
  page,
}) => {
  const calls: number[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/session/presence') {
      calls.push(Date.now());
    }
  });
  await page.clock.install();
  await openAccounts(page);
  for (let beat = 0; beat < 40; beat += 1) {
    const sent = page.waitForResponse(
      (response) => new URL(response.url()).pathname === presencePath,
    );
    await page.clock.runFor(30_000);
    await sent;
    // Four minutes pass on the server's side between beats. A beat that did
    // not reach it would leave eight, and the next request would be refused.
    backdate(4 * minute);
    const state = await page.context().request.get(`${origin}/api/auth/me`);
    expect(state.status(), `after beat ${beat + 1}`).toBe(200);
  }
  // 20 minutes on one screen: 40 beats, each answered, never signed out.
  expect(calls.length).toBeGreaterThanOrEqual(40);
  await expect(page).toHaveURL(`${origin}/accounts`);
  expect(
    (await page.context().request.get(`${origin}/api/auth/me`)).status(),
  ).toBe(200);
});

test('a member who navigates every 20 seconds keeps reporting and is not locked', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === presencePath) {
      calls.push(request.postData() ?? '');
    }
  });
  await page.clock.install();
  await page.goto(`${origin}/`);
  await expect(page.getByRole('link', { name: 'Accounts' })).toBeVisible();
  const afterLoad = calls.length;
  // 18 moves between screens, 20 s apart: 6 minutes of active use, each move
  // refreshing the sign-in state as the route guard does.
  for (let move = 0; move < 18; move += 1) {
    await page.clock.runFor(20_000);
    if (move % 2 === 0) {
      await page.getByRole('link', { name: 'Accounts' }).click();
      await expect(page).toHaveURL(`${origin}/accounts`);
    } else {
      await page.goBack();
      await expect(page).toHaveURL(`${origin}/`);
    }
  }
  // A beat every 30 s: 12 in 6 minutes. With the timer restarted by each
  // move there would be none.
  await expect.poll(() => calls.length - afterLoad).toBeGreaterThanOrEqual(10);
  // The last beat is recent on the server, so a request is not refused.
  backdate(minute);
  expect(
    (await page.context().request.get(`${origin}/api/auth/me`)).status(),
  ).toBe(200);
});

test('a load just before the limit says so at once, so the next request is not refused', async ({
  page,
}) => {
  await openAccounts(page);
  await hide(page);
  backdate(4 * minute + 45_000);

  const sent = page.waitForResponse(
    (response) => new URL(response.url()).pathname === presencePath,
  );
  await openAccounts(page);
  await sent;
  // 30 seconds of use pass before the first 30 s beat; they add to the gap
  // the server sees only if the load did not mark the app in use.
  backdate(30_000);
  const request = await page.context().request.get(`${origin}/api/accounts`);
  expect(request.status()).toBe(200);
});

test('Settings: the switch turns the lock off and on for this device', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`${origin}/settings`);
  const toggle = page.getByRole('switch', {
    name: 'Sign in again when reopened',
  });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(
    // Playwright's WebKit does not present itself as an iPhone or iPad.
    page.getByText('On this device, after more than 5 minutes away'),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Unlock with Face ID' }),
  ).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const off = await page
    .context()
    .request.get(`${origin}/api/devices/current/lock`);
  expect(await off.json()).toEqual({ lockOnReopen: false });

  // Off restores the old behaviour: an hour away, still signed in.
  await away(page, 60 * minute);
  await expect(page).toHaveURL(`${origin}/settings`);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await away(page, 6 * minute);
  await expect(page).toHaveURL(`${origin}/sign-in?next=/settings`);
});

test('Settings: the switch is disabled offline, with its state kept', async ({
  page,
  context,
}) => {
  await page.goto(`${origin}/settings`);
  const toggle = page.getByRole('switch', {
    name: 'Sign in again when reopened',
  });
  await expect(toggle).toBeEnabled();
  await context.setOffline(true);
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await context.setOffline(false);
  await expect(toggle).toBeEnabled();
});

test('a notification tap on a locked device goes to sign-in, then to the screen it names', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`${origin}/`);
  await homeLoaded(page);
  await away(page, 6 * minute);
  await expect(page).toHaveURL(`${origin}/sign-in`);

  // What the service worker posts to an open page when a notification is
  // tapped (the worker itself is blocked in these tests).
  await tapNotification(page, '/check-ins');
  await expect(page).toHaveURL(`${origin}/sign-in?next=/check-ins`);
  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/check-ins`);
  await expect(page.getByRole('heading', { name: 'Check-ins' })).toBeVisible();
});

test('a notification that opens a closed app on a locked device goes to sign-in first', async ({
  page,
}) => {
  await page.goto(`${origin}/`);
  await homeLoaded(page);
  await hide(page);
  backdate(10 * minute);
  // The worker opens a new window at the notification's address.
  await page.goto(`${origin}/check-ins`);
  await expect(page).toHaveURL(`${origin}/sign-in?next=/check-ins`);
  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/check-ins`);
});

test('offline, a device that was away is locked on the page and cannot sign in until it is online', async ({
  page,
  context,
}) => {
  await page.clock.install();
  await openAccounts(page);
  await hide(page);
  await context.setOffline(true);
  await page.clock.fastForward(7 * minute);
  await setVisibility(page, 'visible');

  await expect(page).toHaveURL(`${origin}/sign-in?next=/accounts`);
  await expect(
    page.getByText(
      'Locked after more than 5 minutes away. Connect to sign in.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/You’re offline/u)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  // Nothing else opens while it is locked.
  await tapNotification(page, '/check-ins');
  await expect(page).toHaveURL(`${origin}/sign-in?next=/check-ins`);

  await context.setOffline(false);
  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/check-ins`);
});

test('Face ID on a locked device is asked for once, then the button waits, focused', async ({
  page,
}) => {
  // WebKit in Playwright cannot complete a Face ID prompt, and this origin
  // (an IP address) cannot be a relying party, so the server refuses the
  // challenge. What this shows is the page's side: one automatic attempt,
  // no loop, the button focused, and the password still working.
  const attempts: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/passkey/authenticate/options')) {
      attempts.push(request.url());
    }
  });
  addPasskeyRow();
  await page.clock.install();
  await openAccounts(page);
  await away(page, 6 * minute);

  await expect(page).toHaveURL(`${origin}/sign-in?next=/accounts`);
  const button = page.getByRole('button', { name: 'Use Face ID' });
  await expect(button).toBeVisible();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(button).toBeFocused();
  await page.clock.runFor(10_000);
  expect(attempts).toHaveLength(1);

  // A tap is a new, deliberate attempt.
  await button.click();
  await expect.poll(() => attempts.length).toBe(2);

  await page.getByRole('textbox', { name: 'Family password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/accounts`);
});

test('a device that is signed out, not locked, is not asked for Face ID by itself', async ({
  page,
}) => {
  const attempts: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/passkey/authenticate/options')) {
      attempts.push(request.url());
    }
  });
  addPasskeyRow();
  await page.goto(`${origin}/accounts`);
  await page.context().request.post(`${origin}/api/auth/sign-out`, {
    headers: { Origin: origin },
    data: {},
  });
  await page.goto(`${origin}/`);
  await expect(page.getByRole('button', { name: 'Use Face ID' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(attempts).toHaveLength(0);
  await expect(
    page.getByText('Locked after more than 5 minutes away.'),
  ).toHaveCount(0);
});

/**
 * Opens Accounts and waits until it has loaded. See `accountsLoaded`.
 */
async function openAccounts(page: Page): Promise<void> {
  await page.goto(`${origin}/accounts`);
  await accountsLoaded(page);
}

/**
 * Waits until Accounts shows its list, not only its heading. The page reads
 * its data after the heading shows; a read that leaves after the test has
 * moved the server's clock is refused with `session_locked`, and the page
 * then locks itself through that answer, never through the return call the
 * test is about. A page that has not yet loaded its sign-in state also sends
 * no call when it is hidden.
 */
async function accountsLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByText('Loading accounts…')).toHaveCount(0);
}

/** Waits until Home shows its data. See `accountsLoaded`. */
async function homeLoaded(page: Page): Promise<void> {
  await expect(
    page.getByRole('link', { name: /Family wealth/u }),
  ).toBeVisible();
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
}

/** Sets what the page reports about being in the foreground. */
async function setVisibility(
  page: Page,
  state: 'hidden' | 'visible',
): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => next,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => next === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** The app leaves the foreground, and its last word reaches the server. */
async function hide(page: Page): Promise<void> {
  const sent = page.waitForResponse(
    (response) => new URL(response.url()).pathname === presencePath,
  );
  await setVisibility(page, 'hidden');
  await sent;
}

/** The app leaves the foreground for `ms` and comes back. */
async function away(page: Page, ms: number): Promise<void> {
  await hide(page);
  backdate(ms);
  await page.clock.fastForward(ms);
  await setVisibility(page, 'visible');
}

/** Moves the sessions' last-foreground marks back, as time away does. */
function backdate(ms: number): void {
  const database = openDatabase();
  database
    .prepare('UPDATE session SET foreground_at = foreground_at - ?')
    .run(ms);
  database.close();
}

function addPasskeyRow(): void {
  const database = openDatabase();
  database
    .prepare(
      "INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) SELECT id, 'e2e-credential', 'e2e-key', 0, 1 FROM device",
    )
    .run();
  database.close();
}

type Sqlite = {
  prepare(sql: string): { run(...values: unknown[]): unknown };
  close(): void;
};

function openDatabase(): Sqlite {
  const Database = createRequire(path.resolve('server/package.json'))(
    'better-sqlite3',
  ) as new (filePath: string) => Sqlite;
  return new Database(path.join(dataDirectory!, 'budget-buddy.sqlite'));
}

async function tapNotification(page: Page, url: string): Promise<void> {
  await page.evaluate((target) => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', { data: { type: 'navigate', url: target } }),
    );
  }, url);
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
