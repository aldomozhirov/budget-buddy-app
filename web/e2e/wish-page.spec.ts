import { addMonths, type WishesResponse } from '@budget-buddy/shared';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { create, startFamily, type Family } from './support/family.js';

/**
 * A wish's page (spec 3a task 40; UI-WSH-4, UI-WSH-7). Links are seeded in
 * the database, since linking arrives with later tasks.
 */
const MONTH_NAMES = [
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

type Database = {
  prepare(sql: string): { run(...values: unknown[]): unknown };
  close(): void;
};

/** The hero card; the Wishes list may still be leaving behind it. */
function hero(page: Page) {
  return page.getByRole('region', { name: 'Wish' });
}

function nameOf(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1]!;
}

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'iphone') return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

/** The family's current month, as the server counts it. */
async function currentMonth(family: Family): Promise<string> {
  const response = await family.api.get(`${family.origin}/api/wishes`);
  return ((await response.json()) as WishesResponse).month;
}

/** Accounts: ING Visa in EUR and a dollar account. */
async function seedAccounts(
  family: Family,
): Promise<{ eur: number; usd: number }> {
  const base = {
    ownerMemberId: 1,
    type: 'bank',
    openingBalance: '100000',
  };
  const eur = await create(family, '/api/accounts', {
    ...base,
    name: 'ING Visa',
    currency: 'EUR',
  });
  const usd = await create(family, '/api/accounts', {
    ...base,
    name: 'Dollar card',
    currency: 'USD',
  });
  return { eur, usd };
}

/** An expense of today and the link that makes it count for the wish. */
async function spend(
  family: Family,
  wishId: number,
  month: string,
  expense: {
    accountId: number;
    amount: string;
    merchant: string;
    note: string;
    linkAmount: string;
    madeHow: 'recorded' | 'member';
  },
): Promise<number> {
  const id = await create(family, '/api/transactions', {
    kind: 'expense',
    accountId: expense.accountId,
    amount: expense.amount,
    merchant: expense.merchant,
    note: expense.note,
  });
  const Sqlite = createRequire(path.resolve('server/package.json'))(
    'better-sqlite3',
  ) as new (filePath: string) => Database;
  const database = new Sqlite(
    path.join(family.dataDirectory, 'budget-buddy.sqlite'),
  );
  database
    .prepare(
      `INSERT INTO plan_link (txn_id, kind, wish_id, month, amount,
         amount_manual, made_how, made_by, made_at)
       VALUES (?, 'wish', ?, ?, ?, 0, ?, ?, 1)`,
    )
    .run(
      id,
      wishId,
      month,
      expense.linkAmount,
      expense.madeHow,
      expense.madeHow === 'member' ? 1 : null,
    );
  database.close();
  return id;
}

