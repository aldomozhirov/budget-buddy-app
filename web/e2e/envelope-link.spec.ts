import { addMonths, type TransactionRevision } from '@budget-buddy/shared';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * "Link an expense you added" on an envelope's page (spec 3a task 51;
 * UI-ENV-3, UI-WSH-6): the sheet of the wish page, for an envelope.
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

/** The button that opens the sheet. */
function opener(page: Page): Locator {
  return page.getByRole('button', { name: 'Link an expense you added' });
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

async function accountOf(family: Family, name: string): Promise<number> {
  return create(family, '/api/accounts', {
    name,
    type: 'bank',
    currency: 'EUR',
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

/** The envelope of the tests: Household, €500.00 a month, Groceries default. */
async function seedEnvelope(
  family: Family,
  extra: Record<string, unknown> = {},
): Promise<number> {
  return create(family, '/api/envelopes', {
    name: 'Household',
    currency: 'EUR',
    monthlyAmount: '50000',
    startingBalance: '50000',
    mode: 'reset',
    defaultCategoryId: await categoryId(family, 'Groceries'),
    ...extra,
  });
}

/** The family's current month, as the server counts it. */
async function currentMonth(family: Family, id: number): Promise<string> {
  const response = await family.api.get(`${family.origin}/api/envelopes/${id}`);
  return ((await response.json()) as { month: { month: string } }).month.month;
}

/**
 * The month of the design: a grocery expense (fits), two others, and the
 * expenses the sheet must leave out.
 */
async function seedExpenses(
  family: Family,
  month: string,
): Promise<{ rewe: number; amazon: number; dm: number }> {
  const ing = await accountOf(family, 'ING Visa');
  const cash = await accountOf(family, 'Cash €');
  const rewe = await expenseOf(family, {
    accountId: ing,
    amount: '6440',
    merchant: 'Rewe',
    note: 'Weekly shop',
    date: `${month}-01`,
    categoryId: await categoryId(family, 'Groceries'),
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
  // Left out: another month, an income, a transfer, an envelope, a wish.
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
  const holiday = await create(family, '/api/envelopes', {
    name: 'Holiday',
    currency: 'EUR',
    monthlyAmount: '20000',
    mode: 'reset',
  });
  await expenseOf(family, {
    accountId: ing,
    amount: '3333',
    merchant: 'Hotel',
    date: `${month}-01`,
    envelopeId: holiday,
  });
  const wish = await create(family, '/api/wishes', {
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
    `${family.origin}/api/wishes/${wish}/links`,
    { headers: { Origin: family.origin }, data: { transactionId: taken } },
  );
  expect(linked.status(), await linked.text()).toBe(201);
  return { rewe, amazon, dm };
}

async function openSheet(
  page: Page,
  family: Family,
  id: number,
): Promise<void> {
  await page.goto(`${family.origin}/envelopes/${id}`);
  await opener(page).click();
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

test.describe('Linking an expense to an envelope', () => {
  test('lists the month’s free expenses, those that fit first', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      await seedExpenses(family, month);
      await page.goto(`${family.origin}/envelopes/${id}`);

      // The month tab of an active envelope has the button.
      await expect(
        page.getByRole('tab', { name: nameOf(month) }),
      ).toHaveAttribute('aria-selected', 'true');
      await expect(opener(page)).toBeEnabled();
      await opener(page).click();
      const dialog = sheet(page);
      await expect(dialog).toBeVisible();

      await expect(
        dialog.getByText('It will count for Household'),
      ).toBeVisible();
      await expect(
        dialog.getByRole('searchbox', { name: 'Search expenses' }),
      ).toHaveAttribute('placeholder', 'Search merchant, note, amount');
      await expect(
        dialog.getByRole('heading', { name: 'Fits Household' }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('heading', {
          name: `Other expenses in ${nameOf(month)}`,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByText(
          `${nameOf(month)}’s expenses that count for nothing yet. To move one from another envelope or a wish, change it on its own page.`,
        ),
      ).toBeVisible();

      const rewe = row(page, 'Rewe');
      await expect(rewe).toContainText(
        `Weekly shop · 01/${month.slice(5, 7)} · ING Visa · Groceries`,
      );
      await expect(rewe).toContainText('−€64.40');
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
      await expect(fits.getByRole('button')).toContainText('Rewe');
      for (const left of ['Last month shop', 'Hotel', 'Bike shop', 'Income']) {
        await expect(dialog.getByText(left)).toHaveCount(0);
      }
      await screenshot(page, testInfo, 'EnvelopeLink');
    });
  });

  test('typing a merchant, a note or an amount narrows the list, and says when nothing matches', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      await seedExpenses(family, month);
      await openSheet(page, family, id);
      const search = sheet(page).getByRole('searchbox', {
        name: 'Search expenses',
      });

      await search.fill('amaz');
      await expect(row(page, 'Amazon')).toBeVisible();
      await expect(row(page, 'Rewe')).toHaveCount(0);
      await expect(row(page, 'dm')).toHaveCount(0);

      await search.fill('weekly');
      await expect(row(page, 'Rewe')).toBeVisible();
      await expect(row(page, 'Amazon')).toHaveCount(0);

      await search.fill('23.80');
      await expect(row(page, 'dm')).toBeVisible();
      await expect(row(page, 'Rewe')).toHaveCount(0);

      await search.fill('zeppelin');
      await expect(
        sheet(page).getByText(
          `No expense of ${nameOf(month)} matches “zeppelin”.`,
        ),
      ).toBeVisible();

      await search.fill('');
      await expect(row(page, 'Rewe')).toBeVisible();
      await expect(row(page, 'Amazon')).toBeVisible();
      await expect(row(page, 'dm')).toBeVisible();
    });
  });

  test('a tap links the expense, closes the sheet, shows it in the list and moves the hero', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      const { dm } = await seedExpenses(family, month);
      await page.goto(`${family.origin}/envelopes/${id}`);
      const hero = page.getByRole('region', { name: 'This month' });
      await expect(hero).toContainText('€500.00');
      await expect(page.getByRole('link', { name: /^dm/u })).toHaveCount(0);
      await opener(page).click();

      await row(page, 'dm').click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText(
        'Linked to Household',
      );
      await expect(hero).toContainText('€476.20');
      // An envelope made this month still shows its starting balance.
      await expect(hero).toContainText('€23.80 spent of €500.00');
      const linked = page.getByRole('link', { name: /^dm/u });
      await expect(linked).toContainText(/ · Alena · Cash €/u);
      await expect(linked).toContainText('€23.80');
      await expect(linked).toHaveAttribute('href', `/transactions/${dm}`);

      // The record of the expense says who linked it.
      const revisions = await revisionsOf(family, dm);
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ action: 'update', changedBy: 1 });

      // It is no longer free to link.
      await opener(page).click();
      await expect(row(page, 'Rewe')).toBeVisible();
      await expect(row(page, 'dm')).toHaveCount(0);
    });
  });

  test('says so when the expense was put in another envelope meanwhile, and links nothing', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      const { amazon } = await seedExpenses(family, month);
      await openSheet(page, family, id);
      await expect(row(page, 'Amazon')).toBeVisible();

      // Another member charges it to another envelope while the sheet is open.
      const other = await create(family, '/api/envelopes', {
        name: 'Gifts',
        currency: 'EUR',
        monthlyAmount: '10000',
        mode: 'reset',
      });
      const patched = await family.api.patch(
        `${family.origin}/api/transactions/${amazon}`,
        { headers: { Origin: family.origin }, data: { envelopeId: other } },
      );
      expect(patched.status(), await patched.text()).toBe(200);

      await row(page, 'Amazon').click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(
        'Someone changed it meanwhile.',
      );
      await expect(page.getByText('Linked to')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /^Amazon/u })).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'This month' }),
      ).toContainText('€500.00');
    });
  });

  test('says when no expense of the month is free', async ({ page }) => {
    await startFamily(page, async (family) => {
      await accountOf(family, 'ING Visa');
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      await openSheet(page, family, id);
      await expect(
        sheet(page).getByText(
          `No expense of ${nameOf(month)} is free to link.`,
        ),
      ).toBeVisible();
    });
  });

  test('an archived envelope has no button', async ({ page }) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      await seedExpenses(family, month);
      const archived = await family.api.patch(
        `${family.origin}/api/envelopes/${id}`,
        { headers: { Origin: family.origin }, data: { archived: true } },
      );
      expect(archived.status(), await archived.text()).toBe(200);

      await page.goto(`${family.origin}/envelopes/${id}`);
      await expect(
        page.getByRole('heading', { name: 'Household', level: 1 }),
      ).toBeVisible();
      await expect(opener(page)).toHaveCount(0);
      await expect(
        page.getByText('Offline. Linking an expense needs a connection.'),
      ).toHaveCount(0);

      // A live envelope on the same build still has it.
      const live = await create(family, '/api/envelopes', {
        name: 'Gifts',
        currency: 'EUR',
        monthlyAmount: '10000',
        mode: 'reset',
      });
      await page.goto(`${family.origin}/envelopes/${live}`);
      await expect(opener(page)).toBeVisible();
    });
  });

  test('the History tab has no button', async ({ page }) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      await page.goto(`${family.origin}/envelopes/${id}`);
      await expect(opener(page)).toBeVisible();
      await page.getByRole('tab', { name: 'History' }).click();
      await expect(opener(page)).toHaveCount(0);
    });
  });

  test('offline, the button is disabled and says why, and the rows are disabled', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const id = await seedEnvelope(family);
      const month = await currentMonth(family, id);
      const { dm } = await seedExpenses(family, month);
      await page.goto(`${family.origin}/envelopes/${id}`);
      await expect(opener(page)).toBeEnabled();
      await expect(
        page.getByText('Offline. Linking an expense needs a connection.'),
      ).toHaveCount(0);

      // Offline before opening: the button is disabled and the line shows.
      await page.context().setOffline(true);
      await expect(
        page.getByText('Offline. Linking an expense needs a connection.'),
      ).toBeVisible();
      await expect(opener(page)).toBeDisabled();
      await page.context().setOffline(false);
      await expect(opener(page)).toBeEnabled();
      await expect(
        page.getByText('Offline. Linking an expense needs a connection.'),
      ).toHaveCount(0);

      // Offline with the sheet open: the rows are disabled and link nothing.
      await opener(page).click();
      await expect(row(page, 'dm')).toBeEnabled();
      await page.context().setOffline(true);
      await expect(row(page, 'dm')).toBeDisabled();
      await expect(sheet(page)).toBeVisible();
      await page.context().setOffline(false);
      expect(await revisionsOf(family, dm)).toHaveLength(0);
    });
  });
});
