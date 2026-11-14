import {
  addMonths,
  type TransactionRevision,
  type WishesResponse,
} from '@budget-buddy/shared';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * "Link an expense you added" on a wish's page (spec 3a task 44; PLN-10,
 * UI-WSH-6, UI-WSH-7). Expenses are made through the API, and the links
 * through the sheet.
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

function nameOf(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1]!;
}

/** The sheet, once it is open. */
function sheet(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Link an expense' });
}

/** The row button of an expense in the sheet, by its merchant. */
function row(page: Page, merchant: string): Locator {
  return sheet(page).getByRole('button', { name: new RegExp(`^${merchant}`) });
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

async function accountOf(
  family: Family,
  name: string,
  currency = 'EUR',
): Promise<number> {
  return create(family, '/api/accounts', {
    name,
    type: 'bank',
    currency,
    ownerMemberId: 1,
    openingBalance: '100000',
  });
}

async function categoryId(family: Family, name: string): Promise<number> {
  const response = await family.api.get(
    `${family.origin}/api/categories?kind=expense`,
  );
  const { categories } = (await response.json()) as {
    categories: { id: number; name: string }[];
  };
  return categories.find((category) => category.name === name)!.id;
}

async function expenseOf(
  family: Family,
  data: Record<string, unknown>,
): Promise<number> {
  return create(family, '/api/transactions', { kind: 'expense', ...data });
}

/** The wish of the tests: Weekend in Salzburg, with the Travel category. */
async function seedWish(
  family: Family,
  month: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  return create(family, '/api/wishes', {
    month,
    name: 'Weekend in Salzburg',
    amount: '35000',
    currency: 'EUR',
    categoryId: await categoryId(family, 'Travel'),
    ...extra,
  });
}

/**
 * The month of the design: a train ticket in the wish's category (fits), two
 * others, and the expenses the sheet must leave out.
 */
async function seedExpenses(
  family: Family,
  month: string,
): Promise<{ obb: number; amazon: number; dm: number }> {
  const ing = await accountOf(family, 'ING Visa');
  const cash = await accountOf(family, 'Cash €');
  const obb = await expenseOf(family, {
    accountId: ing,
    amount: '6440',
    merchant: 'ÖBB',
    note: 'Train tickets',
    date: `${month}-01`,
    categoryId: await categoryId(family, 'Travel'),
  });
  const amazon = await expenseOf(family, {
    accountId: ing,
    amount: '6260',
    merchant: 'Amazon',
    date: `${month}-01`,
    categoryId: await categoryId(family, 'Shopping'),
  });
  const dm = await expenseOf(family, {
    accountId: cash,
    amount: '2380',
    merchant: 'dm',
    note: 'Soap',
    date: `${month}-01`,
  });
  // Left out: another month, an income, a transfer, an envelope, a link.
  await expenseOf(family, {
    accountId: ing,
    amount: '1111',
    merchant: 'Last month shop',
    date: `${addMonths(month, -1)}-15`,
  });
  await create(family, '/api/transactions', {
    kind: 'income',
    accountId: ing,
    amount: '90000',
    date: `${month}-01`,
  });
  await create(family, '/api/transactions', {
    kind: 'transfer',
    accountId: ing,
    toAccountId: cash,
    amount: '5000',
    date: `${month}-01`,
  });
  const envelope = await create(family, '/api/envelopes', {
    name: 'Groceries',
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
  });
  await expenseOf(family, {
    accountId: ing,
    amount: '3333',
    merchant: 'Rewe',
    date: `${month}-01`,
    envelopeId: envelope,
  });
  const other = await create(family, '/api/wishes', {
    month,
    name: 'Bike',
    amount: '9000',
    currency: 'EUR',
    categoryId: null,
  });
  const taken = await expenseOf(family, {
    accountId: ing,
    amount: '4444',
    merchant: 'Bike shop',
    date: `${month}-01`,
  });
  const linked = await family.api.post(
    `${family.origin}/api/wishes/${other}/links`,
    { headers: { Origin: family.origin }, data: { transactionId: taken } },
  );
  expect(linked.status(), await linked.text()).toBe(201);
  return { obb, amazon, dm };
}

async function openSheet(
  page: Page,
  family: Family,
  wishId: number,
): Promise<void> {
  await page.goto(`${family.origin}/wishes/${wishId}`);
  await page.getByRole('button', { name: 'Link an expense you added' }).click();
  await expect(sheet(page)).toBeVisible();
}

async function revisionsOf(
  family: Family,
  id: number,
): Promise<TransactionRevision[]> {
  const response = await family.api.get(
    `${family.origin}/api/transactions/${id}`,
  );
  return ((await response.json()) as { revisions: TransactionRevision[] })
    .revisions;
}

test.describe('Linking an expense to a wish', () => {
  test('lists the month’s free expenses, those that fit first', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await seedExpenses(family, month);
      await openSheet(page, family, id);
      const dialog = sheet(page);

      await expect(
        dialog.getByText('It will count for Weekend in Salzburg'),
      ).toBeVisible();
      await expect(
        dialog.getByRole('searchbox', { name: 'Search expenses' }),
      ).toHaveAttribute('placeholder', 'Search merchant, note, amount');
      await expect(
        dialog.getByRole('heading', { name: 'Fits Weekend in Salzburg' }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('heading', {
          name: `Other expenses in ${nameOf(month)}`,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByText(
          `${nameOf(month)}’s expenses that count for nothing yet. To count one from an envelope, change it on its own page.`,
        ),
      ).toBeVisible();

      const obb = row(page, 'ÖBB');
      await expect(obb).toContainText(
        `Train tickets · 01/${month.slice(5, 7)} · ING Visa · Travel`,
      );
      await expect(obb).toContainText('−€64.40');
      await expect(row(page, 'Amazon')).toContainText(
        `01/${month.slice(5, 7)} · ING Visa · Shopping`,
      );
      await expect(row(page, 'dm')).toContainText(
        `Soap · 01/${month.slice(5, 7)} · Cash € · no category`,
      );
      await expect(row(page, 'dm')).toContainText('−€23.80');

      // Only the three free expenses, the fitting one in the first group.
      await expect(
        dialog.getByRole('button', { name: /^(?!Close)/u }),
      ).toHaveCount(3);
      const fits = dialog.locator('section', {
        has: page.getByRole('heading', { name: /^Fits / }),
      });
      await expect(fits.getByRole('button')).toHaveCount(1);
      await expect(fits.getByRole('button')).toContainText('ÖBB');
      for (const left of ['Last month shop', 'Rewe', 'Bike shop', 'Income']) {
        await expect(dialog.getByText(left)).toHaveCount(0);
      }
      await screenshot(page, testInfo, 'WishLink');
    });
  });

  test('typing a merchant or a note narrows the list, and says when nothing matches', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await seedExpenses(family, month);
      await openSheet(page, family, id);
      const search = sheet(page).getByRole('searchbox', {
        name: 'Search expenses',
      });

      await search.fill('amaz');
      await expect(row(page, 'Amazon')).toBeVisible();
      await expect(row(page, 'ÖBB')).toHaveCount(0);
      await expect(row(page, 'dm')).toHaveCount(0);

      await search.fill('train');
      await expect(row(page, 'ÖBB')).toBeVisible();
      await expect(row(page, 'Amazon')).toHaveCount(0);
      // Only the fitting group is left.
      await expect(
        sheet(page).getByRole('heading', { name: /^Other expenses/u }),
      ).toHaveCount(0);

      await search.fill('soap');
      await expect(row(page, 'dm')).toBeVisible();
      await expect(row(page, 'ÖBB')).toHaveCount(0);

      await search.fill('zeppelin');
      await expect(
        sheet(page).getByText(
          `No expense of ${nameOf(month)} matches “zeppelin”.`,
        ),
      ).toBeVisible();

      await search.fill('');
      await expect(row(page, 'ÖBB')).toBeVisible();
      await expect(row(page, 'Amazon')).toBeVisible();
      await expect(row(page, 'dm')).toBeVisible();
    });
  });

  test('typing an amount narrows the list', async ({ page }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await seedExpenses(family, month);
      await openSheet(page, family, id);
      const search = sheet(page).getByRole('searchbox', {
        name: 'Search expenses',
      });

      await search.fill('23.80');
      await expect(row(page, 'dm')).toBeVisible();
      await expect(row(page, 'Amazon')).toHaveCount(0);
      await expect(row(page, 'ÖBB')).toHaveCount(0);

      await search.fill('62');
      await expect(row(page, 'Amazon')).toBeVisible();
      await expect(row(page, 'dm')).toHaveCount(0);
    });
  });

  test('a tap links the expense, closes the sheet and logs it in the expense’s history', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      const { dm } = await seedExpenses(family, month);
      await openSheet(page, family, id);

      await row(page, 'dm').click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText(
        'Linked to Weekend in Salzburg',
      );
      await expect(
        page.getByText('€23.80 spent of €350.00 · 1 expense'),
      ).toBeVisible();
      const linked = page.getByRole('link', { name: /^dm/u });
      await expect(linked).toContainText('Soap');
      await expect(linked).toContainText('Cash € · linked by Alena');
      await expect(linked).toContainText('−€23.80');

      // The record of the expense says it was linked, and by whom.
      const revisions = await revisionsOf(family, dm);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ action: 'update', changedBy: 1 });
      expect(revisions[0]!.changes).toMatchObject({
        link: [
          null,
          {
            kind: 'wish',
            wishId: id,
            name: 'Weekend in Salzburg',
            madeHow: 'member',
          },
        ],
      });

      // It is no longer free to link.
      await page
        .getByRole('button', { name: 'Link an expense you added' })
        .click();
      await expect(row(page, 'ÖBB')).toBeVisible();
      await expect(row(page, 'dm')).toHaveCount(0);
    });
  });

  test('says so when the expense was planned meanwhile, and links nothing', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      const { amazon } = await seedExpenses(family, month);
      await openSheet(page, family, id);
      await expect(row(page, 'Amazon')).toBeVisible();

      // Another member charges it to an envelope while the sheet is open.
      const envelopes = (await (
        await family.api.get(`${family.origin}/api/envelopes`)
      ).json()) as { envelopes: { id: number }[] };
      const patched = await family.api.patch(
        `${family.origin}/api/transactions/${amazon}`,
        {
          headers: { Origin: family.origin },
          data: { envelopeId: envelopes.envelopes[0]!.id },
        },
      );
      expect(patched.status(), await patched.text()).toBe(200);

      await row(page, 'Amazon').click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText(
        'Someone changed it meanwhile.',
      );
      await expect(page.getByText('Linked to')).toHaveCount(0);
      await expect(page.getByText('Nothing spent yet · €350.00')).toBeVisible();
    });
  });

  test('says when no expense of the month is free', async ({ page }) => {
    await startFamily(page, async (family) => {
      await accountOf(family, 'ING Visa');
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      await expect(
        sheet(page).getByText(
          `No expense of ${nameOf(month)} is free to link.`,
        ),
      ).toBeVisible();
    });
  });

  test('offline, the button and the rows are disabled', async ({ page }) => {
    await startFamily(page, async (family) => {
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      const { dm } = await seedExpenses(family, month);
      await page.goto(`${family.origin}/wishes/${id}`);
      const open = page.getByRole('button', {
        name: 'Link an expense you added',
      });
      await expect(open).toBeEnabled();

      // Offline before opening: the button is disabled.
      await page.context().setOffline(true);
      await expect(
        page.getByText(
          'Offline. Recording and changing wishes need a connection.',
        ),
      ).toBeVisible();
      await expect(open).toBeDisabled();
      await page.context().setOffline(false);
      await expect(open).toBeEnabled();

      // Offline with the sheet open: the rows are disabled and link nothing.
      await open.click();
      await expect(row(page, 'dm')).toBeEnabled();
      await page.context().setOffline(true);
      await expect(row(page, 'dm')).toBeDisabled();
      await expect(sheet(page)).toBeVisible();
      await page.context().setOffline(false);
      expect(await revisionsOf(family, dm)).toHaveLength(0);
    });
  });
});