/** Changes a wish's state through the API, as another member would. */
async function patch(
  family: Family,
  id: number,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await family.api.patch(`${family.origin}/api/wishes/${id}`, {
    headers: { Origin: family.origin },
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
}

function wishRequest(month: string, name: string, extra = {}) {
  return {
    month,
    name,
    amount: '35000',
    currency: 'EUR',
    categoryId: null,
    ...extra,
  };
}

test.describe('A wish’s page', () => {
  test('shows the header, hero and what was spent, and Back returns to Wishes', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const { eur } = await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Weekend in Salzburg', {
          note: 'Hotel for two nights and the train',
        }),
      );
      await spend(family, id, month, {
        accountId: eur,
        amount: '12000',
        merchant: 'Booking.com',
        note: 'Hotel deposit',
        linkAmount: '12000',
        madeHow: 'member',
      });

      await page.goto(`${family.origin}/wishes`);
      await page.getByRole('link', { name: /^Weekend in Salzburg/u }).click();

      await expect(
        page.getByRole('heading', { name: 'Weekend in Salzburg' }),
      ).toBeVisible();
      await expect(
        page.getByText(`${nameOf(month)} wish · €350.00`),
      ).toBeVisible();
      await expect(
        hero(page).getByText('€230.00 left', { exact: true }).first(),
      ).toBeVisible();
      await expect(
        hero(page).getByText('€120.00 spent of €350.00 · 1 expense'),
      ).toBeVisible();
      await expect(
        page.getByText('Hotel for two nights and the train'),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Tick off as done' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: `Move to ${nameOf(addMonths(month, 1))}`,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toBeVisible();
      await expect(page.getByText('Spent on it')).toBeVisible();

      // How it was linked, and it opens its transaction.
      const row = page.getByRole('link', { name: /Booking\.com/u });
      await expect(row).toContainText('Hotel deposit');
      await expect(row).toContainText('ING Visa · linked by Alena');
      await expect(row).toContainText('−€120.00');
      await screenshot(page, testInfo, 'WishDetail');
      await row.click();
      await expect(page).toHaveURL(/\/transactions\/\d+$/u);
      await page.goBack();

      const back = page.getByRole('button', { name: /^Back/u });
      await expect(back).toHaveCount(1);
      await back.click();
      await expect(page).toHaveURL(/\/wishes$/u);
    });
  });

  test('ticks off and reopens, and Undo reverses each', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const { eur } = await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Sofia’s birthday', { amount: '15000' }),
      );
      await spend(family, id, month, {
        accountId: eur,
        amount: '3280',
        merchant: 'Bäckerei Müller',
        note: 'Cake',
        linkAmount: '3280',
        madeHow: 'recorded',
      });
      await spend(family, id, month, {
        accountId: eur,
        amount: '10500',
        merchant: 'Thalia',
        note: 'Present',
        linkAmount: '10500',
        madeHow: 'recorded',
      });

      await page.goto(`${family.origin}/wishes/${id}`);
      await page.getByRole('button', { name: 'Tick off as done' }).click();
      await expect(page.getByText('Done', { exact: true })).toBeVisible();
      await expect(
        page.getByText('€137.80 spent', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('€137.80 spent of €150.00 · 2 expenses · €12.20 under'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: /Thalia/u })).toContainText(
        'recorded from the wish',
      );
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Move to/u })).toHaveCount(
        0,
      );
      await screenshot(page, testInfo, 'WishDone');

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(
        page.getByRole('button', { name: 'Tick off as done' }),
      ).toBeVisible();
      await expect(page.getByText('€12.20 under')).toHaveCount(0);

      await page.getByRole('button', { name: 'Tick off as done' }).click();
      await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
      await page.getByRole('button', { name: 'Reopen' }).click();
      await expect(
        page.getByRole('button', { name: 'Tick off as done' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
      await expect(page.getByText('Done', { exact: true })).toBeVisible();
    });
  });

  test('moves an open wish to the next month, and Undo moves it back', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const next = addMonths(month, 1);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Winter tyres'),
      );
      const later = await create(
        family,
        '/api/wishes',
        wishRequest(next, 'Next one'),
      );
      const finished = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Finished'),
      );
      await patch(family, finished, { state: 'done' });

      // Absent for a done wish and for another month.
      await page.goto(`${family.origin}/wishes/${finished}`);
      await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Move to/u })).toHaveCount(
        0,
      );
      await page.goto(`${family.origin}/wishes/${later}`);
      await expect(
        page.getByRole('button', { name: 'Tick off as done' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Move to/u })).toHaveCount(
        0,
      );

      await page.goto(`${family.origin}/wishes/${id}`);
      await page
        .getByRole('button', { name: `Move to ${nameOf(next)}` })
        .click();
      await expect(page.getByText(`${nameOf(next)} wish`)).toBeVisible();
      await expect(page.getByRole('button', { name: /^Move to/u })).toHaveCount(
        0,
      );

      await page.goto(`${family.origin}/wishes`);
      await expect(page.getByText('Winter tyres')).toHaveCount(0);
      await page.getByRole('button', { name: 'Next month' }).click();
      await expect(page.getByText('Winter tyres')).toBeVisible();
    });
  });

  test('Undo of a move puts the wish back in its month', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const next = addMonths(month, 1);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Winter tyres'),
      );
      await page.goto(`${family.origin}/wishes/${id}`);
      await page
        .getByRole('button', { name: `Move to ${nameOf(next)}` })
        .click();
      await expect(page.getByText(`${nameOf(next)} wish`)).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText(`${nameOf(month)} wish`)).toBeVisible();
      await expect(
        page.getByRole('button', { name: `Move to ${nameOf(next)}` }),
      ).toBeVisible();
    });
  });

  test('says when the wish was changed meanwhile', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Winter tyres'),
      );
      await page.goto(`${family.origin}/wishes/${id}`);
      await page.getByRole('button', { name: 'Tick off as done' }).click();
      await expect(page.getByText('Done', { exact: true })).toBeVisible();
      await patch(family, id, { state: 'dropped' });
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(
        page.getByText('Someone changed it meanwhile.'),
      ).toBeVisible();
    });
  });

  test('shows “counts as” for an expense in another currency', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const { usd } = await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Winter tyres'),
      );
      await spend(family, id, month, {
        accountId: usd,
        amount: '2500',
        merchant: 'Tire Shop',
        note: 'Tyres',
        linkAmount: '2140',
        madeHow: 'member',
      });
      await page.goto(`${family.origin}/wishes/${id}`);
      const row = page.getByRole('link', { name: /Tire Shop/u });
      await expect(row).toContainText('−$25.00');
      await expect(row).toContainText('counts as €21.40');
    });
  });

  test('offline, the buttons are disabled and the page says why', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await create(
        family,
        '/api/wishes',
        wishRequest(month, 'Winter tyres'),
      );
      await page.goto(`${family.origin}/wishes/${id}`);
      await expect(
        page.getByRole('button', { name: 'Tick off as done' }),
      ).toBeEnabled();
      await page.context().setOffline(true);
      await expect(
        page.getByText(
          'Offline. Recording and changing wishes need a connection.',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Tick off as done' }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: /^Move to/u }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', {
          name: 'Record as expense · needs a connection',
        }),
      ).toBeDisabled();
      await page.context().setOffline(false);
    });
  });
});
