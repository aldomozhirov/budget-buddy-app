import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { formatDate, todayInTimeZone } from '@budget-buddy/shared';

/** The envelopes card is the region named after the month. */
const monthName =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)$/u;
const password = 'correct horse battery staple';
const day = 86_400_000;

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

/** The ids `seedFamily` made, in the order it made them. */
interface Seed {
  trade: number;
  ing: number;
  cash: number;
  revolut: number;
}

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-home-e2e-'),
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

test('amounts are hidden after a reload, and the eye shows them for 30 s', async ({
  page,
}, testInfo) => {
  const seed = await seedFamily(page.context());
  await closedCheckinThenRaiseIng(page.context(), seed);
  const date = formatDate(new Date(), 'Europe/Berlin');

  // Fake timers, so the 30 s need no real waiting.
  await page.clock.install();
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();

  const wealth = page.getByRole('link', { name: /^Family wealth/u });
  await expect(wealth).toContainText('Family wealth · EUR');
  await expect(wealth).toContainText('€ • • • • •');
  await expect(wealth).toContainText('Amount hidden');
  await expect(wealth).toContainText(`Hidden · last check-in ${date}`);
  const eye = page.getByRole('button', { name: 'Show amounts for 30 seconds' });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expectNoAmounts(page);

  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/Main.png',
      scale: 'css',
    });
  }

  await eye.click();
  await expect(wealth).toContainText('€3,272.00');
  await expect(wealth).toContainText(`+€1,742.00 since check-in of ${date}`);
  if (testInfo.project.name === 'iphone') {
    await page.screenshot({
      path: 'test-results/screens/Main-revealed.png',
      scale: 'css',
    });
  }
  await expect(wealth).not.toContainText('€ • • • • •');
  await expect(
    page.getByText('Amounts visible · hiding again in 30 s', { exact: true }),
  ).toBeVisible();
  const hide = page.getByRole('button', { name: 'Hide amounts' });
  await expect(hide).toHaveAttribute('aria-pressed', 'true');

  await page.clock.runFor(1_000);
  await expect(
    page.getByText('Amounts visible · hiding again in 29 s', { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(28_000);
  await expect(
    page.getByText('Amounts visible · hiding again in 1 s', { exact: true }),
  ).toBeVisible();
  await expect(wealth).toContainText('€3,272.00');
  await page.clock.runFor(1_000);
  await expect(wealth).toContainText('€ • • • • •');
  await expect(wealth).toContainText(`Hidden · last check-in ${date}`);
  await expect(page.getByText(/Amounts visible/u)).toHaveCount(0);
  await expectNoAmounts(page);
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
});

test('a second tap hides the amounts at once, and nothing is stored', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await closedCheckinThenRaiseIng(page.context(), seed);
  await page.clock.install();
  await page.goto(`${origin}/`);
  const wealth = page.getByRole('link', { name: /^Family wealth/u });
  await expect(wealth).toContainText('€ • • • • •');

  await page
    .getByRole('button', { name: 'Show amounts for 30 seconds' })
    .click();
  await expect(wealth).toContainText('€3,272.00');
  expect(
    await page.evaluate(() => [
      localStorage.length,
      sessionStorage.length,
      document.cookie,
    ]),
  ).toEqual([0, 0, '']);

  await page.getByRole('button', { name: 'Hide amounts' }).click();
  await expect(wealth).toContainText('€ • • • • •');
  await expect(page.getByText(/Amounts visible/u)).toHaveCount(0);
  await expectNoAmounts(page);
  await page.clock.runFor(31_000);
  await expect(wealth).toContainText('€ • • • • •');

  // Revealing again and leaving the screen: the next visit starts hidden.
  await page
    .getByRole('button', { name: 'Show amounts for 30 seconds' })
    .click();
  await expect(wealth).toContainText('€3,272.00');
  await page.reload();
  await expect(
    page.getByRole('link', { name: /^Family wealth/u }),
  ).toContainText('€ • • • • •');
  await expectNoAmounts(page);
});

