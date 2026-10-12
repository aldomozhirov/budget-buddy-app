import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Live updates of the check-in screen: two members on two browser contexts
 * against a real server, so the stream, the signals and the re-reads are the
 * real ones. One test answers the stream itself with a real
 * `text/event-stream` response to keep a screen from hearing of a close.
 */
const password = 'correct horse battery staple';
const pollMs = 30_000;

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-live-e2e-'),
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
  watchOrigin(page);
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

type Family = {
  alex: Page;
  blair: Page;
  alexContext: BrowserContext;
  blairContext: BrowserContext;
  checkinId: number;
  accounts: Record<string, number>;
};

/** Alex (member 1) and Blair (member 2), two accounts each, one open round. */
async function startFamily(
  page: Page,
  browser: import('@playwright/test').Browser,
  device: string,
): Promise<Family> {
  const alexContext = page.context();
  const blairContext = await browser.newContext({
    viewport:
      device === 'iphone'
        ? { width: 390, height: 844 }
        : { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const blair = await blairContext.newPage();
  watchOrigin(blair);
  await post(alexContext, '/api/setup', {
    password,
    passwordConfirmation: password,
    profiles: ['Alex', 'Blair'],
  });
  await post(alexContext, '/api/auth/profile', { memberId: 1, remember: true });
  await post(blairContext, '/api/auth/sign-in', { password });
  await post(blairContext, '/api/auth/profile', {
    memberId: 2,
    remember: true,
  });
  const accounts: Record<string, number> = {};
  for (const [name, owner, opening] of [
    ['Alex Savings', 1, '214055'],
    ['Alex Wallet', 1, '5000'],
    ['Blair Everyday', 2, '95400'],
    ['Blair Savings', 2, '42000'],
  ] as const) {
    const created = await post(alexContext, '/api/accounts', {
      name,
      ownerMemberId: owner,
      type: 'bank',
      currency: 'EUR',
      openingBalance: opening,
    });
    accounts[name] = (created as { account: { id: number } }).account.id;
  }
  const started = (await post(alexContext, '/api/checkins', {})) as {
    checkin: { id: number };
  };
  return {
    alex: page,
    blair,
    alexContext,
    blairContext,
    checkinId: started.checkin.id,
    accounts,
  };
}

/** Counts the requests of the live stream and of check-in reads. */
function countRequests(page: Page) {
  const counts = { streams: 0, reads: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/events') counts.streams += 1;
    if (/^\/api\/checkins\/\d+$/u.test(url.pathname)) counts.reads += 1;
  });
  return counts;
}

/** Remembers every EventSource the page opens, to see which are closed. */
async function trackStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Native = window.EventSource;
    const opened: EventSource[] = [];
    (window as unknown as { __streams: EventSource[] }).__streams = opened;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        opened.push(this);
      }
    };
  });
}

async function openStreams(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __streams: EventSource[] }).__streams.filter(
        (stream) => stream.readyState !== 2,
      ).length,
  );
}

async function setVisibility(
  page: Page,
  state: 'visible' | 'hidden',
): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => next,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/**
 * Loads the check-in screen and waits for the read that the stream's first
 * connection makes, so a later change cannot be mistaken for that read.
 */
async function openScreen(page: Page): Promise<void> {
  const firstRead = page.waitForResponse((response) =>
    /^\/api\/checkins\/\d+$/u.test(new URL(response.url()).pathname),
  );
  await page.goto(`${origin}/check-in`);
  await firstRead;
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
}

function tabs(page: Page) {
  return page.getByRole('tablist', { name: 'Whose accounts' });
}

