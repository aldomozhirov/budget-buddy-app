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

/** Inserts a confirmed expense charged to an envelope, as the API will. */
function seedExpense(family: Family, envelopeId: number, amount: number): void {
  const database = family.database();
  const txn = database
    .prepare(
      `INSERT INTO txn (kind, date, account_id, amount, merchant, member_id,
         created_by, created_at, updated_by, updated_at)
       VALUES ('expense', ?, 1, ?, 'REWE', 1, 1, 1, 1, 1)`,
    )
    .run(family.today, amount);
  database
    .prepare(
      `INSERT INTO txn_part (txn_id, position, amount, envelope_id,
         envelope_amount) VALUES (?, 1, ?, ?, ?)`,
    )
    .run(txn.lastInsertRowid, amount, envelopeId, amount);
  database.close();
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

test('creates two envelopes, shows their cards and moves money between them', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const origin = family.origin;
    const month = MONTHS[Number(family.today.slice(5, 7)) - 1]!;
    const next = MONTHS[Number(family.today.slice(5, 7)) % 12]!;

    await page.goto(`${origin}/settings`);
    const spending = page.getByRole('region', { name: 'Spending' });
    await expect(
      spending.getByRole('link', { name: /Envelopes/ }),
    ).toContainText('0 · top up on the 1st');
    await spending.getByRole('link', { name: /Envelopes/ }).click();
    await expect(page).toHaveURL(/\/envelopes$/);
    await expect(
      page.getByText(`${month} · next top-up on 1 ${next}`),
    ).toBeVisible();

    // Groceries: €500.00, resets, starting €187.60.
    await page.getByRole('link', { name: 'New envelope' }).click();
    await expect(page).toHaveURL(/\/envelopes\/new$/);
    const sheet = page.getByRole('main');
    await expect(
      sheet.getByRole('heading', { name: 'New envelope', level: 1 }),
    ).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: 'Name the envelope' }),
    ).toBeDisabled();
    await sheet.getByLabel('Name', { exact: true }).fill('Groceries');
    await sheet.getByRole('button', { name: 'Monthly amount' }).click();
    await typeAmount(sheet, '500');
    await expect(
      sheet.getByRole('button', { name: 'Monthly amount' }),
    ).toContainText('€500.00');
    await expect(
      sheet.getByRole('radio', { name: 'Resets monthly' }),
    ).toBeChecked();
    await sheet
      .getByRole('button', { name: 'Starting balance · what’s in it now' })
      .click();
    await typeAmount(sheet, '187.60');
    await sheet.getByRole('button', { name: 'Add envelope' }).click();
    // Saving opens the new envelope's page; Back returns to Envelopes.
    await expect(page).toHaveURL(/\/envelopes\/\d+$/);
    await expect(
      page.getByRole('heading', { name: 'Groceries', level: 1 }),
    ).toBeVisible();
    await backToEnvelopes(page);

    // Unexpected: €300.00, carries over; the starting balance is proposed.
    await page.getByRole('link', { name: 'New envelope' }).click();
    await sheet.getByLabel('Name', { exact: true }).fill('Unexpected');
    await sheet.getByRole('button', { name: 'Monthly amount' }).click();
    await typeAmount(sheet, '300');
    await sheet.getByRole('radio', { name: 'Carries over' }).click();
    await expect(
      sheet.getByText(
        'On the 1st the monthly amount is added to what’s left, or to the overspend.',
      ),
    ).toBeVisible();
    await expect(sheet.getByText('Proposed: the monthly amount')).toBeVisible();
    await sheet.getByRole('button', { name: 'Add envelope' }).click();
    await expect(page).toHaveURL(/\/envelopes\/\d+$/);
    await backToEnvelopes(page);

    const groceries = page.getByRole('link', { name: /Groceries/ });
    await expect(groceries).toContainText('Resets monthly');
    await expect(groceries).toContainText('€187.60');
    await expect(groceries).toContainText('left');
    await expect(groceries).toContainText(
      '€0.00 spent of €187.60 · starting balance',
    );
    const unexpected = page.getByRole('link', { name: /Unexpected/ });
    await expect(unexpected).toContainText('Carries over');
    await expect(unexpected).toContainText('€300.00');
    // The total is the sum of the cards: 187.60 + 300.00.
    await expect(
      page.getByText('Left in all envelopes').locator('..'),
    ).toContainText('€487.60');

    // A USD envelope through "Other…": the sheet is searchable and grouped.
    await page.getByRole('link', { name: 'New envelope' }).click();
    await sheet.getByLabel('Name', { exact: true }).fill('Holiday');
    await sheet.getByRole('button', { name: 'Other currency or coin' }).click();
    const picker = page.getByRole('dialog', { name: 'Currency or coin' });
    await expect(
      picker.getByRole('heading', { name: 'All currencies and coins' }),
    ).toHaveCSS('text-transform', 'uppercase');
    await expect(picker.getByRole('heading', { name: 'In use' })).toBeVisible();
    await picker.getByRole('searchbox').fill('dollar');
    await picker
      .getByRole('radio', { name: /USD · / })
      .first()
      .click();
    await expect(picker).toBeHidden();
    await expect(sheet.getByRole('radio', { name: 'USD' })).toBeChecked();
    await sheet.getByRole('button', { name: 'Add envelope' }).click();
    await expect(page).toHaveURL(/\/envelopes\/\d+$/);
    await backToEnvelopes(page);
    await expect(page.getByRole('link', { name: /Holiday/ })).toContainText(
      '$0.00',
    );

    // Move €50.00 from Groceries: "To" lists only the EUR envelope.
    await page.getByRole('button', { name: 'Move money' }).click();
    const move = page.getByRole('dialog', { name: 'Move money' });
    await expect(
      move.getByRole('radiogroup', { name: 'To' }).getByRole('radio'),
    ).toHaveText(['Unexpected']);
    await expect(move.getByText('Groceries has €187.60 left')).toBeVisible();
    await typeAmount(move, '50');
    await expect(
      move.getByRole('button', { name: 'Move €50.00 to Unexpected' }),
    ).toBeVisible();
    await typeAmount(move, '0');
    await expect(move.getByText('Groceries has €187.60 left')).toHaveCSS(
      'color',
      'rgb(162, 71, 15)',
    );
    await move.getByRole('button', { name: 'Clear', exact: true }).click();
    await typeAmount(move, '50');
    await move
      .getByRole('button', { name: 'Move €50.00 to Unexpected' })
      .click();
    await expect(move).toBeHidden();
    await expect(groceries).toContainText('€137.60');
    await expect(unexpected).toContainText('€350.00');

    // The Settings row now counts three envelopes.
    await page.goto(`${origin}/settings`);
    await expect(
      page
        .getByRole('region', { name: 'Spending' })
        .getByRole('link', { name: /Envelopes/ }),
    ).toContainText('3 · top up on the 1st');

    if (testInfo.project.name === 'iphone') {
      await page.goto(`${origin}/envelopes`);
      await expect(page.getByRole('link', { name: /Holiday/ })).toBeVisible();
      await saveScreenshot(page, 'Envelopes.png');
      await page.getByRole('link', { name: 'New envelope' }).click();
      await expect(
        page.getByRole('heading', { name: 'New envelope', level: 1 }),
      ).toBeVisible();
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'EnvelopeNew.png');
      await page.getByRole('button', { name: 'Back to envelopes' }).click();
      await page.getByRole('button', { name: 'Move money' }).click();
      await typeAmount(page.getByRole('dialog', { name: 'Move money' }), '50');
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'EnvelopesMove.png');
    }
  });
});