test('backgrounding the page hides revealed amounts at once, and they stay hidden', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await closedCheckinThenRaiseIng(page.context(), seed);
  await page.clock.install();
  await page.goto(`${origin}/`);
  const wealth = page.getByRole('link', { name: /^Family wealth/u });
  await page
    .getByRole('button', { name: 'Show amounts for 30 seconds' })
    .click();
  await expect(wealth).toContainText('€3,272.00');
  await page.clock.runFor(5_000);

  // Safari backgrounding: the page becomes hidden, well inside the 30 s.
  await setVisibility(page, 'hidden');
  await expect(wealth).toContainText('€ • • • • •');
  await expect(page.getByText(/Amounts visible/u)).toHaveCount(0);
  await expectNoAmounts(page);
  await expect(
    page.getByRole('button', { name: 'Show amounts for 30 seconds' }),
  ).toHaveAttribute('aria-pressed', 'false');

  // Returning within 30 s shows nothing; the eye still reveals again.
  await page.clock.runFor(5_000);
  await setVisibility(page, 'visible');
  await expect(wealth).toContainText('€ • • • • •');
  await expectNoAmounts(page);
  await page
    .getByRole('button', { name: 'Show amounts for 30 seconds' })
    .click();
  await expect(wealth).toContainText('€3,272.00');
  await page.clock.runFor(30_000);
  await expect(wealth).toContainText('€ • • • • •');
});

test('pagehide hides revealed amounts before the app switcher snapshot', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await closedCheckinThenRaiseIng(page.context(), seed);
  await page.clock.install();
  await page.goto(`${origin}/`);
  const wealth = page.getByRole('link', { name: /^Family wealth/u });
  await page
    .getByRole('button', { name: 'Show amounts for 30 seconds' })
    .click();
  await expect(wealth).toContainText('€3,272.00');

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(wealth).toContainText('€ • • • • •');
  await expectNoAmounts(page);
});

test('with “Hide amounts on Home” off, Home shows the amount after a reload', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await closedCheckinThenRaiseIng(page.context(), seed);
  const date = formatDate(new Date(), 'Europe/Berlin');

  await page.goto(`${origin}/settings`);
  const hideSwitch = page.getByRole('switch', { name: 'Hide amounts on Home' });
  await expect(hideSwitch).toBeEnabled();
  await expect(hideSwitch).toHaveAttribute('aria-checked', 'true');
  await hideSwitch.click();
  await expect(hideSwitch).toHaveAttribute('aria-checked', 'false');

  await page.goto(`${origin}/`);
  const wealth = page.getByRole('link', { name: /^Family wealth/u });
  await expect(wealth).toContainText('€3,272.00');
  await expect(wealth).toContainText(`+€1,742.00 since check-in of ${date}`);
  await page.reload();
  await expect(wealth).toContainText('€3,272.00');
  await expect(page.getByText(/Amounts visible/u)).toHaveCount(0);

  // The eye still hides them for the rest of the visit.
  await page.getByRole('button', { name: 'Hide amounts' }).click();
  await expect(wealth).toContainText('€ • • • • •');
  await expectNoAmounts(page);
  await page.getByRole('button', { name: 'Show amounts' }).click();
  await expect(wealth).toContainText('€3,272.00');

  // Turning it back on hides them again on the next start.
  await page.goto(`${origin}/settings`);
  await page.getByRole('switch', { name: 'Hide amounts on Home' }).click();
  await page.goto(`${origin}/`);
  await expect(
    page.getByRole('link', { name: /^Family wealth/u }),
  ).toContainText('€ • • • • •');
});

