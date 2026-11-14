import type { WishesResponse } from '@budget-buddy/shared';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * "Record as expense" on a wish's page (spec 3a task 42; PLN-18, UI-WSH-5,
 * Design 3 to 5). Wishes and accounts are made through the API; the
 * expense is recorded through the sheet.
 */

/** The sheet, once it is open. */
function sheet(page: Page) {
  return page.getByRole('dialog', { name: 'Record as expense' });
}

/** Saves a screenshot: the iPhone one is the reviewer's, the iPad one too. */
async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.waitForTimeout(500);
  const file = testInfo.project.name === 'iphone' ? name : `${name}-ipad`;
  await page.screenshot({ path: `test-results/screens/${file}.png` });
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

/** Two accounts of the member: ING Visa in euros and a dollar card. */
async function seedAccounts(
  family: Family,
): Promise<{ eur: number; usd: number }> {
  const base = { ownerMemberId: 1, type: 'bank', openingBalance: '100000' };
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

/** `month` (YYYY-MM) moved by `by` months. */
function shiftMonth(month: string, by: number): string {
  const index =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The last day of `month` (YYYY-MM) as YYYY-MM-DD. */
function lastDay(month: string): string {
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  ).getUTCDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

/** The date of the one expense recorded from a wish. */
async function recordedDate(family: Family, wishId: number): Promise<string> {
  const wishResponse = await family.api.get(
    `${family.origin}/api/wishes/${wishId}`,
  );
  const { wish } = (await wishResponse.json()) as {
    wish: { expenses: { transactionId: number }[] };
  };
  expect(wish.expenses).toHaveLength(1);
  const response = await family.api.get(
    `${family.origin}/api/transactions/${wish.expenses[0]!.transactionId}`,
  );
  const { transaction } = (await response.json()) as {
    transaction: { date: string; categoryId: number | null };
  };
  return transaction.date;
}

async function openSheet(
  page: Page,
  family: Family,
  wishId: number,
): Promise<void> {
  await page.goto(`${family.origin}/wishes/${wishId}`);
  await page.getByRole('button', { name: 'Record as expense' }).click();
  await expect(sheet(page)).toBeVisible();
}

async function pickAccount(page: Page, name: string): Promise<void> {
  await sheet(page)
    .getByRole('radio', { name: new RegExp(name, 'u') })
    .click();
}

/** The wish as the server has it. */
async function wishOf(
  family: Family,
  id: number,
): Promise<{ state: string; spent: string; expenseCount: number }> {
  const response = await family.api.get(`${family.origin}/api/wishes/${id}`);
  return ((await response.json()) as { wish: never }).wish;
}

test.describe('Recording a wish as an expense', () => {
  test('opens as the design draws it, with no account picked and the button disabled', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      const dialog = sheet(page);

      await expect(
        dialog.getByText('Winter tyres · no envelope'),
      ).toBeVisible();
      const amount = dialog.getByRole('button', { name: /^Amount / });
      await expect(amount).toContainText('€480.00');
      await expect(amount).toContainText('The wish’s amount');
      await expect(
        dialog.getByText('Paid from · pick the account that paid'),
      ).toBeVisible();
      const chips = dialog.getByRole('radiogroup', { name: 'Paid from' });
      await expect(
        chips.getByRole('radio', { name: /ING Visa/u }),
      ).toBeVisible();
      await expect(
        chips.getByRole('radio', { name: /Dollar card/u }),
      ).toBeVisible();
      await expect(chips.getByRole('radio', { checked: true })).toHaveCount(0);
      await expect(
        dialog.getByRole('button', { name: 'All accounts' }),
      ).toBeVisible();

      await expect(
        dialog.getByRole('button', { name: /^Merchant/ }),
      ).toContainText('Optional');
      await expect(dialog.getByRole('button', { name: /^Date/ })).toContainText(
        'Today',
      );
      await expect(
        dialog.getByRole('button', { name: /^Category/ }),
      ).toContainText('Transport');
      const keep = dialog.getByRole('switch', { name: /Keep the wish open/ });
      await expect(keep).toHaveAttribute('aria-checked', 'false');
      await expect(
        dialog.getByText(
          'For more spending on it later. Off: it’s ticked off as done.',
        ),
      ).toBeVisible();

      const save = dialog.getByRole('button', {
        name: 'Pick the account that paid',
      });
      await expect(save).toBeVisible();
      await expect(save).toBeDisabled();
      await screenshot(page, testInfo, 'WishRecord');

      // Picking an account turns the button into "Save €480.00".
      await pickAccount(page, 'ING Visa');
      await expect(
        dialog.getByRole('button', { name: 'Save €480.00' }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole('button', { name: 'Pick the account that paid' }),
      ).toHaveCount(0);
    });
  });

  test('records the wish’s amount: wish done, expense listed as recorded from the wish, Undo takes it back', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      await pickAccount(page, 'ING Visa');
      await sheet(page).getByRole('button', { name: 'Save €480.00' }).click();

      await expect(sheet(page)).toHaveCount(0);
      await expect(
        page.getByText('Expense saved · Winter tyres done', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Done', { exact: true })).toBeVisible();
      // No longer open: nothing left to record.
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toHaveCount(0);
      const row = page.getByRole('link', { name: /recorded from the wish/u });
      await expect(row).toContainText('Winter tyres');
      await expect(row).toContainText('ING Visa');
      await expect(row).toContainText('−€480.00');
      expect(await wishOf(family, id)).toMatchObject({
        state: 'done',
        spent: '48000',
        expenseCount: 1,
      });

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Undone.', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: /recorded from the wish/u }),
      ).toHaveCount(0);
      await expect(page.getByText('Nothing spent yet')).toBeVisible();
      expect(await wishOf(family, id)).toMatchObject({
        state: 'open',
        spent: '0',
        expenseCount: 0,
      });
    });
  });

  test('makes the expense with the wish’s category and name, today’s date and no envelope, whatever the category’s default envelope', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const groceries = await create(family, '/api/envelopes', {
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
          data: { defaultEnvelopeId: groceries },
        },
      );
      expect(set.status(), await set.text()).toBe(200);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      await pickAccount(page, 'ING Visa');
      await sheet(page).getByRole('button', { name: 'Save €480.00' }).click();
      await expect(
        page.getByText('Expense saved · Winter tyres done', { exact: true }),
      ).toBeVisible();

      await page.getByRole('link', { name: /recorded from the wish/u }).click();
      await expect(
        page.getByText('Recorded from the wish Winter tyres by Alena', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText('Winter tyres').first()).toBeVisible();
      await expect(page.getByText('Transport').first()).toBeVisible();
      await expect(page.getByText('Groceries')).toHaveCount(0);

      const wishResponse = await family.api.get(
        `${family.origin}/api/wishes/${id}`,
      );
      const { wish } = (await wishResponse.json()) as {
        wish: { expenses: { transactionId: number }[] };
      };
      expect(wish.expenses).toHaveLength(1);
      const response = await family.api.get(
        `${family.origin}/api/transactions/${wish.expenses[0]!.transactionId}`,
      );
      expect(response.ok(), await response.text()).toBe(true);
      const { transaction } = (await response.json()) as {
        transaction: {
          amount: string;
          note: string | null;
          categoryId: number | null;
          envelopeId: number | null;
          date: string;
        };
      };
      expect(transaction).toMatchObject({
        amount: '48000',
        note: 'Winter tyres',
        categoryId: transport,
        envelopeId: null,
      });
      // Today, which is in the wish's month.
      expect(transaction.date.slice(0, 7)).toBe(month);
    });
  });

  test('with “Keep the wish open” on, the wish stays open, and Undo still takes the expense back', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      await pickAccount(page, 'ING Visa');
      const keep = sheet(page).getByRole('switch', {
        name: /Keep the wish open/,
      });
      await keep.click();
      await expect(keep).toHaveAttribute('aria-checked', 'true');
      await sheet(page).getByRole('button', { name: 'Save €480.00' }).click();

      await expect(
        page.getByText('Expense saved · the wish stays open', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Done', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: /recorded from the wish/u }),
      ).toBeVisible();
      expect(await wishOf(family, id)).toMatchObject({
        state: 'open',
        spent: '48000',
      });

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Undone.', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('link', { name: /recorded from the wish/u }),
      ).toHaveCount(0);
      expect(await wishOf(family, id)).toMatchObject({
        state: 'open',
        spent: '0',
        expenseCount: 0,
      });
    });
  });

  test('a partly spent wish offers what is left, and records it', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const { eur } = await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      // The first part, €120.00, is recorded and the wish kept open.
      const first = await family.api.post(
        `${family.origin}/api/wishes/${id}/record`,
        {
          headers: { Origin: family.origin },
          data: {
            accountId: eur,
            amount: '12000',
            keepOpen: true,
            clientId: crypto.randomUUID(),
          },
        },
      );
      expect(first.status(), await first.text()).toBe(201);

      await openSheet(page, family, id);
      const amount = sheet(page).getByRole('button', { name: /^Amount / });
      await expect(amount).toContainText('€360.00');
      await expect(amount).toContainText('What’s left of the wish');
      await pickAccount(page, 'ING Visa');
      await sheet(page).getByRole('button', { name: 'Save €360.00' }).click();
      await expect(
        page.getByText('Expense saved · Winter tyres done', { exact: true }),
      ).toBeVisible();
      expect(await wishOf(family, id)).toMatchObject({
        state: 'done',
        spent: '48000',
        expenseCount: 2,
      });
    });
  });

  test('with an account in another currency, shows the converted amount and the day’s rate', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      await pickAccount(page, 'Dollar card');
      const dialog = sheet(page);
      // The fixture feed prices dollars; the line reads "€1 = $<rate> today".
      await expect(dialog.getByText(/^€1 = \$[\d.]+ today$/u)).toBeVisible();
      const amount = dialog.getByRole('button', { name: /^Amount / });
      await expect(amount).toContainText('$');
      await expect(amount).toContainText('The wish’s amount');
      await expect(
        dialog.getByRole('button', { name: /^Save \$[\d,.]+$/u }),
      ).toBeEnabled();
    });
  });

  test('a wish of an earlier month is dated on that month’s last day', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = shiftMonth(await currentMonth(family), -2);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      const dialog = sheet(page);

      await expect(
        dialog.getByRole('button', { name: /^Date/ }),
      ).not.toContainText('Today');
      await pickAccount(page, 'ING Visa');
      await dialog.getByRole('button', { name: 'Save €480.00' }).click();
      await expect(
        page.getByText('Expense saved · Winter tyres done', { exact: true }),
      ).toBeVisible();
      expect(await recordedDate(family, id)).toBe(lastDay(month));
    });
  });

  test('shows the server’s own message when it refuses the date, not a generic one', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = shiftMonth(await currentMonth(family), -1);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      const dialog = sheet(page);
      await pickAccount(page, 'ING Visa');

      // Today is not in the wish's month: the server answers 400.
      await dialog.getByRole('button', { name: /^Date/ }).click();
      await page
        .getByRole('dialog', { name: 'Date' })
        .getByRole('button', { name: 'Today', exact: true })
        .click();
      await dialog.getByRole('button', { name: 'Save €480.00' }).click();

      await expect(
        dialog.getByRole('alert').filter({
          hasText: 'Choose a date in the wish’s month.',
        }),
      ).toBeVisible();
      await expect(dialog.getByText('Check the expense.')).toHaveCount(0);
      // Still open, nothing recorded, and the member can fix the date.
      await expect(
        dialog.getByRole('button', { name: 'Save €480.00' }),
      ).toBeEnabled();
      expect(await wishOf(family, id)).toMatchObject({
        state: 'open',
        expenseCount: 0,
      });
    });
  });

  test('a wish of a coming month cannot be recorded yet', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = shiftMonth(await currentMonth(family), 1);
      const id = await seedWish(family, month);
      await openSheet(page, family, id);
      const dialog = sheet(page);

      await expect(
        dialog.getByText(
          'This wish is for a coming month. Record it once the month starts.',
        ),
      ).toBeVisible();
      // Even with an account picked, the button stays disabled.
      await pickAccount(page, 'ING Visa');
      await expect(
        dialog.getByRole('button', { name: 'Save €480.00' }),
      ).toBeDisabled();
      expect(await wishOf(family, id)).toMatchObject({ expenseCount: 0 });
    });
  });

  test('a wish of this month shows no coming-month notice', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const id = await seedWish(family, await currentMonth(family));
      await openSheet(page, family, id);
      await expect(
        sheet(page).getByText('This wish is for a coming month.', {
          exact: false,
        }),
      ).toHaveCount(0);
    });
  });

  test('an archived category of the wish is still named and kept on the expense', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);
      const transport = await categoryId(family, 'Transport');
      const archived = await family.api.patch(
        `${family.origin}/api/categories/${transport}`,
        { headers: { Origin: family.origin }, data: { archived: true } },
      );
      expect(archived.status(), await archived.text()).toBe(200);

      await openSheet(page, family, id);
      const dialog = sheet(page);
      await expect(
        dialog.getByRole('button', { name: /^Category/ }),
      ).toContainText('Transport');
      await expect(
        dialog.getByRole('button', { name: /^Category/ }),
      ).not.toContainText('None');
      await pickAccount(page, 'ING Visa');
      await dialog.getByRole('button', { name: 'Save €480.00' }).click();
      await expect(
        page.getByText('Expense saved · Winter tyres done', { exact: true }),
      ).toBeVisible();

      const wishResponse = await family.api.get(
        `${family.origin}/api/wishes/${id}`,
      );
      const { wish } = (await wishResponse.json()) as {
        wish: { expenses: { transactionId: number }[] };
      };
      const response = await family.api.get(
        `${family.origin}/api/transactions/${wish.expenses[0]!.transactionId}`,
      );
      const { transaction } = (await response.json()) as {
        transaction: { categoryId: number | null };
      };
      expect(transaction.categoryId).toBe(transport);
    });
  });

  test('with the connection lost, recording is disabled', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seedAccounts(family);
      const month = await currentMonth(family);
      const id = await seedWish(family, month);

      // On the wish's page, the button that opens the sheet.
      await page.goto(`${family.origin}/wishes/${id}`);
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toBeEnabled();
      await page.context().setOffline(true);
      await expect(
        page.getByRole('button', {
          name: 'Record as expense · needs a connection',
        }),
      ).toBeDisabled();
      await page.context().setOffline(false);
      await expect(
        page.getByRole('button', { name: 'Record as expense' }),
      ).toBeEnabled();

      // With the sheet open and an account picked, losing the connection
      // disables saving.
      await page.getByRole('button', { name: 'Record as expense' }).click();
      await pickAccount(page, 'ING Visa');
      await expect(
        sheet(page).getByRole('button', { name: 'Save €480.00' }),
      ).toBeEnabled();
      await page.context().setOffline(true);
      await expect(
        sheet(page).getByRole('button', {
          name: 'Recording needs a connection',
        }),
      ).toBeDisabled();
      await page.context().setOffline(false);
      await expect(
        sheet(page).getByRole('button', { name: 'Save €480.00' }),
      ).toBeEnabled();
      expect(await wishOf(family, id)).toMatchObject({ expenseCount: 0 });
    });
  });
});
