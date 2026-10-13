import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  checkinSummarySchema,
  formatChange,
  formatMoney,
  getCurrency,
  wealthSeriesSchema,
  type CheckinSummary,
} from '@budget-buddy/shared';

const password = 'correct horse battery staple';
const eur = getCurrency('EUR')!;

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

/** The parts of an API answer the seed reads. */
interface Created {
  account: { id: number };
  checkin: { id: number };
}

/** Ids of what `seedFamily` made. */
interface Seed {
  first: number;
  second: number;
  tradeRepublic: number;
}

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-summary-e2e-'),
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

test('the summary shows the total, its two causes and the per-currency rows', async ({
  page,
}, testInfo) => {
  const seed = await seedFamily(page.context());
  const summary = await fetchSummary(page.context(), seed.second);

  await page.goto(`${origin}/check-ins/${seed.second}`);
  await expect(
    page.getByRole('heading', { name: /^Check-in \d{2}\/\d{2}\/\d{4}$/u }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Compared with \d{2}\/\d{2}\/\d{4}$/u),
  ).toBeVisible();

  const total = page.getByRole('region', { name: 'Total' });
  await expect(total).toContainText('Everything in EUR');
  await expect(total).toContainText(
    formatMoney(BigInt(summary.total.current!), eur),
  );
  await expect(total).toContainText(
    `${formatChange(BigInt(summary.total.change!), eur)} from ${formatMoney(BigInt(summary.total.previous!), eur)}`,
  );
  expect(summary.total.direction).toBe('up');

  // The two lines add up to the change exactly (requirements 4.5).
  const fromBalances = BigInt(summary.fromBalances!);
  const fromRates = BigInt(summary.fromExchangeRates!);
  expect(fromBalances + fromRates).toBe(BigInt(summary.total.change!));
  await expect(total.getByText('From balances')).toBeVisible();
  await expect(total.getByText('From exchange rates')).toBeVisible();
  await expect(total).toContainText(signed(fromBalances));
  await expect(total).toContainText(signed(fromRates));

  const rows = {
    EUR: ['€2,670.30', 'was €1,520.00', '▲ €1,150.30'],
    USD: ['$4,495.18', 'was $4,620.00', '▼ $124.82'],
    RUB: ['₽96,500.00', 'was ₽101,200.00', '▼ ₽4,700.00'],
    BTC: ['₿0.04120000', 'was ₿0.04120000', 'Unchanged'],
  };
  for (const [code, texts] of Object.entries(rows)) {
    const row = page.getByRole('group', { name: code, exact: true });
    for (const text of texts) await expect(row).toContainText(text);
  }

  await expect(
    page.getByText('Alena’s Cash kept its last balance'),
  ).toBeVisible();
  await expect(page.getByText('Wasn’t changed · 1')).toBeVisible();
  await expect(
    page.getByText('No accounts added or deactivated'),
  ).toBeVisible();

  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/CheckInSummary.png',
      scale: 'css',
      fullPage: true,
    });
  }
});

test('a list row with a description has the same vertical padding as a one-line row', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await page.goto(`${origin}/check-ins/${seed.second}`);
  await expect(page.getByText('Wasn’t changed · 1')).toBeVisible();

  const rowOf = (text: string) =>
    page
      .getByText(text, { exact: true })
      .locator(
        'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " row ")][1]',
      );
  const measure = async (text: string) =>
    rowOf(text).evaluate((row, label) => {
      const style = getComputedStyle(row);
      const box = row.getBoundingClientRect();
      const textBox = [...row.querySelectorAll('span')]
        .find((span) => span.textContent?.startsWith(label))!
        .getBoundingClientRect();
      return {
        top: parseFloat(style.paddingTop),
        bottom: parseFloat(style.paddingBottom),
        gapAbove: textBox.top - box.top,
        // The divider is outside the 56 px minimum of a row.
        height: box.height - parseFloat(style.borderBottomWidth),
      };
    }, text);

  const twoLines = await measure('Wasn’t changed · 1');
  const oneLine = await measure('No accounts added or deactivated');
  expect(twoLines.top).toBeGreaterThan(0);
  expect(twoLines.top).toBe(oneLine.top);
  expect(twoLines.bottom).toBe(oneLine.bottom);
  // The title does not touch the card's top edge or the divider.
  expect(twoLines.gapAbove).toBeGreaterThanOrEqual(twoLines.top);
  // A row is as tall as before when its text is short: the padding counts
  // inside the minimum height. A taller row grows by the padding on top.
  expect(oneLine.height).toBe(56);
  expect(twoLines.height).toBeGreaterThan(56);
  const currency = await page.locator('.currency-row').first().boundingBox();
  expect(currency?.height).toBe(61);
});

