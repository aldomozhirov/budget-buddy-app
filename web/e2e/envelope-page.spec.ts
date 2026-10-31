import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

type Database = {
  prepare(sql: string): {
    run(...values: unknown[]): { lastInsertRowid: bigint | number };
  };
  close(): void;
};

interface Family {
  origin: string;
  api: APIRequestContext;
  database: () => Database;
  today: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A real server with an empty family, one profile and one account. */
async function startFamily(
  page: Page,
  run: (family: Family) => Promise<void>,
): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-envelopes-e2e-'),
  );
  const server: ChildProcess = spawn(
    process.execPath,
    ['server/dist/index.js'],
    {
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
    },
  );
  try {
    await waitForServer(`${origin}/api/health`, server);
    const api = page.context().request;
    const setup = await api.post(`${origin}/api/setup`, {
      headers: { Origin: origin },
      data: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alena'],
      },
    });
    expect(setup.status()).toBe(201);
    const account = await api.post(`${origin}/api/accounts`, {
      headers: { Origin: origin },
      data: {
        name: 'Joint',
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '100000',
      },
    });
    expect(account.status()).toBe(201);
    const Sqlite = createRequire(path.resolve('server/package.json'))(
      'better-sqlite3',
    ) as new (filePath: string) => Database;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
    }).format(new Date());
    await run({
      origin,
      api,
      database: () =>
        new Sqlite(path.join(dataDirectory, 'budget-buddy.sqlite')),
      today: parts,
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit').catch(() => undefined);
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

async function createEnvelope(
  family: Family,
  body: Record<string, unknown>,
): Promise<number> {
  const response = await family.api.post(`${family.origin}/api/envelopes`, {
    headers: { Origin: family.origin },
    data: body,
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { envelope: { id: number } }).envelope.id;
}

async function typeAmount(scope: Locator, text: string): Promise<void> {
  for (const character of text) {
    await scope
      .getByRole('button', {
        name: character === '.' ? 'Decimal point' : character,
        exact: true,
      })
      .click();
  }
}

/** `2026-10` shifted by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  const moved = index + delta;
  return `${Math.floor(moved / 12)}-${String((moved % 12) + 1).padStart(2, '0')}`;
}

/** Inserts a confirmed expense charged to an envelope, as the API will. */
function seedExpenseOn(
  family: Family,
  envelopeId: number,
  date: string,
  amount: number,
  merchant: string,
): void {
  const database = family.database();
  const txn = database
    .prepare(
      `INSERT INTO txn (kind, date, account_id, amount, merchant, member_id,
         created_by, created_at, updated_by, updated_at)
       VALUES ('expense', ?, 1, ?, ?, 1, 1, 1, 1, 1)`,
    )
    .run(date, amount, merchant);
  database
    .prepare(
      `INSERT INTO txn_part (txn_id, position, amount, envelope_id,
         envelope_amount) VALUES (?, 1, ?, ?, ?)`,
    )
    .run(txn.lastInsertRowid, amount, envelopeId, amount);
  database.close();
}

/**
 * Gives a new envelope `spent.length` closed months of history: it started
 * that many months ago and was topped up on every 1st from its first month on
 * (the prototype's figures), and spent `spent[i]` (minor units) in the months
 * before this one.
 */
function seedMonths(
  family: Family,
  envelopeId: number,
  mode: 'reset' | 'carry_over',
  monthly: number,
  spent: number[],
): void {
  const month = family.today.slice(0, 7);
  const first = shiftMonth(month, -spent.length);
  const database = family.database();
  database
    .prepare(
      'UPDATE envelope SET starting_month = ?, topup_from_month = ? WHERE id = ?',
    )
    .run(first, first, envelopeId);
  database
    .prepare('UPDATE envelope_plan SET from_month = ? WHERE envelope_id = ?')
    .run(first, envelopeId);
  for (let delta = -spent.length; delta <= 0; delta += 1) {
    database
      .prepare(
        `INSERT INTO envelope_topup (envelope_id, month, amount, mode,
           created_at) VALUES (?, ?, ?, ?, 1)`,
      )
      .run(envelopeId, shiftMonth(month, delta), monthly, mode);
  }
  database.close();
  spent.forEach((amount, index) => {
    seedExpenseOn(
      family,
      envelopeId,
      `${shiftMonth(month, index - spent.length)}-10`,
      amount,
      'REWE',
    );
  });
}

/** Groceries: a reset envelope of €500.00 with the prototype's history. */
async function seedGroceries(family: Family): Promise<number> {
  const id = await createEnvelope(family, {
    name: 'Groceries',
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
    startingBalance: '0',
  });
  seedMonths(family, id, 'reset', 50000, [46800, 53200, 45500, 49700, 54100]);
  // The prototype's six expenses this month: €312.40, so €187.60 is left.
  for (const [merchant, amount] of [
    ['REWE', 6420],
    ['Lidl', 2380],
    ['Edeka', 4115],
    ['Wochenmarkt', 7200],
    ['Aldi', 1890],
    ['REWE', 9235],
  ] as const) {
    seedExpenseOn(family, id, family.today, amount, merchant);
  }
  return id;
}

/**
 * What the hero says about the rest of the month: "N days to go", or "last
 * day of the month" on its last day.
 */
function daysLeft(today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const left = new Date(Date.UTC(year!, month!, 0)).getUTCDate() - day!;
  if (left === 0) return 'last day of the month';
  return `${left} ${left === 1 ? 'day' : 'days'} to go`;
}

function monthName(month: string): string {
  return MONTHS[Number(month.slice(5)) - 1]!;
}

test('History shows the bars, the statistics and the monthly records', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const id = await seedGroceries(family);
    const month = family.today.slice(0, 7);
    const last = shiftMonth(month, -1);

    await page.goto(`${family.origin}/envelopes/${id}?tab=history`);
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const chart = page.getByRole('img', { name: /^Spent per month against/ });
    await expect(chart.locator('rect')).toHaveCount(6);
    await expect(page.getByText('€500.00 limit')).toBeVisible();
    await expect(page.getByText('3 of 5 months')).toBeVisible();
    await expect(page.getByText('€498.60')).toBeVisible();
    await expect(
      page.getByText(`€41.00 · ${monthName(last).slice(0, 3)}`),
    ).toBeVisible();
    await expect(page.getByText('+€7.00')).toBeVisible();
    await expect(page.getByText('Within budget')).toBeVisible();

    // Last month's record, as the prototype has it: €41.00 over.
    const record = page
      .getByText(`${monthName(last)} ${last.slice(0, 4)}`)
      .locator('xpath=ancestor::div[contains(@class, "row")][1]');
    await expect(record).toContainText('€541.00 spent of €500.00');
    await expect(record).toContainText('€41.00 over');

    await page.getByRole('button', { name: 'Last 6 months' }).click();
    const picker = page.getByRole('dialog', { name: 'Period' });
    await expect(picker.getByRole('radio')).toHaveText([
      'Last 6 months',
      'Last 12 months',
      'This year',
      'All',
    ]);
    await picker.getByRole('radio', { name: 'All' }).click();
    await expect(picker).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'All', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('3 of 5 months')).toBeVisible();

    if (testInfo.project.name === 'iphone') {
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await picker.getByRole('radio', { name: 'Last 6 months' }).click();
      await page.waitForTimeout(1200);
      await saveScreenshot(page, 'EnvelopeHistory.png');
    }
  });
});

