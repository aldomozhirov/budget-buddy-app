import {
  expect,
  test,
  type APIRequestContext,
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

/** A real server with an empty family, one profile and one account. */
async function startFamily(
  page: Page,
  run: (family: Family) => Promise<void>,
): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-categories-e2e-'),
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

/** Posts to the API as a signed-in member and returns the new row's body. */
async function post(
  family: Family,
  route: string,
  data: Record<string, unknown>,
): Promise<{ id: number }> {
  const response = await family.api.post(`${family.origin}${route}`, {
    headers: { Origin: family.origin },
    data,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as Record<string, { id: number }>;
  return Object.values(body)[0]!;
}

async function createEnvelope(family: Family, name: string): Promise<number> {
  const envelope = await post(family, '/api/envelopes', {
    name,
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
    startingBalance: '18760',
  });
  return envelope.id;
}

async function createRule(
  family: Family,
  data: Record<string, unknown>,
): Promise<void> {
  await post(family, '/api/rules', data);
}

/** Inserts a confirmed expense that names a category. */
function seedExpense(family: Family, categoryId: number): void {
  const database = family.database();
  const txn = database
    .prepare(
      `INSERT INTO txn (kind, date, account_id, amount, merchant, member_id,
         created_by, created_at, updated_by, updated_at)
       VALUES ('expense', ?, 1, 1200, 'Apotheke', 1, 1, 1, 1, 1)`,
    )
    .run(family.today);
  database
    .prepare(
      `INSERT INTO txn_part (txn_id, position, amount, category_id)
       VALUES (?, 1, 1200, ?)`,
    )
    .run(txn.lastInsertRowid, categoryId);
  database.close();
}

const STARTERS = [
  'Groceries',
  'Eating out',
  'Housing',
  'Utilities',
  'Transport',
  'Health',
  'Insurance',
  'Subscriptions',
  'Shopping',
  'Travel',
  'Leisure',
  'Gifts',
  'Fees and taxes',
  'Other',
];

test('lists the starter categories and gives Groceries a default envelope', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const origin = family.origin;
    await createEnvelope(family, 'Groceries');
    await page.goto(`${origin}/settings`);
    await page
      .getByRole('region', { name: 'Spending' })
      .getByRole('link', { name: /Categories/ })
      .click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(
      page.getByRole('heading', { name: 'Categories' }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Expense' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Rules · 0' })).toBeVisible();

    // The starter list, in order, none used yet.
    const list = page.getByRole('list', { name: 'expense categories' });
    const rows = list.getByRole('button');
    await expect(rows).toHaveCount(STARTERS.length);
    for (const [index, name] of STARTERS.entries()) {
      await expect(rows.nth(index)).toContainText(name);
      await expect(rows.nth(index)).toContainText('unused');
    }
    await expect(page.getByText('Default envelope:')).toHaveCount(0);

    // Groceries gets the default envelope Groceries.
    await rows.nth(0).click();
    const sheet = page.getByRole('dialog', { name: 'Edit category' });
    await expect(sheet.getByLabel('Name', { exact: true })).toHaveValue(
      'Groceries',
    );
    await expect(
      sheet.getByText('Unused, so it can be deleted.'),
    ).toBeVisible();
    await sheet.getByRole('radio', { name: 'Groceries' }).click();
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(rows.nth(0)).toContainText('Default envelope: Groceries');

    // An income category has no default-envelope field.
    await page.getByRole('tab', { name: 'Income' }).click();
    const income = page.getByRole('list', { name: 'income categories' });
    await expect(income.getByRole('button')).toHaveText([
      /Salary.*unused/,
      /Other income.*unused/,
    ]);
    await income.getByRole('button', { name: /^Salary/ }).click();
    await expect(sheet.getByLabel('Name', { exact: true })).toHaveValue(
      'Salary',
    );
    await expect(sheet.getByText(/Default envelope/)).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();

    // Add "Pets", then delete it.
    await page.getByRole('tab', { name: 'Expense' }).click();
    await page.getByRole('button', { name: 'New category' }).click();
    const fresh = page.getByRole('dialog', { name: 'New category' });
    await expect(
      fresh.getByRole('button', { name: 'Name the category' }),
    ).toBeDisabled();
    await fresh.getByLabel('Name', { exact: true }).fill('Pets');
    await fresh.getByRole('button', { name: 'Add category' }).click();
    await expect(fresh).toBeHidden();
    await expect(rows).toHaveCount(STARTERS.length + 1);
    await expect(rows.last()).toContainText('Pets');
    await rows.last().click();
    await sheet.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Pets?' });
    await expect(confirm.getByText('It has no transactions.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(rows).toHaveCount(STARTERS.length);
    await expect(page.getByText('Pets')).toHaveCount(0);

    if (testInfo.project.name === 'iphone') {
      await page.reload();
      await expect(rows.nth(0)).toBeVisible();
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'Categories.png');
      await rows.nth(0).click();
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'CategoryEdit.png');
    }
  });
});