test('Check-ins says "Rate missing" once, and compares nothing across a gap', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  const series = wealthSeriesSchema.parse(
    await (
      await page.context().request.get(`${origin}/api/wealth/series`)
    ).json(),
  );
  // The oldest check-in lacks a rate: it has no total, and the newer one
  // has a total but nothing to compare it with.
  await page.route('**/api/wealth/series?*', (route) =>
    route.fulfill({
      json: {
        ...series,
        points: series.points.map((point) =>
          point.checkinId === seed.first ? { ...point, amount: null } : point,
        ),
      },
    }),
  );
  await page.goto(`${origin}/check-ins`);
  await page.getByRole('button', { name: 'Show amounts' }).click();
  const rows = page.locator('.closed-checkin-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByText('Rate missing')).toHaveCount(1);
  await expect(rows.nth(1)).not.toContainText('Start');
  await expect(rows.nth(0)).not.toContainText('Rate missing');
  await expect(rows.nth(0)).not.toContainText(/▲|▼|Unchanged|Start/u);
});

test('the first check-in shows its totals without any comparison', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await page.goto(`${origin}/check-ins/${seed.first}`);
  await expect(page.getByText('First check-in')).toHaveCount(2);
  await expect(page.getByText(/^Compared with/u)).toHaveCount(0);
  await expect(page.getByText('From balances')).toHaveCount(0);
  await expect(page.getByText('From exchange rates')).toHaveCount(0);
  await expect(page.getByText('Biggest changes')).toHaveCount(0);
  await expect(page.getByText('Change by')).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'EUR', exact: true }),
  ).toContainText('€1,520.00');
  await expect(
    page.getByRole('group', { name: 'EUR', exact: true }),
  ).not.toContainText('was');
});

test('the chart has a pill per currency and Today’s rates changes the series', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  await page.goto(`${origin}/check-ins/${seed.second}`);
  const series = page.getByRole('radiogroup', { name: 'Series' });
  for (const name of ['All in EUR', 'EUR', 'USD', 'RUB', 'BTC']) {
    await expect(
      series.getByRole('radio', { name, exact: true }),
    ).toBeVisible();
  }
  await expect(series.getByRole('radio', { name: 'All in EUR' })).toBeChecked();
  await expect(page.getByText('Each check-in at its own rate')).toBeVisible();

  const dated = await (
    await page.context().request.get(`${origin}/api/wealth/series`)
  ).json();
  const real = wealthSeriesSchema.parse(dated);
  const highDated = formatMoney(BigInt(real.points.at(-1)!.amount!), eur);
  await expect(page.getByText(`High ${highDated}`)).toBeVisible();

  // The server answers the request; the test doubles every amount so the
  // screen's reaction to the new series is visible.
  let todayQuery: string | null = null;
  await page.route('**/api/wealth/series?*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.searchParams.get('rates') !== 'today' ||
      url.searchParams.get('view') !== 'equivalent'
    ) {
      return route.continue();
    }
    todayQuery = url.search;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = wealthSeriesSchema.parse(await response.json());
    return route.fulfill({
      json: {
        ...body,
        points: body.points.map((point) => ({
          ...point,
          amount: (BigInt(point.amount!) * 2n).toString(),
        })),
      },
    });
  });
  await page.getByRole('radio', { name: 'Today’s rates' }).click();
  await expect(page.getByText('All at today’s rates')).toBeVisible();
  await expect(
    page.getByText(
      `High ${formatMoney(BigInt(real.points.at(-1)!.amount!) * 2n, eur)}`,
    ),
  ).toBeVisible();
  expect(todayQuery).toContain('view=equivalent');
  expect(todayQuery).toContain('rates=today');

  await series.getByRole('radio', { name: 'USD', exact: true }).click();
  await expect(page.getByText('High $4,620.00')).toBeVisible();
  await expect(page.getByText('Low $4,495.18')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Today’s rates' })).toHaveCount(
    0,
  );
});