test('the month tab adjusts the balance and the cog opens the edit page', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const id = await seedGroceries(family);
    const month = family.today.slice(0, 7);

    await page.goto(`${family.origin}/envelopes/${id}`);
    await expect(
      page.getByRole('heading', { name: 'Groceries', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText('€500.00 a month · resets on the 1st'),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: monthName(month) }),
    ).toHaveAttribute('aria-selected', 'true');
    const hero = page.getByRole('region', { name: 'This month' });
    await expect(hero).toContainText('€187.60');
    await expect(hero).toContainText(
      `€312.40 spent of €500.00 · 6 expenses · ${daysLeft(family.today)}`,
    );
    // The expense row names the day, the payer and the account, and opens
    // the transaction page (task 15).
    await expect(page.getByText('Today · Alena · Joint')).toHaveCount(6);
    await expect(
      page.getByRole('link', { name: /REWE/ }).first(),
    ).toHaveAttribute('href', /\/transactions\/\d+$/u);

    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(1200);
      await saveScreenshot(page, 'EnvelopeDetail.png');
    }

    await page.getByRole('button', { name: 'Adjust' }).click();
    const sheet = page.getByRole('dialog', { name: 'Adjust balance' });
    await expect(
      sheet.getByText('Use − to take money out. Applies to this month only.'),
    ).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: 'Enter an amount' }),
    ).toBeDisabled();
    await sheet.getByRole('button', { name: 'Minus' }).click();
    await typeAmount(sheet, '20');
    await sheet.getByLabel('Note').fill('Cash for the market');
    await sheet.getByRole('button', { name: 'Take out €20.00' }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByText('Took out €20.00 · Cash for the market'),
    ).toBeVisible();
    await expect(hero).toContainText('€167.60');

    // The settings button is the cog and opens the edit page.
    const cog = page.getByRole('link', { name: 'Edit envelope' });
    await expect(cog.locator('svg.lucide-settings')).toHaveCount(1);
    await cog.click();
    await expect(page).toHaveURL(new RegExp(`/envelopes/${id}/edit$`));
    const edit = page.getByRole('main');
    await expect(
      edit.getByRole('heading', { name: 'Edit envelope', level: 1 }),
    ).toBeVisible();
    await expect(edit.getByLabel('Name', { exact: true })).toHaveValue(
      'Groceries',
    );
    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(1200);
      await saveScreenshot(page, 'EnvelopeEdit.png');
    }
    // Back returns to the envelope page.
    await edit
      .getByRole('button', { name: 'Back to envelope', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/envelopes/${id}$`));
    await expect(
      page.getByRole('heading', { name: 'Groceries', level: 1 }),
    ).toBeVisible();
  });
});

test('Delete and Archive on the edit page leave the envelope out of Back', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seedGroceries(family);
    await createEnvelope(family, {
      name: 'Spare',
      currency: 'EUR',
      monthlyAmount: '1000',
      mode: 'reset',
      startingBalance: '0',
    });

    // Settings → Envelopes → envelope → cog → Archive / Delete: Back on
    // Envelopes leads to Settings, not to the removed envelope.
    await createEnvelope(family, {
      name: 'Holiday',
      currency: 'EUR',
      monthlyAmount: '1000',
      mode: 'reset',
      startingBalance: '0',
    });

    // The third run opens the envelope from the History picker, so its page
    // is `?tab=history` in the Back stack.
    for (const [name, action, via] of [
      ['Groceries', 'Archive', 'card'],
      ['Spare', 'Delete', 'card'],
      ['Holiday', 'Delete', 'history'],
    ] as const) {
      await page.goto(`${family.origin}/settings`);
      await page
        .getByRole('region', { name: 'Spending' })
        .getByRole('link', { name: /Envelopes/ })
        .click();
      if (via === 'history') {
        await page.getByRole('button', { name: 'History' }).click();
        await page
          .getByRole('dialog', { name: 'History' })
          .getByRole('link', { name: new RegExp(name) })
          .click();
        await expect(page).toHaveURL(/\/envelopes\/\d+\?tab=history$/);
      } else {
        await page.getByRole('link', { name: new RegExp(name) }).click();
      }
      await page.getByRole('link', { name: 'Edit envelope' }).click();
      await expect(page).toHaveURL(/\/envelopes\/\d+\/edit$/);
      await page.getByRole('button', { name: action, exact: true }).click();
      if (action === 'Delete') {
        await page
          .getByRole('dialog', { name: `Delete ${name}?` })
          .getByRole('button', { name: 'Delete' })
          .click();
      }
      await expect(page).toHaveURL(/\/envelopes$/);
      await expect(
        page.getByRole('button', { name: 'Back to settings' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Back to envelope', exact: true }),
      ).toHaveCount(0);
    }
  });
});

test('a carry-over envelope shows its carried amount, a pending plan and moves', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const month = family.today.slice(0, 7);
    const previous = shiftMonth(month, -1);
    const unexpected = await createEnvelope(family, {
      name: 'Unexpected',
      currency: 'EUR',
      monthlyAmount: '30000',
      mode: 'carry_over',
      startingBalance: '0',
    });
    // September closed with €120.00 left; this month adds €300.00.
    seedMonths(family, unexpected, 'carry_over', 30000, [18000]);
    seedExpenseOn(family, unexpected, family.today, 1250, 'Apotheke');
    seedExpenseOn(family, unexpected, family.today, 3250, 'Amazon');
    const eatingOut = await createEnvelope(family, {
      name: 'Eating out',
      currency: 'EUR',
      monthlyAmount: '20000',
      mode: 'reset',
      startingBalance: '20000',
    });
    // The new plan starts next month (O4).
    const planned = await family.api.patch(
      `${family.origin}/api/envelopes/${unexpected}`,
      { headers: { Origin: family.origin }, data: { monthlyAmount: '35000' } },
    );
    expect(planned.status()).toBe(200);

    await page.goto(`${family.origin}/envelopes/${unexpected}`);
    await expect(
      page.getByText('€300.00 a month · carries over on the 1st'),
    ).toBeVisible();
    await expect(
      page.getByText(
        `From 1 ${monthName(shiftMonth(month, 1))}: €350.00 a month`,
      ),
    ).toBeVisible();
    const hero = page.getByRole('region', { name: 'This month' });
    await expect(hero).toContainText('€375.00');
    await expect(hero).toContainText('€45.00 spent of €420.00 · 2 expenses');
    await expect(hero).toContainText(
      `€300.00 + €120.00 carried from ${monthName(previous)}`,
    );

    // Adjust: the carry-over hint, then a gift of €50.00.
    await page.getByRole('button', { name: 'Adjust' }).click();
    const adjust = page.getByRole('dialog', { name: 'Adjust balance' });
    await expect(
      adjust.getByText(
        'Use − to take money out. It carries over to next month.',
      ),
    ).toBeVisible();
    await typeAmount(adjust, '50');
    await adjust.getByLabel('Note').fill('Birthday money');
    await adjust.getByRole('button', { name: 'Add €50.00' }).click();
    await expect(adjust).toBeHidden();
    await expect(page.getByText('Added €50.00 · Birthday money')).toBeVisible();

    // Move €50.00 to Eating out from the sheet the URL asks for.
    await page.goto(`${family.origin}/envelopes/${unexpected}?sheet=move`);
    const move = page.getByRole('dialog', { name: 'Move money' });
    await expect(
      move
        .getByRole('radiogroup', { name: 'From' })
        .getByRole('radio', { name: 'Unexpected' }),
    ).toBeChecked();
    await typeAmount(move, '50');
    await move
      .getByRole('button', { name: 'Move €50.00 to Eating out' })
      .click();
    await expect(move).toBeHidden();
    await expect(page.getByText('Moved €50.00 to Eating out')).toBeVisible();
    await expect(hero).toContainText('€375.00');

    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(1200);
      await saveScreenshot(page, 'EnvelopeCarryOver.png');
    }

    await page.goto(`${family.origin}/envelopes/${eatingOut}`);
    const eating = page.getByRole('region', { name: 'This month' });
    await expect(eating).toContainText('€250.00');

    // Deleting the move changes both envelopes back.
    await page.goto(`${family.origin}/envelopes/${unexpected}`);
    await page
      .getByRole('button', { name: /Moved €50.00 to Eating out/ })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Delete this move?' });
    await expect(
      confirm.getByText('Both envelopes change back.'),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('Moved €50.00 to Eating out')).toBeVisible();
    await page
      .getByRole('button', { name: /Moved €50.00 to Eating out/ })
      .click();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Moved €50.00 to Eating out')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'This month' }),
    ).toContainText('€425.00');
    await page.goto(`${family.origin}/envelopes/${eatingOut}`);
    await expect(
      page.getByRole('region', { name: 'This month' }),
    ).toContainText('€200.00');

    // Deleting an adjustment asks its own question.
    await page.goto(`${family.origin}/envelopes/${unexpected}`);
    await page.getByRole('button', { name: /Added €50.00/ }).click();
    await expect(
      page.getByRole('dialog', { name: 'Delete this adjustment?' }),
    ).toBeVisible();
  });
});

async function saveScreenshot(page: Page, name: string): Promise<void> {
  mkdirSync('test-results/screens', { recursive: true });
  await page.screenshot({ path: `test-results/screens/${name}` });
}

async function availablePort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a port');
  }
  await new Promise<void>((resolvePromise, reject) =>
    listener.close((error) => (error ? reject(error) : resolvePromise())),
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}