test('the banner for a scheduled check-in has no amounts and one number', async ({
  page,
}, testInfo) => {
  const context = page.context();
  await seedFamily(context);
  await post(context, '/api/auth/profile', { memberId: 2, remember: true });
  await post(context, '/api/checkins', {});
  withDatabase((database) => {
    database
      .prepare('UPDATE checkin SET opened_by = NULL, schedule_slot = ?')
      .run('2026-10-05T09:00');
    database
      .prepare("UPDATE family SET cadence_kind = 'monthly' WHERE id = 1")
      .run();
  });

  await page.goto(`${origin}/`);
  const banner = page.getByRole('link', { name: /Monthly check-in is open/u });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Monthly check-in is open')).toBeVisible();
  await expect(
    banner.getByText('Opened today · 2 of your accounts to check', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(banner.getByText('Continue')).toBeVisible();
  expect(((await banner.innerText()).match(/\d/gu) ?? []).join('')).toBe('2');
  await expect(banner).not.toContainText(/[€$₽₿]/u);

  if (testInfo.project.name === 'iphone') {
    addBackup('daily', 'done', Date.now() - 3.5 * day);
    await page.reload();
    await expect(page.getByText('Last backup was 3 days ago')).toBeVisible();
    await page.screenshot({
      path: 'test-results/screens/Main-banner.png',
      scale: 'css',
    });
  }
  await banner.click();
  await expect(page).toHaveURL(/\/check-in$/u);
});

test('the banner says “You” for your own check-in and names another member', async ({
  page,
}) => {
  const context = page.context();
  const seed = await seedFamily(context);
  await post(context, '/api/auth/profile', { memberId: 2, remember: true });
  const id = (await post(context, '/api/checkins', {})).checkin.id;

  await page.goto(`${origin}/`);
  const banner = page.getByRole('link', { name: /Check-in is open/u });
  await expect(
    banner.getByText('Check-in is open', { exact: true }),
  ).toBeVisible();
  await expect(
    banner.getByText('You started it today · 2 of your accounts left', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(banner).not.toContainText('Max');
  expect(((await banner.innerText()).match(/\d/gu) ?? []).join('')).toBe('2');

  // Once the profile is done, the banner says so instead of counting.
  for (const account of [seed.cash, seed.revolut]) {
    await put(context, `/api/checkins/${id}/values/${account}`, { same: true });
  }
  await page.reload();
  await expect(
    page.getByText('You started it today · you’re done', { exact: true }),
  ).toBeVisible();

  // Another member sees who started it.
  await post(context, '/api/auth/profile', { memberId: 1, remember: true });
  await page.reload();
  await expect(
    page.getByText('Max started it today · 2 of your accounts left', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(banner).not.toContainText(/\bYou\b/u);
  expect(((await banner.innerText()).match(/\d/gu) ?? []).join('')).toBe('2');
});

test('with no closed check-in the wealth card says so and opens Check-ins', async ({
  page,
}) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/`);
  const wealth = page.getByRole('link', { name: /^Family wealth/u });
  await expect(wealth).toContainText('Family wealth · EUR');
  await expect(wealth).toContainText('No check-in yet');
  await expect(wealth).not.toContainText('•');
  await expect(
    page.getByRole('link', { name: /check-in is open/iu }),
  ).toHaveCount(0);
  await wealth.click();
  await expect(page).toHaveURL(/\/check-ins$/u);
});

test('the wealth card and Wealth history open the latest summary', async ({
  page,
}) => {
  const context = page.context();
  const seed = await seedFamily(context);
  const first = await closedCheckinThenRaiseIng(context, seed);
  await page.goto(`${origin}/`);
  const everything = page.getByRole('navigation', { name: 'Everything' });
  await expect(everything.getByRole('link')).toHaveText([
    'Transactions',
    'Envelopes',
    'Accounts',
    'Check-ins',
    'Wealth history',
    'Categories',
    'Settings',
  ]);
  await expect(
    everything.getByRole('link', { name: 'Wealth history' }),
  ).toHaveAttribute('href', `/check-ins/${first}`);
  await page.getByRole('link', { name: /^Family wealth/u }).click();
  await expect(page).toHaveURL(new RegExp(`/check-ins/${first}$`, 'u'));
  await expect(
    page.getByRole('heading', { name: /^Check-in \d{2}\/\d{2}\/\d{4}$/u }),
  ).toBeVisible();
});

test('the greeting shows the date; with no check-in open the Check-in tile opens Check-ins and Back returns to Home', async ({
  page,
}) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(
    page.getByText(
      /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, \d{1,2} [A-Z][a-z]+$/u,
    ),
  ).toBeVisible();
  const tiles = page.getByRole('navigation', { name: 'Quick actions' });
  await expect(tiles.getByRole('link')).toHaveText([
    'Income',
    'Transfer',
    'Check-in',
  ]);
  await tiles.getByRole('link', { name: 'Check-in' }).click();
  await expect(page).toHaveURL(/\/check-ins$/u);
  await expect(
    page.getByRole('button', { name: 'Start a check-in now' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
});

test('with a check-in open the Check-in tile opens the check-in', async ({
  page,
}) => {
  await seedFamily(page.context());
  await post(page.context(), '/api/checkins', {});
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Quick actions' })
    .getByRole('link', { name: 'Check-in' })
    .click();
  await expect(page).toHaveURL(/\/check-in$/u);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(`${origin}/`);
});

test('the Income and Transfer tiles open Add with their kind', async ({
  page,
}) => {
  await seedFamily(page.context());
  const tiles = page.getByRole('navigation', { name: 'Quick actions' });
  for (const [name, kind] of [
    ['Income', 'income'],
    ['Transfer', 'transfer'],
  ] as const) {
    await page.goto(`${origin}/`);
    await expect(
      page.getByRole('heading', { name: 'Hi, Alena' }),
    ).toBeVisible();
    await expect(tiles.getByRole('link', { name })).toHaveAttribute(
      'href',
      `/add?kind=${kind}`,
    );
    await tiles.getByRole('link', { name }).click();
    await expect(page).toHaveURL(`${origin}/add?kind=${kind}`);
    await expect(
      page.getByRole('radio', { name, checked: true }),
    ).toBeVisible();
  }
});

test('the Everything grid lists seven entries and each opens its screen', async ({
  page,
}) => {
  const context = page.context();
  const seed = await seedFamily(context);
  const first = await closedCheckinThenRaiseIng(context, seed);
  const entries = [
    ['Transactions', '/transactions', 'Transactions'],
    ['Envelopes', '/envelopes', 'Envelopes'],
    ['Accounts', '/accounts', 'Accounts'],
    ['Check-ins', '/check-ins', 'Check-ins'],
    ['Wealth history', `/check-ins/${first}`, /^Check-in \d{2}\//u],
    ['Categories', '/categories', 'Categories'],
    ['Settings', '/settings', 'Settings'],
  ] as const;
  for (const [name, href, heading] of entries) {
    await page.goto(`${origin}/`);
    const everything = page.getByRole('navigation', { name: 'Everything' });
    await expect(everything.getByRole('link')).toHaveText(
      entries.map(([label]) => label),
    );
    await expect(everything.getByRole('link', { name })).toHaveAttribute(
      'href',
      href,
    );
    await everything.getByRole('link', { name }).click();
    await expect(page).toHaveURL(`${origin}${href}`);
    await expect(
      page.getByRole('heading', { name: heading, level: 1 }),
    ).toBeVisible();
  }
});

test('the Add expense button stays in view, clear of the home indicator', async ({
  page,
}) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  const button = page.getByRole('link', { name: 'Add expense' });
  await expect(button).toHaveAttribute('href', '/add');
  const height = page.viewportSize()!.height;

  // A home indicator of 34 px, as on an iPhone in the installed app.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--inset-bottom', '34px');
    document.documentElement.style.setProperty('--safe-area-bottom', '34px');
  });
  const inView = async (): Promise<void> => {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height - 34);
  };
  await inView();

  // Scrolled to the end, the last grid link ends above the button.
  const settings = page
    .getByRole('navigation', { name: 'Everything' })
    .getByRole('link', { name: 'Settings' });
  await settings.scrollIntoViewIfNeeded();
  await page.getByRole('main').evaluate((main) => {
    for (const element of [main, ...main.querySelectorAll('div')]) {
      element.scrollTop = element.scrollHeight;
    }
  });
  await inView();
  const link = (await settings.boundingBox())!;
  const bar = (await button.boundingBox())!;
  expect(link.y + link.height).toBeLessThanOrEqual(bar.y);

  await button.click();
  await expect(page).toHaveURL(`${origin}/add`);
  await expect(
    page.getByRole('radio', { name: 'Expense', checked: true }),
  ).toBeVisible();
});

test('a backup older than two days shows a warning that opens Settings', async ({
  page,
}) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(page.getByText(/Last backup was/u)).toHaveCount(0);

  addBackup('daily', 'done', Date.now() - day);
  addBackup('daily', 'failed', Date.now() - 60_000);
  await page.reload();
  await expect(page.getByText(/Last backup was/u)).toHaveCount(0);

  withDatabase((database) => database.prepare('DELETE FROM backup').run());
  addBackup('daily', 'done', Date.now() - 3.5 * day);
  await page.reload();
  const warning = page.getByRole('link', {
    name: 'Last backup was 3 days ago',
  });
  await expect(warning).toBeVisible();
  await warning.click();
  await expect(page).toHaveURL(/\/settings$/u);
});

test('the profile sheet opens from the avatar and closes again', async ({
  page,
}) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/`);
  await page
    .getByRole('button', { name: 'Alena — switch profile or sign out' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Who’s using the app?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
});

test('the envelopes card shows shares while hidden and balances when revealed', async ({
  page,
}, testInfo) => {
  const seed = await seedFamily(page.context());
  await seedSpending(page.context(), seed.trade);
  const today = todayInTimeZone(new Date(), 'Europe/Berlin');
  const [year = 0, month = 0, dayOfMonth = 0] = today.split('-').map(Number);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();

  await page.clock.install();
  await page.goto(`${origin}/`);
  const card = page.getByRole('region', { name: monthName });
  await expect(card).toContainText(`Day ${dayOfMonth} of ${length}`);
  await expect(card).toContainText('€ • • • •');
  await expect(card).toContainText('spent');
  await expect(card.getByRole('link')).toHaveText([
    /Groceries\s*62% used/u,
    /Eating out\s*Over budget/u,
    /Unexpected\s*11% used/u,
  ]);
  // No digit but the day, its month length and the shares.
  const text = (await card.innerText())
    .replace(/Day \d+ of \d+/u, '')
    .replace(/\d+% used/gu, '');
  expect(text).not.toMatch(/\d/u);
  const html = await page.content();
  for (const figure of ['310', '114', '190', '461', '1450', '31000']) {
    expect(html).not.toContain(figure);
  }
  await expect(card.getByRole('progressbar').first()).toHaveAttribute(
    'aria-valuetext',
    '62% used',
  );

  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/Main-envelopes.png',
      scale: 'css',
    });
  }

  await page
    .getByRole('button', { name: 'Show amounts for 30 seconds' })
    .click();
  await expect(card).toContainText('€461.50');
  await expect(card.getByRole('link')).toHaveText([
    /Groceries\s*€190\.00 left of €500\.00/u,
    /Eating out\s*€14\.50 over/u,
    /Unexpected\s*€178\.00 left of €200\.00/u,
  ]);
  await expect(card).not.toContainText('% used');
  await expect(card).not.toContainText('Over budget');
  if (testInfo.project.name === 'iphone') {
    await page.screenshot({
      path: 'test-results/screens/Main-envelopes-revealed.png',
      scale: 'css',
    });
  }

  await page.clock.runFor(30_000);
  await expect(card).toContainText('€ • • • •');
  await expect(card.getByRole('link').first()).toContainText('62% used');
  await expect(card).not.toContainText('€461.50');
});

test('the envelopes card opens Envelopes and is gone without envelopes', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(page.getByText(/^Day \d+ of \d+$/u)).toHaveCount(0);

  await seedSpending(page.context(), seed.trade);
  await page.reload();
  await page
    .getByRole('region', { name: monthName })
    .getByRole('link', { name: /^Eating out/u })
    .click();
  await expect(page).toHaveURL(`${origin}/envelopes`);
  await expect(
    page.getByRole('heading', { name: 'Envelopes', level: 1 }),
  ).toBeVisible();
});

test('“Needs a category” shows its count and opens that tab, and hides at zero', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Needs a category/u }),
  ).toHaveCount(0);

  await seedSpending(page.context(), seed.trade);
  await page.reload();
  const row = page.getByRole('link', { name: 'Needs a category · 3' });
  await expect(row).toHaveAttribute('href', '/transactions?tab=needs-category');
  await expect(row).toContainText('Needs a category');
  await row.click();
  await expect(
    page.getByRole('tab', { name: 'Needs a category · 3', selected: true }),
  ).toBeVisible();

  // Labelling them all removes the row.
  withDatabase((database) =>
    database
      .prepare('UPDATE txn_part SET category_id = 1 WHERE category_id IS NULL')
      .run(),
  );
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Needs a category/u }),
  ).toHaveCount(0);
});