for (const [name, run] of [
  [
    "another member's value appears without a reload (UI-CHK-6)",
    async ({ blair, alexContext, checkinId, accounts }: Family) => {
      await blair.goto(`${origin}/check-in`);
      await expect(
        blair.getByRole('heading', { name: 'Your accounts to check · 2' }),
      ).toBeVisible();
      await blair.evaluate(() => {
        (window as unknown as { __marker: string }).__marker = 'same page';
      });
      const streams = countRequests(blair);

      // Alex enters Blair's balance; Blair's screen is not touched.
      await put(alexContext, checkinId, accounts['Blair Everyday']!, '123456');

      await expect(
        blair.getByRole('heading', { name: 'Your accounts to check · 1' }),
      ).toBeVisible();
      const row = blair.getByRole('button', {
        name: 'Change balance of Blair Everyday EUR',
      });
      await expect(row).toContainText('€1,234.56');
      await expect(row).toContainText('▲ €280.56');
      await expect(
        tabs(blair).getByRole('tab', { name: 'You 1 left' }),
      ).toBeVisible();
      expect(
        await blair.evaluate(
          () => (window as unknown as { __marker: string }).__marker,
        ),
      ).toBe('same page');
      // The signal did it: the 30 s poll never ran.
      expect(streams.reads).toBeGreaterThan(0);
    },
  ],
  [
    'a close elsewhere switches to the closed screen and closes an open sheet (UI-CHK-8)',
    async ({ blair, alexContext, checkinId }: Family) => {
      await blair.goto(`${origin}/check-in`);
      await blair
        .getByRole('button', {
          name: 'Enter new balance for Blair Everyday EUR',
        })
        .click();
      const sheet = blair.getByRole('dialog', {
        name: 'New balance for Blair Everyday',
      });
      await sheet.getByRole('button', { name: '4', exact: true }).click();
      await expect(sheet).toBeVisible();

      await post(alexContext, `/api/checkins/${checkinId}/close`, {});

      await expect(
        blair.getByRole('heading', { name: 'Check-in complete' }),
      ).toBeVisible();
      await expect(sheet).toHaveCount(0);
      await expect(
        blair.getByRole('button', { name: 'See summary' }),
      ).toBeVisible();
      await expect(
        blair.getByRole('button', { name: 'Back home' }),
      ).toBeVisible();
      await expect(blair.getByText('Alex closed the check-in.')).toBeVisible();
      // Nothing navigated by itself.
      expect(new URL(blair.url()).pathname).toBe('/check-in');
    },
  ],
  [
    'a close elsewhere also closes the open close confirmation',
    async ({ blair, alexContext, checkinId }: Family) => {
      await blair.goto(`${origin}/check-in`);
      await blair.getByRole('button', { name: 'Close now' }).click();
      const confirmation = blair.getByRole('dialog', {
        name: 'Close the check-in now?',
      });
      await expect(confirmation).toBeVisible();

      await post(alexContext, `/api/checkins/${checkinId}/close`, {});

      await expect(
        blair.getByRole('heading', { name: 'Check-in complete' }),
      ).toBeVisible();
      await expect(confirmation).toHaveCount(0);
      await expect(blair.getByText('Alex closed the check-in.')).toBeVisible();
    },
  ],
  [
    'a check-in that closes by itself shows the closed screen to the other member, without a closer',
    async ({ blair, alexContext, checkinId, accounts }: Family) => {
      await blair.goto(`${origin}/check-in`);
      await expect(
        blair.getByRole('heading', { name: 'Your accounts to check · 2' }),
      ).toBeVisible();
      for (const account of Object.keys(accounts)) {
        await put(alexContext, checkinId, accounts[account]!, '100');
      }
      await expect(
        blair.getByRole('heading', { name: 'Check-in complete' }),
      ).toBeVisible();
      await expect(blair.getByText(/closed the check-in/u)).toHaveCount(0);
    },
  ],
  [
    'typed digits survive a value another member enters, and the note names it (CHK-7)',
    async ({ blair, alexContext, checkinId, accounts }: Family) => {
      await blair.goto(`${origin}/check-in`);
      await blair
        .getByRole('button', {
          name: 'Enter new balance for Blair Savings EUR',
        })
        .click();
      const sheet = blair.getByRole('dialog', {
        name: 'New balance for Blair Savings',
      });
      const amount = blair.getByRole('group', {
        name: 'New balance for Blair Savings',
      });
      for (const digit of ['1', '2', '5']) {
        await sheet.getByRole('button', { name: digit, exact: true }).click();
      }
      await expect(amount.getByText('€125.00', { exact: true })).toBeVisible();

      await put(alexContext, checkinId, accounts['Blair Savings']!, '777700');

      await expect(
        sheet.getByText(
          'Another member entered €7,777.00. Saving replaces it.',
        ),
      ).toBeVisible();
      // The row moved to the done list; the sheet and its digits stayed.
      await expect(
        blair.getByRole('button', {
          name: 'Change balance of Blair Savings EUR',
        }),
      ).toContainText('€7,777.00');
      await expect(sheet).toBeVisible();
      await expect(amount.getByText('€125.00', { exact: true })).toBeVisible();

      // Saving still overwrites until the check-in closes.
      await sheet.getByRole('button', { name: 'Save & next' }).click();
      await expect(
        blair.getByRole('button', {
          name: 'Change balance of Blair Savings EUR',
        }),
      ).toContainText('€125.00');
      await expect(sheet).toHaveCount(0);
    },
  ],
  [
    'a stream that was down is caught up on reconnect, offline or online',
    async ({
      blair,
      blairContext,
      alexContext,
      checkinId,
      accounts,
    }: Family) => {
      await blair.goto(`${origin}/check-in`);
      await expect(
        blair.getByRole('heading', { name: 'Your accounts to check · 2' }),
      ).toBeVisible();
      await blairContext.setOffline(true);
      await put(alexContext, checkinId, accounts['Blair Everyday']!, '5');
      await blairContext.setOffline(false);
      await expect(
        blair.getByRole('heading', { name: 'Your accounts to check · 1' }),
      ).toBeVisible();
    },
  ],
] as const) {
  test(name, async ({ page, browser }, testInfo) => {
    const family = await startFamily(page, browser, testInfo.project.name);
    try {
      await run(family);
    } finally {
      await family.blairContext.close();
    }
  });
}