test('a used category can only be archived, and an unused one takes its rules along', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const origin = family.origin;
    seedExpense(family, 6);
    await createRule(family, { pattern: 'Reisebüro', categoryId: 10 });
    await createRule(family, { pattern: 'Apotheke', categoryId: 6 });
    await page.goto(`${origin}/categories`);
    const list = page.getByRole('list', { name: 'expense categories' });
    await expect(list.getByRole('button', { name: /^Health/ })).toContainText(
      '1 this year',
    );
    await expect(page.getByRole('tab', { name: 'Rules · 2' })).toBeVisible();

    // Health is used: Archive, with its hint, and no Delete.
    await list.getByRole('button', { name: /^Health/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit category' });
    await expect(
      sheet.getByText(
        'It has 1 transaction this year, so it can only be archived. It keeps this category.',
      ),
    ).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Archive' }).click();
    await expect(sheet).toBeHidden();
    await expect(list.getByRole('button', { name: /^Health/ })).toHaveCount(0);
    const archived = page.getByRole('list', { name: 'Archived categories' });
    await expect(
      page.getByRole('heading', { name: 'Archived · kept for history' }),
    ).toBeVisible();
    await expect(archived.getByRole('button')).toHaveText([
      /Health.*1 this year/,
    ]);

    // Restore it from its sheet.
    await archived.getByRole('button', { name: /^Health/ }).click();
    await expect(sheet.getByText(/can only be archived/)).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Restore' }).click();
    await expect(sheet).toBeHidden();
    await expect(list.getByRole('button', { name: /^Health/ })).toBeVisible();
    await expect(page.getByText('Archived · kept for history')).toHaveCount(0);

    // Travel is unused but a rule names it: the question says so (O13).
    await list.getByRole('button', { name: /^Travel/ }).click();
    await sheet.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Travel?' });
    await expect(
      confirm.getByText(
        'It has no transactions. 1 rule that names it is deleted too.',
      ),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(confirm).toBeHidden();
    await sheet.getByRole('button', { name: 'Delete' }).click();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(list.getByRole('button', { name: /^Travel/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Rules · 1' })).toBeVisible();

    if (testInfo.project.name === 'iphone') {
      await list.getByRole('button', { name: /^Health/ }).click();
      await sheet.getByRole('button', { name: 'Archive' }).click();
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'CategoriesArchived.png');
    }
  });
});

test('creates the rule "REWE, EDEKA" and moves it to first place', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const origin = family.origin;
    await createEnvelope(family, 'Groceries');
    await createRule(family, { pattern: 'Lieferando, Wolt', categoryId: 2 });
    await createRule(family, { pattern: 'Shell, Aral', categoryId: 5 });

    await page.goto(`${origin}/settings`);
    await page
      .getByRole('region', { name: 'Spending' })
      .getByRole('link', { name: /Rules/ })
      .click();
    await expect(page).toHaveURL(/\/categories\?tab=rules$/);
    await expect(page.getByRole('tab', { name: 'Rules · 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByText(
        'When a merchant matches, the expense gets this category and envelope. The first matching rule wins.',
      ),
    ).toBeVisible();
    const rules = page.getByRole('list', { name: 'Rules' });
    const items = rules.getByRole('listitem');
    await expect(
      page.getByRole('button', { name: 'Move rule 1 up' }),
    ).toBeDisabled();

    await page.getByRole('button', { name: 'New rule' }).click();
    const sheet = page.getByRole('dialog', { name: 'New rule' });
    await expect(
      sheet.getByRole('button', { name: 'Enter the words' }),
    ).toBeDisabled();
    await sheet.getByLabel('Merchant contains').fill('REWE, EDEKA');
    await expect(
      sheet.getByRole('button', { name: 'Choose a category' }),
    ).toBeDisabled();
    await sheet.getByRole('radio', { name: 'Groceries' }).first().click();
    await sheet
      .getByRole('radiogroup', { name: 'Envelope' })
      .getByRole('radio', { name: 'Groceries' })
      .click();
    await sheet.getByRole('button', { name: 'Add rule' }).click();
    await expect(sheet).toBeHidden();
    await expect(items).toHaveCount(3);
    await expect(items.nth(2)).toContainText('REWE, EDEKA');
    await expect(items.nth(2)).toContainText('→ Groceries · Groceries');

    // Two steps up put it first; the order is stored.
    await page.getByRole('button', { name: 'Move rule 3 up' }).click();
    await expect(items.nth(1)).toContainText('REWE, EDEKA');
    await page.getByRole('button', { name: 'Move rule 2 up' }).click();
    await expect(items.nth(0)).toContainText('REWE, EDEKA');
    await expect(items.nth(1)).toContainText('Lieferando, Wolt');
    await expect(
      page.getByRole('button', { name: 'Move rule 1 up' }),
    ).toBeDisabled();
    await page.reload();
    await expect(items.nth(0)).toContainText('REWE, EDEKA');
    await expect(items.nth(2)).toContainText('Shell, Aral');

    // Editing keeps the place; deleting asks and renumbers.
    await items.nth(0).getByRole('button', { name: /REWE/ }).click();
    const edit = page.getByRole('dialog', { name: 'Rule 1' });
    await expect(edit.getByLabel('Merchant contains')).toHaveValue(
      'REWE, EDEKA',
    );
    await edit.getByLabel('Merchant contains').fill('REWE, EDEKA, LIDL');
    await edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(items.nth(0)).toContainText('REWE, EDEKA, LIDL');
    await items
      .nth(1)
      .getByRole('button', { name: /Lieferando/ })
      .click();
    const second = page.getByRole('dialog', { name: 'Rule 2' });
    await second.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete rule 2?' });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(items).toHaveCount(2);
    await expect(page.getByRole('tab', { name: 'Rules · 2' })).toBeVisible();

    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'Rules.png');
      await page.getByRole('button', { name: 'New rule' }).click();
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'RuleNew.png');
    }
  });
});