/**
 * Fakes the page being backgrounded or returned to: WebKit offers no way to
 * do it for real, so the visibility state is overridden and the event sent.
 */
async function setVisibility(
  page: Page,
  state: 'hidden' | 'visible',
): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => next,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** No amount, whole or partial, in the page text, its tree or its labels. */
async function expectNoAmounts(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/[€$₽₿]\s?\d/u);
  const html = await page.content();
  for (const figure of ['3,272', '1,742', '1,530', '327200', '174200']) {
    expect(html).not.toContain(figure);
  }
  const tree = await page.getByRole('main').ariaSnapshot();
  expect(tree).not.toMatch(/\d{1,3},\d{3}/u);
  expect(tree).not.toMatch(/[€$₽₿]\s?\d/u);
}

/**
 * Alena and Max, four EUR accounts (Alena: Trade Republic €1,000.00 and ING
 * €500.00; Max: Cash €20.00 and Revolut €10.00), signed in as Alena.
 */
async function seedFamily(context: BrowserContext): Promise<Seed> {
  await post(context, '/api/setup', {
    password,
    passwordConfirmation: password,
    profiles: ['Alena', 'Max'],
  });
  await post(context, '/api/auth/profile', { memberId: 1, remember: true });
  const account = async (
    name: string,
    ownerMemberId: number,
    openingBalance: string,
  ): Promise<number> =>
    (
      await post(context, '/api/accounts', {
        name,
        ownerMemberId,
        type: 'bank',
        currency: 'EUR',
        openingBalance,
      })
    ).account.id as number;
  return {
    trade: await account('Trade Republic', 1, '100000'),
    ing: await account('ING Extra-Konto', 1, '50000'),
    cash: await account('Cash', 2, '2000'),
    revolut: await account('Revolut', 2, '1000'),
  };
}