test('a first check-in chart says there are not enough check-ins', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  const series = wealthSeriesSchema.parse(
    await (
      await page.context().request.get(`${origin}/api/wealth/series`)
    ).json(),
  );
  // Only the first check-in exists on the chart: a single point.
  await page.route('**/api/wealth/series?*', (route) =>
    route.fulfill({
      json: {
        ...series,
        points: series.points.filter((point) => point.checkinId === seed.first),
      },
    }),
  );
  await page.goto(`${origin}/check-ins/${seed.first}`);
  await expect(
    page.getByText('Not enough check-ins to chart yet.'),
  ).toBeVisible();
  await expect(page.getByText(/balance history/u)).toHaveCount(0);
  await expect(page.getByText(/over 1 check-ins/u)).toHaveCount(0);
});

test('a Biggest changes row opens its account', async ({ page }) => {
  const seed = await seedFamily(page.context());
  await page.goto(`${origin}/check-ins/${seed.second}`);
  const first = page.getByRole('link', { name: /Trade Republic · EUR/u });
  await expect(first).toContainText('Alena · Investment');
  await expect(first).toContainText('▲ €1,110.30');
  await expect(page.getByRole('link', { name: /T-Bank · RUB/u })).toContainText(
    '▼ ₽4,700.00',
  );
  await first.click();
  await expect(page).toHaveURL(`${origin}/accounts/${seed.tradeRepublic}`);
  await expect(
    page.getByRole('button', { name: 'Back to check-in summary' }),
  ).toBeVisible();
});

test('Change by switches between members and account types', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  const summary = await fetchSummary(page.context(), seed.second);
  await page.goto(`${origin}/check-ins/${seed.second}`);
  const rows = page.locator('.group-row');
  await expect(rows.nth(0)).toContainText('Alena');
  await expect(rows.nth(0)).toContainText('▲ €1,150.30');
  await expect(rows.nth(1)).toContainText('Max');
  await expect(rows.last()).toContainText('Total');
  await expect(rows.last()).toContainText(
    formatChange(BigInt(summary.fromBalances!), eur),
  );

  await page.getByRole('radio', { name: 'Account type' }).click();
  await expect(
    page.locator('.group-row', { hasText: 'Investment' }),
  ).toContainText('▲ €1,110.30');
  await expect(page.locator('.group-row', { hasText: 'Cash' })).toContainText(
    'Unchanged',
  );
  await expect(rows.last()).toContainText('Total');
});

test('"From balances" and "From exchange rates" follow their own values', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  const summary = await fetchSummary(page.context(), seed.second);
  // A currency whose accounts changed but whose family total is zero has no
  // rate to convert at, so "From balances" is null while the total is complete.
  await page.route(`**/api/checkins/${seed.second}/summary`, (route) =>
    route.fulfill({
      json: {
        ...summary,
        fromBalances: null,
        fromExchangeRates: '1234',
        total: { ...summary.total, complete: true },
      },
    }),
  );
  await page.goto(`${origin}/check-ins/${seed.second}`);
  const total = page.getByRole('region', { name: 'Total' });
  await expect(total.getByText('From exchange rates')).toBeVisible();
  await expect(total).toContainText('+€12.34');
  await expect(total.getByText('From balances')).toHaveCount(0);
});

