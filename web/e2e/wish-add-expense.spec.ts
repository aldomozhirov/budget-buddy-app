import { addMonths, type WishesResponse } from '@budget-buddy/shared';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * "Add expense" on a wish's page (spec 3a, TASK-50; PLN-18, UI-WSH-5): the
 * shared Add form opened from a wish, prefilled from it, saving an expense
 * that counts for the wish.
 */

/** Saves the iPhone screenshot the reviewer compares with the design. */
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

async function categoryId(family: Family, name: string): Promise<number> {
  const response = await family.api.get(
    `${family.origin}/api/categories?kind=expense`,
  );
  const { categories } = (await response.json()) as {
    categories: { id: number; name: string }[];
  };
  return categories.find((category) => category.name === name)!.id;
}

/** Two accounts: ING Visa in euros (the first) and a dollar card. */
async function seedAccounts(family: Family): Promise<void> {
  const base = { ownerMemberId: 1, type: 'bank', openingBalance: '100000' };
  await create(family, '/api/accounts', {
    ...base,
    name: 'ING Visa',
    currency: 'EUR',
  });
  await create(family, '/api/accounts', {
    ...base,
    name: 'Dollar card',
    currency: 'USD',
  });
}

/** The wish of the design: Winter tyres, €480.00, in Transport. */
async function seedWish(
  family: Family,
  month: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  return create(family, '/api/wishes', {
    month,
    name: 'Winter tyres',
    amount: '48000',
    currency: 'EUR',
    categoryId: await categoryId(family, 'Transport'),
    ...extra,
  });
}

type WishRead = {
  state: string;
  spent: string;
  expenseCount: number;
  expenses: { transactionId: number }[];
};

async function wishOf(family: Family, id: number): Promise<WishRead> {
  const response = await family.api.get(`${family.origin}/api/wishes/${id}`);
  return ((await response.json()) as { wish: WishRead }).wish;
}

async function transactionOf(family: Family, id: number) {
  const response = await family.api.get(
    `${family.origin}/api/transactions/${id}`,
  );
  return (
    (await response.json()) as {
      transaction: {
        amount: string;
        note: string | null;
        date: string;
        categoryId: number | null;
        envelopeId: number | null;
        countsFor: { type: string; madeHow?: string; linkAmount?: string };
      };
    }
  ).transaction;
}

/** The wish page's "Add expense" bar, then the form it opens. */
async function openFromWish(
  page: Page,
  family: Family,
  wishId: number,
  euros = true,
): Promise<void> {
  await page.goto(`${family.origin}/wishes/${wishId}`);
  await page.getByRole('link', { name: 'Add expense' }).click();
  await expect(page).toHaveURL(new RegExp(`/add\\?wishId=${wishId}$`, 'u'));
  await expect(
    page.getByRole('group', { name: 'Amount', exact: true }),
  ).toBeVisible();
  // Which account is picked in advance is Add's own rule; tests that need
  // euros pick ING Visa.
  if (euros) {
    await page
      .getByRole('radiogroup', { name: 'Paid from' })
      .getByRole('radio', { name: /ING Visa/u })
      .click();
  }
}