/**
 * Closes a check-in that keeps every balance (€1,530.00), then raises the ING
 * account to €2,242.00: wealth becomes €3,272.00, which is +€1,742.00 since
 * the check-in. Returns the check-in's id.
 */
async function closedCheckinThenRaiseIng(
  context: BrowserContext,
  seed: Seed,
): Promise<number> {
  const id = (await post(context, '/api/checkins', {})).checkin.id as number;
  for (const account of [seed.trade, seed.ing, seed.cash, seed.revolut]) {
    await put(context, `/api/checkins/${id}/values/${account}`, { same: true });
  }
  // Entering the last amount leaves it open; "Close now" closes it.
  await post(context, `/api/checkins/${id}/close`, {});
  // The raise must be dated after the close.
  await new Promise((resolve) => setTimeout(resolve, 30));
  await post(context, `/api/accounts/${seed.ing}/snapshots`, {
    amount: '224200',
  });
  return id;
}

/** Writes a backup row, which only the later backup job will do itself. */
function addBackup(kind: string, status: string, finishedAt: number): void {
  withDatabase((database) =>
    database
      .prepare(
        `INSERT INTO backup (kind, path, started_at, finished_at, status)
         VALUES (?, '/backups/x.sqlite', ?, ?, ?)`,
      )
      .run(kind, finishedAt, finishedAt, status),
  );
}