test('a missing rate shows "Rate missing", never a guess', async ({ page }) => {
  const seed = await seedFamily(page.context());
  const summary = await fetchSummary(page.context(), seed.second);
  await page.route(`**/api/checkins/${seed.second}/summary`, (route) =>
    route.fulfill({
      json: {
        ...summary,
        total: {
          current: null,
          previous: null,
          change: null,
          direction: null,
          complete: false,
        },
        missingRates: [{ currency: 'RUB', date: summary.checkin.date }],
        fromBalances: null,
        fromExchangeRates: null,
      },
    }),
  );
  await page.goto(`${origin}/check-ins/${seed.second}`);
  const total = page.getByRole('region', { name: 'Total' });
  await expect(total).toContainText('Rate missing');
  await expect(total).toContainText('Rate missing for RUB on');
  await expect(total.getByText('From balances')).toHaveCount(0);
});

test('Back returns to where the summary was opened from', async ({ page }) => {
  const seed = await seedFamily(page.context());

  await page.goto(`${origin}/`);
  await page.getByRole('link', { name: 'Wealth history' }).click();
  // Wealth history opens the latest closed check-in (D3).
  await expect(page).toHaveURL(`${origin}/check-ins/${seed.second}`);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(`${origin}/`);

  await page.goto(`${origin}/check-ins`);
  await page
    .getByRole('link', { name: /Closed by itself|closed it/u })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${origin}/check-ins/\\d+$`, 'u'));
  await page.getByRole('button', { name: 'Back to check-ins' }).click();
  await expect(page).toHaveURL(`${origin}/check-ins`);

  // Opened by a reload or a notification, with no history to pop.
  await page.goto(`${origin}/check-ins/${seed.second}`);
  await page.getByRole('button', { name: 'Back to check-ins' }).click();
  await expect(page).toHaveURL(`${origin}/check-ins`);
});

test('the summary of an open check-in opens the check-in itself', async ({
  page,
}) => {
  const seed = await seedFamily(page.context());
  const open = await startCheckin(page.context());
  expect(open).toBeGreaterThan(seed.second);
  await page.goto(`${origin}/check-ins/${open}`);
  await expect(page).toHaveURL(`${origin}/check-in`);
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
});

test('an unknown check-in says so', async ({ page }) => {
  await seedFamily(page.context());
  await page.goto(`${origin}/check-ins/999`);
  await expect(page.getByRole('alert')).toHaveText(
    'This check-in doesn’t exist.',
  );
});

test('Check-ins lists each closed check-in’s total, hidden until the eye is tapped', async ({
  page,
}, testInfo) => {
  const seed = await seedFamily(page.context());
  const series = wealthSeriesSchema.parse(
    await (
      await page.context().request.get(`${origin}/api/wealth/series`)
    ).json(),
  );
  const totalOf = (id: number): string =>
    formatMoney(
      BigInt(series.points.find((point) => point.checkinId === id)!.amount!),
      eur,
    );

  await page.goto(`${origin}/check-ins`);
  await expect(
    page.getByRole('heading', { name: 'Closed · family total in EUR' }),
  ).toBeVisible();
  const rows = page.locator('.closed-checkin-row');
  await expect(rows).toHaveCount(2);
  // The newest closed check-in is first, and the total is masked.
  await expect(rows.nth(0).getByText('€ • • • • •')).toBeVisible();
  await expect(rows.nth(0)).toContainText('▲ up');
  await expect(rows.nth(1)).toContainText('Start');
  await expect(page.getByText(totalOf(seed.second))).toHaveCount(0);

  const eye = page.getByRole('button', { name: 'Show amounts' });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await eye.click();
  await expect(rows.nth(0)).toContainText(totalOf(seed.second));
  await expect(rows.nth(1)).toContainText(totalOf(seed.first));
  await expect(rows.nth(0)).toContainText('▲ up');
  await expect(
    page.getByRole('button', { name: 'Hide amounts' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Hide amounts' }).click();
  await expect(rows.nth(0).getByText('€ • • • • •')).toBeVisible();

  // A reload hides the totals again: the state is never stored.
  await page.getByRole('button', { name: 'Show amounts' }).click();
  await page.reload();
  await expect(rows.nth(0).getByText('€ • • • • •')).toBeVisible();

  if (testInfo.project.name === 'iphone') {
    await mkdir('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/CheckIns.png',
      scale: 'css',
    });
  }
});

/** `+€12.34`, `−€0.96` or `€0.00`, as the screen writes the two lines. */
function signed(amount: bigint): string {
  return `${amount > 0n ? '+' : ''}${formatMoney(amount, eur)}`;
}

async function fetchSummary(
  context: BrowserContext,
  id: number,
): Promise<CheckinSummary> {
  const response = await context.request.get(
    `${origin}/api/checkins/${id}/summary`,
  );
  expect(response.status()).toBe(200);
  return checkinSummarySchema.parse(await response.json());
}

/**
 * Two members, six accounts in EUR, USD, RUB and BTC, and two closed
 * check-ins: the first records the opening balances, the second changes
 * some of them and closes with one account carried forward.
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
    type: string,
    currency: string,
    openingBalance: string,
  ): Promise<number> =>
    (
      await post(context, '/api/accounts', {
        name,
        ownerMemberId,
        type,
        currency,
        openingBalance,
      })
    ).account.id;
  const tradeRepublic = await account(
    'Trade Republic',
    1,
    'investment',
    'EUR',
    '100000',
  );
  const ing = await account('ING Extra-Konto', 1, 'bank', 'EUR', '50000');
  const tBank = await account('T-Bank', 2, 'bank', 'RUB', '10120000');
  const revolut = await account('Revolut', 2, 'bank', 'USD', '462000');
  const bitcoin = await account('Bitcoin', 2, 'crypto', 'BTC', '4120000');
  const cash = await account('Cash', 1, 'cash', 'EUR', '2000');
  await ratesReady(context);

  const first = await startCheckin(context);
  for (const id of [tradeRepublic, ing, tBank, revolut, bitcoin, cash]) {
    await put(context, `/api/checkins/${first}/values/${id}`, { same: true });
  }
  await post(context, `/api/checkins/${first}/close`, {});
  await pause();

  const second = await startCheckin(context);
  await put(context, `/api/checkins/${second}/values/${tradeRepublic}`, {
    amount: '211030',
  });
  await put(context, `/api/checkins/${second}/values/${ing}`, {
    amount: '54000',
  });
  await put(context, `/api/checkins/${second}/values/${tBank}`, {
    amount: '9650000',
  });
  await put(context, `/api/checkins/${second}/values/${revolut}`, {
    amount: '449518',
  });
  await put(context, `/api/checkins/${second}/values/${bitcoin}`, {
    same: true,
  });
  await post(context, `/api/checkins/${second}/close`, {});
  return { first, second, tradeRepublic };
}

/** Waits until the backfill has stored a rate for every currency in use. */
async function ratesReady(context: BrowserContext): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await context.request.get(`${origin}/api/rates/status`);
    const status = (await response.json()) as {
      currencies: { code: string; latestDate: string | null }[];
    };
    if (
      status.currencies.length >= 3 &&
      status.currencies.every((currency) => currency.latestDate !== null)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The fixture rates were not stored');
}

/** Keeps two check-ins from closing in the same millisecond. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

async function startCheckin(context: BrowserContext): Promise<number> {
  return (await post(context, '/api/checkins', {})).checkin.id as number;
}

async function post(
  context: BrowserContext,
  url: string,
  data: unknown,
): Promise<Created> {
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