test.describe('Adding an expense from a wish', () => {
  test('opens the Add form prefilled from the wish, with the account picked in advance', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id, false);

      const amount = page.getByRole('group', { name: 'Amount', exact: true });
      await expect(
        page
          .getByRole('radiogroup', { name: 'Paid from' })
          .getByRole('radio', { checked: true }),
      ).toHaveCount(1);
      await page
        .getByRole('radiogroup', { name: 'Paid from' })
        .getByRole('radio', { name: /ING Visa/u })
        .click();
      await expect(amount).toContainText('€480.00');
      await expect(page.getByText('Counts for', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('group', { name: 'Counts for' }),
      ).toContainText('Winter tyres');
      // No Envelope row: the wish takes its place.
      await expect(page.getByText(/^Envelope/u)).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Note: Winter tyres. Change' }),
      ).toBeVisible();
      const category = page.getByRole('radiogroup', { name: 'Category' });
      await expect(
        category.getByRole('radio', { name: 'Transport', checked: true }),
      ).toBeVisible();
      // It can be changed.
      const paid = page.getByRole('radiogroup', { name: 'Paid from' });
      await expect(paid.getByRole('radio', { checked: true })).toContainText(
        'ING Visa',
      );
      await screenshot(page, testInfo, 'AddExpenseWish');
      await paid.getByRole('radio', { name: /Dollar card/u }).click();
      await expect(
        paid.getByRole('radio', { name: /Dollar card/u, checked: true }),
      ).toBeVisible();
    });
  });

  test('saves the expense with no envelope and a recorded link, and Done returns to the wish page, still open', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const envelope = await create(family, '/api/envelopes', {
        name: 'Groceries',
        currency: 'EUR',
        monthlyAmount: '40000',
        mode: 'carry_over',
      });
      const transport = await categoryId(family, 'Transport');
      const set = await family.api.patch(
        `${family.origin}/api/categories/${transport}`,
        {
          headers: { Origin: family.origin },
          data: { defaultEnvelopeId: envelope },
        },
      );
      expect(set.status(), await set.text()).toBe(200);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);

      await page.getByRole('button', { name: 'Save €480.00' }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved' }),
      ).toBeVisible();
      await expect(page.getByText('Counts for Winter tyres')).toBeVisible();

      const wish = await wishOf(family, id);
      expect(wish).toMatchObject({
        state: 'open',
        spent: '48000',
        expenseCount: 1,
      });
      const transaction = await transactionOf(
        family,
        wish.expenses[0]!.transactionId,
      );
      expect(transaction).toMatchObject({
        amount: '48000',
        note: 'Winter tyres',
        categoryId: transport,
        envelopeId: null,
        countsFor: { type: 'wish', madeHow: 'recorded' },
      });

      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page).toHaveURL(new RegExp(`/wishes/${id}$`, 'u'));
      const row = page.getByRole('link', { name: /recorded from the wish/u });
      await expect(row).toContainText('ING Visa');
      await expect(row).toContainText('−€480.00');
      await expect(
        page.getByRole('link', { name: 'Add expense' }),
      ).toBeVisible();
    });
  });

  test('Undo deletes the expense', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);
      await page.getByRole('button', { name: 'Save €480.00' }).click();
      await expect(page.getByText('Counts for Winter tyres')).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(
        page.getByRole('group', { name: 'Amount', exact: true }),
      ).toBeVisible();
      expect(await wishOf(family, id)).toMatchObject({
        state: 'open',
        spent: '0',
        expenseCount: 0,
      });
    });
  });

  test('Add another keeps the wish and reads what is left', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);
      const amount = page.getByRole('group', { name: 'Amount', exact: true });
      await page.getByRole('button', { name: 'Save €480.00' }).click();
      await page.getByRole('button', { name: 'Add another' }).click();
      await expect(
        page.getByRole('group', { name: 'Counts for' }),
      ).toContainText('Winter tyres');
      // Nothing is left of it: no prefill.
      await expect(amount).toContainText('€0');
      await expect(
        page.getByRole('button', { name: 'Enter an amount' }),
      ).toBeDisabled();
    });
  });

  test('with an account in another currency, converts the prefill at the day’s rate and counts the wish’s own amount', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);
      await page
        .getByRole('radiogroup', { name: 'Paid from' })
        .getByRole('radio', { name: /Dollar card/u })
        .click();
      await expect(page.getByText(/^€1 = \$[\d.]+ today$/u)).toBeVisible();
      await expect(
        page.getByRole('group', { name: 'Amount', exact: true }),
      ).toContainText('$');
      await page.getByRole('button', { name: /^Save \$[\d,.]+$/u }).click();
      await expect(page.getByText('Counts for Winter tyres')).toBeVisible();
      // The untouched prefill counts as the wish's own €480.00.
      expect(await wishOf(family, id)).toMatchObject({
        spent: '48000',
        expenseCount: 1,
      });
    });
  });

  test('an earlier month’s wish starts on that month’s last day', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = addMonths(await currentMonth(family), -1);
      const id = await seedWish(family, month);
      await openFromWish(page, family, id);
      await page.getByRole('button', { name: 'Save €480.00' }).click();
      await expect(page.getByText('Counts for Winter tyres')).toBeVisible();
      const wish = await wishOf(family, id);
      const transaction = await transactionOf(
        family,
        wish.expenses[0]!.transactionId,
      );
      expect(transaction.date.slice(0, 7)).toBe(month);
      expect(transaction.date).toBe(
        new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
          .toISOString()
          .slice(0, 10),
      );
    });
  });

  test('a date outside the wish’s month disables Save and says why', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openFromWish(page, family, id);
      await page.getByRole('button', { name: /^Date:/u }).click();
      const sheet = page.getByRole('dialog', { name: 'Date' });
      await sheet.getByRole('button', { name: 'Previous month' }).click();
      await sheet
        .getByRole('button', { name: /^1 [A-Z][a-z]+ \d{4}$/u })
        .click();
      const names = [
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
      await expect(
        page.getByText(
          `Pick a date in ${names[Number(month.slice(5)) - 1]} to count for Winter tyres.`,
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Save €480.00' }),
      ).toBeDisabled();
    });
  });

  test('an income or a transfer hides the Counts for row and saves no link', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);
      const counts = page.getByRole('group', { name: 'Counts for' });
      await expect(counts).toBeVisible();

      await page.getByRole('radio', { name: 'Income', exact: true }).click();
      await expect(counts).toHaveCount(0);
      await expect(page.getByText('Counts for', { exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('radio', { name: 'Transfer', exact: true }).click();
      await expect(counts).toHaveCount(0);

      // Back to an expense: the wish is still there.
      await page.getByRole('radio', { name: 'Expense', exact: true }).click();
      await expect(counts).toContainText('Winter tyres');

      await page.getByRole('radio', { name: 'Income', exact: true }).click();
      await page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Salary' })
        .click();
      await page.getByRole('button', { name: /^Save €/u }).click();
      await expect(
        page.getByRole('heading', { name: 'Income saved' }),
      ).toBeVisible();
      await expect(page.getByText('Counts for Winter tyres')).toHaveCount(0);
      expect(await wishOf(family, id)).toMatchObject({
        state: 'open',
        spent: '0',
        expenseCount: 0,
      });
    });
  });

  test('a wish that cannot be loaded opens a plain expense', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      await page.goto(`${family.origin}/add?wishId=99999`);
      await expect(
        page.getByRole('group', { name: 'Amount', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('group', { name: 'Counts for' })).toHaveCount(
        0,
      );
      await expect(page.getByText('Counts for', { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('button', { name: 'Enter an amount' }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Add note' }),
      ).toBeVisible();
      await page
        .getByRole('group', { name: 'Amount keypad' })
        .getByRole('button', { name: '5', exact: true })
        .click();
      await page.getByRole('button', { name: /^Save [€$]5/u }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved' }),
      ).toBeVisible();
      await expect(page.getByText(/^Counts for/u)).toHaveCount(0);
    });
  });

  test('a wish dropped after the form opened is refused by the server and nothing is saved', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);
      const dropped = await family.api.patch(
        `${family.origin}/api/wishes/${id}`,
        { headers: { Origin: family.origin }, data: { state: 'dropped' } },
      );
      expect(dropped.status(), await dropped.text()).toBe(200);
      await page.getByRole('button', { name: 'Save €480.00' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Expense saved' }),
      ).toHaveCount(0);
      const response = await family.api.get(
        `${family.origin}/api/transactions?period=all`,
      );
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { transactions: unknown[] };
      expect(body.transactions).toHaveLength(0);
    });
  });

  test('offline, Save is disabled and says it needs a connection', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openFromWish(page, family, id);
      await page.context().setOffline(true);
      await expect(
        page.getByText('Offline. Adding to a wish needs a connection.'),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Save €480.00 · needs a connection' }),
      ).toBeDisabled();
      await page.context().setOffline(false);
      await expect(
        page.getByRole('button', { name: 'Save €480.00' }),
      ).toBeEnabled();
    });
  });
});