test('the rule sheet picks a category, an envelope and an account from the Add form sheets', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const origin = family.origin;
    for (const name of ['Groceries', 'Eating out', 'Unexpected', 'Holiday']) {
      await createEnvelope(family, name);
    }
    for (const name of ['Revolut', 'Wise', 'Cash', 'Savings']) {
      await post(family, '/api/accounts', {
        name,
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '0',
      });
    }
    await page.goto(`${origin}/categories?tab=rules`);
    await page.getByRole('button', { name: 'New rule' }).click();
    const sheet = page.getByRole('dialog', { name: 'New rule' });
    await sheet.getByLabel('Merchant contains').fill('Amazon');

    // Category: three chips then "All…", the Add form's sheet with groups.
    await sheet.getByRole('button', { name: 'All categories' }).click();
    const categories = page.getByRole('dialog', { name: 'Category' });
    await expect(
      categories.getByRole('heading', { name: 'All categories' }),
    ).toHaveCSS('text-transform', 'uppercase');
    await categories.getByRole('searchbox').fill('shop');
    await categories.getByRole('radio', { name: 'Shopping' }).click();
    await expect(categories).toBeHidden();
    // The pick goes to the front of the row.
    await expect(
      sheet
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio')
        .first(),
    ).toHaveAccessibleName('Shopping');
    await expect(sheet.getByRole('radio', { name: 'Shopping' })).toBeChecked();

    // Envelope: four envelopes, so "None", three chips and "All…".
    await sheet.getByRole('button', { name: 'All envelopes' }).click();
    const envelopes = page.getByRole('dialog', { name: 'Envelope' });
    await expect(
      envelopes.getByRole('heading', { name: 'All envelopes' }),
    ).toHaveCSS('text-transform', 'uppercase');
    await expect(
      envelopes.getByRole('radio', { name: /Holiday/ }),
    ).toContainText('Resets monthly · €187.60 left');
    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'RuleEnvelopePicker.png');
    }
    await envelopes.getByRole('radio', { name: /Holiday/ }).click();
    await expect(
      sheet
        .getByRole('radiogroup', { name: 'Envelope' })
        .getByRole('radio', { name: 'Holiday' }),
    ).toBeChecked();

    // Account: "Any" and the first three, then "All…" with search.
    await expect(sheet.getByRole('radio', { name: 'Any' })).toBeChecked();
    await sheet.getByRole('button', { name: 'All accounts' }).click();
    const accounts = page.getByRole('dialog', { name: 'Only for account' });
    await expect(
      accounts.getByRole('heading', { name: 'All accounts' }),
    ).toHaveCSS('text-transform', 'uppercase');
    await accounts.getByRole('searchbox').fill('sav');
    if (testInfo.project.name === 'iphone') {
      await page.waitForTimeout(700);
      await saveScreenshot(page, 'RuleAccountPicker.png');
    }
    await accounts.getByRole('radio', { name: /Savings · EUR/ }).click();
    await expect(
      sheet
        .getByRole('radiogroup', { name: 'Only for account' })
        .getByRole('radio')
        .nth(1),
    ).toHaveAccessibleName('Savings');
    await sheet.getByRole('button', { name: 'Add rule' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('listitem').first()).toContainText(
      '→ Shopping · Holiday · only Savings',
    );
  });
});

test('categories and rules fit the screen: no horizontal scroll', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await createRule(family, {
      pattern: 'A very long list of words, separated by commas, for one rule',
      categoryId: 13,
    });
    for (const tab of ['expense', 'income', 'rules']) {
      await page.goto(`${family.origin}/categories?tab=${tab}`);
      await expect(page.getByRole('tab', { name: /Rules/ })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
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