test('a save refused because the check-in is closed switches screens and offers no retry', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  const { blair, alexContext, checkinId } = family;
  try {
    // An honest, silent event stream: the screen cannot hear of the close
    // and finds out from the refused save alone.
    await blair.route('**/api/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: 'retry: 3600000\n: silent\n\n',
      }),
    );
    await openScreen(blair);
    await expect(
      blair.getByRole('heading', { name: 'Your accounts to check · 2' }),
    ).toBeVisible();

    await post(alexContext, `/api/checkins/${checkinId}/close`, {});
    await expect(
      blair.getByRole('heading', { name: 'Your accounts to check · 2' }),
    ).toBeVisible();

    await blair
      .getByRole('button', { name: 'Blair Everyday EUR unchanged' })
      .click();
    await expect(
      blair.getByRole('heading', { name: 'Check-in complete' }),
    ).toBeVisible();
    await expect(blair.getByRole('button', { name: 'Try again' })).toHaveCount(
      0,
    );
    await expect(
      blair.getByText('Could not save this balance. Try again.'),
    ).toHaveCount(0);
    await expect(blair.getByText('Alex closed the check-in.')).toBeVisible();
    await expect(
      blair.getByRole('button', { name: 'See summary' }),
    ).toBeVisible();
  } finally {
    await family.blairContext.close();
  }
});

test('a refused save from the amount sheet closes the sheet and offers no retry', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  const { blair, alexContext, checkinId } = family;
  try {
    await blair.route('**/api/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 3600000\n: silent\n\n',
      }),
    );
    await openScreen(blair);
    await blair
      .getByRole('button', { name: 'Enter new balance for Blair Everyday EUR' })
      .click();
    const sheet = blair.getByRole('dialog', {
      name: 'New balance for Blair Everyday',
    });
    await sheet.getByRole('button', { name: '9', exact: true }).click();
    await post(alexContext, `/api/checkins/${checkinId}/close`, {});
    await sheet.getByRole('button', { name: 'Save & next' }).click();
    await expect(
      blair.getByRole('heading', { name: 'Check-in complete' }),
    ).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(blair.getByRole('alert')).toHaveCount(0);
  } finally {
    await family.blairContext.close();
  }
});