type TestDatabase = {
  prepare(sql: string): { run(...values: unknown[]): unknown };
  close(): void;
};

/** Opens the server's database for a change no API makes yet. */
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

/**
 * Three envelopes and this month's spending, all dated today: Groceries
 * €500.00 with €310.00 spent (62%), Eating out €100.00 with €114.50 spent
 * (over by €14.50) and Unexpected €200.00 with €22.00 spent (11%). Three
 * more expenses of €5.00 have no category: spending is €461.50 in all.
 */
async function seedSpending(
  context: BrowserContext,
  account: number,
): Promise<void> {
  const today = todayInTimeZone(new Date(), 'Europe/Berlin');
  const envelope = async (name: string, amount: string): Promise<number> =>
    (
      (await post(context, '/api/envelopes', {
        name,
        currency: 'EUR',
        monthlyAmount: amount,
        mode: 'reset',
        startingBalance: amount,
      })) as unknown as { envelope: { id: number } }
    ).envelope.id;
  const expense = (extra: Record<string, unknown>) =>
    post(context, '/api/transactions', {
      kind: 'expense',
      date: today,
      accountId: account,
      ...extra,
    });
  const groceries = await envelope('Groceries', '50000');
  const eatingOut = await envelope('Eating out', '10000');
  const unexpected = await envelope('Unexpected', '20000');
  for (const [envelopeId, amount] of [
    [groceries, '31000'],
    [eatingOut, '11450'],
    [unexpected, '2200'],
  ] as const) {
    await expense({ envelopeId, amount, categoryId: 1 });
  }
  for (let count = 0; count < 3; count += 1) {
    await expense({ amount: '500', merchant: `Kiosk ${count + 1}` });
  }
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

async function put(
  context: BrowserContext,
  url: string,
  data: unknown,
): Promise<void> {
  const response = await context.request.put(`${origin}${url}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.status(), `PUT ${url}`).toBe(200);
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