test('shows an overspent envelope, the History picker and Archived envelopes', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const origin = family.origin;
    const eatingOut = await createEnvelope(family, {
      name: 'Eating out',
      currency: 'EUR',
      monthlyAmount: '20000',
      mode: 'reset',
      startingBalance: '20000',
    });
    const holiday = await createEnvelope(family, {
      name: 'Holiday',
      currency: 'EUR',
      monthlyAmount: '10000',
      mode: 'carry_over',
    });
    seedExpense(family, eatingOut, 21450);
    for (let index = 0; index < 3; index += 1)
      seedExpense(family, holiday, 100);

    await page.goto(`${origin}/envelopes`);
    const card = page.getByRole('link', { name: /Eating out/ });
    await expect(card).toContainText('−€14.50');
    await expect(card).toContainText('overspent');
    await expect(card).toContainText(
      '€214.50 spent of €200.00 · starting balance',
    );
    await expect(card).toHaveCSS(
      'box-shadow',
      /rgb\(162, 71, 15\) 0px 0px 0px 1\.5px inset/,
    );
    await expect(
      page.getByRole('link', { name: /Archived envelopes · 0/ }),
    ).toBeVisible();

    // The History picker: mode, start and the count of months, then a pick.
    await page.getByRole('button', { name: 'History' }).click();
    const picker = page.getByRole('dialog', { name: 'History' });
    await expect(
      picker.getByText('Pick an envelope to see its months.'),
    ).toBeVisible();
    await expect(
      picker.getByRole('link', { name: /Eating out/ }),
    ).toContainText('Resets monthly · since');
    await expect(
      picker.getByRole('link', { name: /Eating out/ }),
    ).toContainText('No closed month yet');
    await picker.getByRole('link', { name: /Holiday/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/envelopes/${holiday}\\?tab=history$`),
    );

    // Archive one through the API; its row names who archived it.
    const archived = await family.api.patch(
      `${origin}/api/envelopes/${holiday}`,
      { headers: { Origin: origin }, data: { archived: true } },
    );
    expect(archived.status()).toBe(200);
    await page.goto(`${origin}/envelopes`);
    await page.getByRole('link', { name: /Archived envelopes · 1/ }).click();
    await expect(page).toHaveURL(/\/envelopes\/archived$/);
    await expect(
      page.getByRole('heading', { name: 'Archived envelopes' }),
    ).toBeVisible();
    await expect(
      page.getByText(/^Archived \d{1,2} \w{3} \d{4} by Alena$/),
    ).toBeVisible();
    await expect(
      page.getByText(/^−?€\d+\.\d\d left · 3 expenses · /),
    ).toBeVisible();
    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'ArchivedEnvelopes.png');
    }
    await page.getByRole('button', { name: 'Restore Holiday' }).click();
    await expect(page.getByText('Holiday is restored.')).toBeVisible();
    await expect(page.getByText('No archived envelopes.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.getByRole('button', { name: 'Restore Holiday' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Restore Holiday' }).click();
    await backToEnvelopes(page);
    await expect(
      page.getByRole('link', { name: /Archived envelopes · 0/ }),
    ).toBeVisible();
  });
});

test('the move sheet offers only envelopes of the same currency', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await createEnvelope(family, {
      name: 'Eating out',
      currency: 'EUR',
      monthlyAmount: '1000',
      mode: 'reset',
    });
    await createEnvelope(family, {
      name: 'Trips',
      currency: 'USD',
      monthlyAmount: '1000',
      mode: 'reset',
    });
    await page.goto(`${family.origin}/envelopes`);
    // Two envelopes, no pair in one currency: nothing to move to.
    await page.getByRole('button', { name: 'Move money' }).click();
    const move = page.getByRole('dialog', { name: 'Move money' });
    await expect(move.getByText('No other envelope in EUR.')).toBeVisible();
    await move.getByRole('radio', { name: 'Trips' }).click();
    await expect(move.getByText('No other envelope in USD.')).toBeVisible();
  });
});

/** Taps Back on an envelope or form page and waits for Envelopes to settle. */
async function backToEnvelopes(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back to envelopes' }).click();
  await expect(page).toHaveURL(/\/envelopes$/);
  // The leaving screen stays in the page until its transition ends.
  await expect(
    page.getByRole('button', { name: 'Back to envelopes' }),
  ).toHaveCount(0);
}

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