test('a session that ended while a refused save is re-read goes to sign-in', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  const { blair, alexContext, checkinId } = family;
  try {
    await blair.route('**/api/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 3600000\n: silent\n\n',
      }),
    );
    await openScreen(blair);
    await post(alexContext, `/api/checkins/${checkinId}/close`, {});
    // The save is refused as closed, and the session has ended by the time
    // the screen reads the check-in to show its closed state.
    await blair.route(/\/api\/checkins\/\d+$/u, async (route) => {
      await post(family.blairContext, '/api/auth/sign-out', {});
      await route.continue();
    });
    await blair
      .getByRole('button', { name: 'Blair Everyday EUR unchanged' })
      .click();
    await expect(blair).toHaveURL(/\/sign-in$/u);
    await expect(
      blair.getByRole('heading', { name: 'Check-in complete' }),
    ).toHaveCount(0);
  } finally {
    await family.blairContext.close();
  }
});

test('accounts and profiles changing during a check-in reach the other screen at once', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  const { alex, blair, alexContext } = family;
  try {
    await openScreen(blair);
    await openScreen(alex);
    const blairCount = (count: number) =>
      blair.getByRole('heading', {
        name: `Your accounts to check · ${count}`,
      });
    await expect(blairCount(2)).toBeVisible();
    await expect(
      tabs(alex).getByRole('tab', { name: 'Blair 2 left' }),
    ).toBeVisible();
    const polls = countRequests(blair);
    const readsBefore = polls.reads;

    // An account is created for Blair, then deactivated and reactivated.
    const created = (await post(alexContext, '/api/accounts', {
      name: 'Blair Joint',
      ownerMemberId: 2,
      type: 'bank',
      currency: 'EUR',
      openingBalance: '1000',
    })) as { account: { id: number } };
    await expect(blairCount(3)).toBeVisible();
    await expect(
      tabs(alex).getByRole('tab', { name: 'Blair 3 left' }),
    ).toBeVisible();
    await post(
      alexContext,
      `/api/accounts/${created.account.id}/deactivate`,
      {},
    );
    await expect(blairCount(2)).toBeVisible();
    await expect(
      tabs(alex).getByRole('tab', { name: 'Blair 2 left' }),
    ).toBeVisible();
    await post(
      alexContext,
      `/api/accounts/${created.account.id}/reactivate`,
      {},
    );
    await expect(blairCount(3)).toBeVisible();

    // An account moves to another member.
    await patch(
      alexContext,
      `/api/accounts/${family.accounts['Alex Wallet']}`,
      {
        ownerMemberId: 2,
      },
    );
    await expect(blairCount(4)).toBeVisible();
    await expect(
      tabs(alex).getByRole('tab', { name: 'You 1 left' }),
    ).toBeVisible();

    // An account changes currency.
    await post(
      alexContext,
      `/api/accounts/${family.accounts['Blair Everyday']}/currency`,
      { currency: 'USD', confirm: true },
    );
    await expect(
      blair.getByRole('button', {
        name: 'Enter new balance for Blair Everyday USD',
      }),
    ).toBeVisible();

    // A profile is renamed.
    await patch(alexContext, '/api/members/2', { name: 'Bee' });
    await expect(
      tabs(alex).getByRole('tab', { name: 'Bee 4 left' }),
    ).toBeVisible();

    // The 30 s poll is far off: each change above was read on a signal.
    expect(polls.reads).toBeGreaterThan(readsBefore);
  } finally {
    await family.blairContext.close();
  }
});

test('a failed save for another reason still offers Try again', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  try {
    let failed = false;
    await family.blair.route('**/api/checkins/*/values/*', async (route) => {
      if (!failed && route.request().method() === 'PUT') {
        failed = true;
        await route.fulfill({
          status: 403,
          json: { error: { code: 'forbidden_state', message: 'Nope.' } },
        });
        return;
      }
      await route.continue();
    });
    await family.blair.goto(`${origin}/check-in`);
    await family.blair
      .getByRole('button', { name: 'Blair Everyday EUR unchanged' })
      .click();
    await expect(
      family.blair.getByRole('button', { name: 'Try again', exact: true }),
    ).toBeVisible();
    await expect(
      family.blair.getByRole('heading', { name: 'Check-in complete' }),
    ).toHaveCount(0);
  } finally {
    await family.blairContext.close();
  }
});

