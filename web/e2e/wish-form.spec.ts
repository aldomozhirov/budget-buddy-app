import { addMonths, type WishesResponse } from '@budget-buddy/shared';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { create, startFamily, type Family } from './support/family.js';

/**
 * New and edit wish (spec 3a task 47; UI-WSH-3): the form pages, drop and
 * delete with Undo. Links are seeded in the database.
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

async function currentMonth(family: Family): Promise<string> {
  const response = await family.api.get(`${family.origin}/api/wishes`);
  return ((await response.json()) as WishesResponse).month;
}

async function key(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

/** An expense of today, linked to the wish in the database. */
async function spend(
  family: Family,
  wishId: number,
  month: string,
): Promise<number> {
  const account = await create(family, '/api/accounts', {
    ownerMemberId: 1,
    type: 'bank',
    openingBalance: '100000',
    name: 'ING Visa',
    currency: 'EUR',
  });
  const id = await create(family, '/api/transactions', {
    kind: 'expense',
    accountId: account,
    amount: '12000',
    merchant: 'Booking.com',
    note: 'Hotel deposit',
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
       VALUES (?, 'wish', ?, ?, '12000', 0, 'member', 1, 1)`,
    )
    .run(id, wishId, month);
  database.close();
  return id;
}

/** What an expense counts for, as its page reads it. */
async function countsFor(family: Family, id: number): Promise<string> {
  const response = await family.api.get(
    `${family.origin}/api/transactions/${id}`,
  );
  const body = (await response.json()) as {
    transaction: { countsFor: { type: string } };
  };
  return body.transaction.countsFor.type;
}

async function addWish(family: Family, month: string, name: string) {
  return create(family, '/api/wishes', {
    month,
    name,
    amount: '35000',
    currency: 'EUR',
    categoryId: null,
  });
}

test.describe('New and edit wish', () => {
  test('adds a wish from "+" on a coming month', async ({ page }, testInfo) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const next = addMonths(month, 1);
      await page.goto(`${family.origin}/wishes`);
      await page.getByRole('button', { name: 'Next month' }).click();
      await page.getByRole('link', { name: 'New wish' }).click();
      await expect(page).toHaveURL(new RegExp(`/wishes/new\\?month=${next}`));
      await expect(
        page.getByText(`For ${nameOf(next)}`, { exact: true }),
      ).toBeVisible();

      const button = page.locator('footer').getByRole('button').last();
      await expect(button).toHaveText('Name the wish');
      await expect(button).toBeDisabled();
      await page.getByLabel('Name', { exact: true }).fill('Winter coat');
      await expect(button).toHaveText('Enter the amount');
      await page.getByRole('button', { name: 'Amount', exact: true }).click();
      for (const k of ['2', '8', '2']) await key(page, k);
      await key(page, 'Plus');
      for (const k of ['7', '5']) await key(page, k);
      await expect(page.getByText('€357.00', { exact: true })).toBeVisible();
      await expect(page.getByText('282+75')).toBeVisible();
      await expect(button).toHaveText('Add €357.00');
      await screenshot(page, testInfo, 'WishForm');

      await button.click();
      await expect(page).toHaveURL(/\/wishes$/u);
      await expect(
        page.getByText(`Winter coat added to ${nameOf(next)}.`),
      ).toBeVisible();
      await expect(page.locator('.wishes-month-name')).toHaveText(
        `${nameOf(next)} ${next.slice(0, 4)}`,
      );
      await expect(page.getByText('Winter coat').first()).toBeVisible();

      const stored = (await (
        await family.api.get(`${family.origin}/api/wishes?month=${next}`)
      ).json()) as WishesResponse;
      expect(stored.wishes[0]).toMatchObject({
        name: 'Winter coat',
        amount: '35700',
        expression: '282+75',
        month: next,
      });
    });
  });

  test('edits a wish from the cog', async ({ page }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      await create(family, '/api/accounts', {
        ownerMemberId: 1,
        type: 'bank',
        openingBalance: '0',
        name: 'Dollar card',
        currency: 'USD',
      });
      const id = await addWish(family, month, 'Winter tyres');
      await page.goto(`${family.origin}/wishes/${id}`);
      await page.getByRole('link', { name: 'Edit wish' }).click();
      await expect(page).toHaveURL(/\/edit$/u);
      const button = page.locator('footer').getByRole('button').last();
      await expect(button).toHaveText('Save');

      await page.getByLabel('Name', { exact: true }).fill('Summer tyres');
      await page.getByRole('radio', { name: 'USD' }).click();
      await page.getByRole('radio', { name: 'Groceries' }).click();
      await page.getByLabel('Note · optional').fill('Before the first snow');
      await page.getByRole('button', { name: 'Amount', exact: true }).click();
      await key(page, 'Clear');
      for (const k of ['1', '2', '0']) await key(page, k);
      await button.click();

      await expect(page).toHaveURL(/\/wishes\/\d+$/u);
      await expect(
        page.getByRole('heading', { name: 'Summer tyres' }),
      ).toBeVisible();
      await expect(page.getByText('$120.00').first()).toBeVisible();
      await expect(page.getByText('Before the first snow')).toBeVisible();
      await expect(page.getByText(/Groceries/u).first()).toBeVisible();

      await page.getByRole('button', { name: /^Back/u }).click();
      await expect(page.getByText('Summer tyres')).toBeVisible();
      await expect(page.getByText('$120.00').first()).toBeVisible();
    });
  });

  test('drops and brings back a wish, and Undo reverses each', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await addWish(family, month, 'Winter tyres');
      await page.goto(`${family.origin}/wishes/${id}/edit`);
      await expect(
        page.getByText(
          'Drop keeps it in the list as not bought; Delete removes it.',
        ),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Drop', exact: true }).click();
      await expect(page).toHaveURL(/\/wishes$/u);
      const done = page.getByText('Done and dropped');
      await expect(done).toBeVisible();
      await expect(page.getByText('Dropped', { exact: true })).toHaveCount(1);

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Undone.')).toBeVisible();
      await expect(done).toHaveCount(0);

      await page.goto(`${family.origin}/wishes/${id}/edit`);
      await page.getByRole('button', { name: 'Drop', exact: true }).click();
      await expect(done).toBeVisible();
      await page.getByRole('link', { name: /Winter tyres/u }).click();
      await page.getByRole('link', { name: 'Edit wish' }).click();
      await page.getByRole('button', { name: 'Bring back' }).click();
      await expect(page).toHaveURL(/\/wishes$/u);
      await expect(page.getByText('Brought back.')).toBeVisible();
      await expect(done).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Undone.')).toBeVisible();
      await expect(done).toBeVisible();
    });
  });

  test('deletes a wish with expenses and Undo links them again', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await addWish(family, month, 'Winter tyres');
      const expense = await spend(family, id, month);
      expect(await countsFor(family, expense)).toBe('wish');

      await page.goto(`${family.origin}/wishes/${id}/edit`);
      await expect(
        page.getByText(
          'It has expenses: deleting it unlinks them, and they count as unplanned.',
        ),
      ).toBeVisible();
      await screenshot(page, testInfo, 'WishFormEdit');
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page).toHaveURL(/\/wishes$/u);
      await expect(page.getByText('Wish deleted.')).toBeVisible();
      await expect(page.getByText('Winter tyres')).toHaveCount(0);
      expect(await countsFor(family, expense)).toBe('none');

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Undone.')).toBeVisible();
      await expect(page.getByText('Winter tyres')).toBeVisible();
      expect(await countsFor(family, expense)).toBe('wish');
    });
  });

  test('says when Undo finds the wish changed', async ({ page }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await addWish(family, month, 'Winter tyres');
      await page.goto(`${family.origin}/wishes/${id}/edit`);
      await page.getByRole('button', { name: 'Drop', exact: true }).click();
      const response = await family.api.patch(
        `${family.origin}/api/wishes/${id}`,
        { headers: { Origin: family.origin }, data: { state: 'open' } },
      );
      expect(response.status()).toBe(200);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(
        page.getByText('Someone changed it meanwhile.'),
      ).toBeVisible();
    });
  });
});