test('no stream and no poll while hidden or offline, and none after closing', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  const { blair, blairContext, alexContext, checkinId } = family;
  try {
    await trackStreams(blair);
    await blair.clock.install();
    const requests = countRequests(blair);
    await blair.goto(`${origin}/check-in`);
    await expect(
      blair.getByRole('heading', { name: 'Your accounts to check · 2' }),
    ).toBeVisible();
    await expect.poll(() => openStreams(blair)).toBe(1);

    // Open and visible: the slow poll re-reads. The read that the stream's
    // first connection makes must be over, or the poll skips its own.
    await expect.poll(() => requests.reads).toBe(1);
    await blair.waitForTimeout(500);
    let reads = requests.reads;
    await blair.clock.runFor(pollMs + 1000);
    await expect.poll(() => requests.reads).toBeGreaterThan(reads);

    // Hidden: the stream is closed and the poll stops.
    await setVisibility(blair, 'hidden');
    await expect.poll(() => openStreams(blair)).toBe(0);
    reads = requests.reads;
    let streams = requests.streams;
    await blair.clock.runFor(pollMs * 4);
    await blair.waitForTimeout(300);
    expect(requests.reads).toBe(reads);
    expect(requests.streams).toBe(streams);

    // Back in the foreground: a read and a stream again.
    await setVisibility(blair, 'visible');
    await expect.poll(() => openStreams(blair)).toBe(1);
    await expect.poll(() => requests.reads).toBeGreaterThan(reads);

    // Offline: closed and quiet; online again: back.
    await blairContext.setOffline(true);
    await expect.poll(() => openStreams(blair)).toBe(0);
    reads = requests.reads;
    streams = requests.streams;
    await blair.clock.runFor(pollMs * 4);
    await blair.waitForTimeout(300);
    expect(requests.reads).toBe(reads);
    expect(requests.streams).toBe(streams);
    await blairContext.setOffline(false);
    await expect.poll(() => openStreams(blair)).toBe(1);

    // Closed by someone else: the stream closes and nothing more is asked.
    await post(alexContext, `/api/checkins/${checkinId}/close`, {});
    await expect(
      blair.getByRole('heading', { name: 'Check-in complete' }),
    ).toBeVisible();
    await expect.poll(() => openStreams(blair)).toBe(0);
    reads = requests.reads;
    streams = requests.streams;
    await blair.clock.runFor(pollMs * 4);
    await blair.waitForTimeout(300);
    expect(requests.reads).toBe(reads);
    expect(requests.streams).toBe(streams);
  } finally {
    await blairContext.close();
  }
});

test('leaving the screen ends the stream and the poll', async ({
  page,
  browser,
}, testInfo) => {
  const family = await startFamily(page, browser, testInfo.project.name);
  const { blair, blairContext } = family;
  try {
    await trackStreams(blair);
    await blair.clock.install();
    const requests = countRequests(blair);
    await blair.goto(`${origin}/check-in`);
    await expect.poll(() => openStreams(blair)).toBe(1);
    await blair.getByRole('button', { name: /^Back to / }).click();
    await expect(
      blair.getByRole('heading', { name: 'Hi, Blair' }),
    ).toBeVisible();
    await expect.poll(() => openStreams(blair)).toBe(0);
    const reads = requests.reads;
    const streams = requests.streams;
    await blair.clock.runFor(pollMs * 4);
    await blair.waitForTimeout(300);
    expect(requests.reads).toBe(reads);
    expect(requests.streams).toBe(streams);
  } finally {
    await blairContext.close();
  }
});

function watchOrigin(page: Page): void {
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });
}

async function post(
  context: BrowserContext,
  url: string,
  data: unknown,
): Promise<unknown> {
  const response = await context.request.post(`${origin}${url}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.ok(), `${url} answered ${response.status()}`).toBe(true);
  return response.json().catch(() => ({}));
}

async function patch(
  context: BrowserContext,
  url: string,
  data: unknown,
): Promise<void> {
  const response = await context.request.patch(`${origin}${url}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.ok(), `${url} answered ${response.status()}`).toBe(true);
}

async function put(
  context: BrowserContext,
  checkinId: number,
  accountId: number,
  amount: string,
): Promise<void> {
  const response = await context.request.put(
    `${origin}/api/checkins/${checkinId}/values/${accountId}`,
    { headers: { Origin: origin }, data: { amount } },
  );
  expect(response.status()).toBe(200);
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
