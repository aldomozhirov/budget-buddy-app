import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';
import { expectNoSidewaysScroll } from './support/sideways-scroll.js';

const LONG_MERCHANT =
  'A very long merchant name that goes on and on and on and on and on';

/** Saves a plain screenshot of the iPhone run for the design comparison. */
async function shoot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'iphone') return;
  await page.waitForTimeout(700);
  await page.getByRole('group', { name: 'Filters' }).evaluate((row) => {
    row.scrollLeft = 0;
  });
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

interface Seeded {
  today: string;
  monthName: string;
  ids: Record<string, number>;
}

/**
 * Alena and Max, four accounts, the starter categories and a Groceries
 * envelope; six transactions today: REWE, Lidl (Max), Shell (Max, no
 * category), Amazon (a refund), Salary (income) and a transfer.
 */
async function seed(family: Family): Promise<Seeded> {
  const settings = (await (
    await family.api.get(`${family.origin}/api/settings`)
  ).json()) as { timeZone: string };
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timeZone,
  }).format(new Date());
  const monthName = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone,
    month: 'long',
  }).format(new Date());
  const ids: Record<string, number> = {
    Alena: 1,
    Max: await create(family, '/api/members', { name: 'Max' }),
  };
  for (const [name, owner, type] of [
    ['ING Visa', 1, 'bank'],
    ['DKB', 2, 'bank'],
    ['Cash €', 1, 'cash'],
    ['Revolut', 1, 'bank'],
  ] as const) {
    ids[name] = await create(family, '/api/accounts', {
      name,
      ownerMemberId: owner,
      type,
      currency: 'EUR',
      openingBalance: '100000',
    });
  }
  ids.Groceries = await create(family, '/api/envelopes', {
    name: 'Groceries',
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
  });
  const categories = (await (
    await family.api.get(`${family.origin}/api/categories`)
  ).json()) as { categories: { id: number; name: string }[] };
  for (const category of categories.categories) {
    ids[`category ${category.name}`] = category.id;
  }
  const groceries = ids['category Groceries']!;
  const add = (data: Record<string, unknown>) =>
    create(family, '/api/transactions', { date: today, ...data });
  await add({
    kind: 'expense',
    accountId: ids['ING Visa'],
    amount: '6420',
    merchant: 'REWE',
    categoryId: groceries,
    envelopeId: ids.Groceries,
  });
  await add({
    kind: 'expense',
    accountId: ids.DKB,
    memberId: ids.Max,
    amount: '2380',
    merchant: 'Lidl',
    categoryId: groceries,
    envelopeId: ids.Groceries,
  });
  await add({
    kind: 'expense',
    accountId: ids.DKB,
    memberId: ids.Max,
    amount: '6840',
    merchant: 'Shell',
  });
  await add({
    kind: 'expense',
    accountId: ids.Revolut,
    amount: '-1999',
    merchant: 'Amazon',
    categoryId: ids['category Shopping'],
  });
  await add({
    kind: 'income',
    accountId: ids.DKB,
    memberId: ids.Max,
    amount: '420000',
    categoryId: ids['category Salary'],
  });
  await add({
    kind: 'transfer',
    accountId: ids['ING Visa'],
    toAccountId: ids['Cash €'],
    amount: '20000',
  });
  return { today, monthName, ids };
}

/** Waits until the list has loaded its first page. */
async function loaded(page: Page): Promise<void> {
  await expect(page.getByTestId('transaction-row').first()).toBeVisible();
}

test('the list opens on this month, with the summary matching its rows', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { monthName } = await seed(family);
    await page.goto(`${family.origin}/transactions`);
    await loaded(page);

    const month = page.getByRole('button', { name: `Period: ${monthName}` });
    await expect(month).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Member: Everyone' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('transaction-row')).toHaveCount(6);
    await expect(page.getByText('6 transactions')).toBeVisible();
    await expect(
      page.getByText('€136.41 spent · +€4,200.00 in').first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

    const refund = page
      .getByTestId('transaction-row')
      .filter({ hasText: 'Amazon' });
    await expect(refund).toContainText('+€19.99');
    await expect(refund).toContainText('Refund');
    const shell = page
      .getByTestId('transaction-row')
      .filter({ hasText: 'Shell' });
    await expect(shell).toContainText('−€68.40');
    await expect(
      shell.getByText('No category', { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('transaction-row')
        .filter({ hasText: 'ING Visa → Cash €' }),
    ).toContainText('€200.00');

    await expect(
      page.getByRole('tab', { name: 'Needs a category · 1' }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page, 'Transactions');
    await shoot(page, testInfo, 'Transactions');
  });
});

test('picking Max and Groceries shows only those, with counts in the sheet', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/transactions`);
    await loaded(page);

    await page.getByRole('button', { name: /^Member:/ }).click();
    const members = page.getByRole('dialog', { name: /^Member/ });
    await expect(
      members.getByText('Pick any. None picked shows all.'),
    ).toBeVisible();
    await members.getByRole('checkbox', { name: /^Max/ }).click();
    await expect(
      members.getByRole('button', { name: 'Show 3 transactions' }),
    ).toBeVisible();
    await members.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Member: Max' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /^Category:/ }).click();
    const categories = page.getByRole('dialog', { name: /^Category/ });
    await expect(
      categories.getByRole('checkbox', { name: /^Groceries/ }),
    ).toContainText('1');
    await expect(
      categories.getByRole('checkbox', { name: /^Eating out/ }),
    ).toContainText('0');
    await expect(
      categories.getByRole('checkbox', { name: /^No category/ }),
    ).toContainText('Waiting to be labelled');
    await expect(categories.getByText('Expense categories')).toBeVisible();
    await expectNoSidewaysScroll(page, 'Category filter');
    await shoot(page, testInfo, 'TransactionsFilter');
    await categories.getByRole('checkbox', { name: /^Groceries/ }).click();
    await expect(
      categories.getByRole('button', { name: 'Show 1 transaction' }),
    ).toBeVisible();
    await categories
      .getByRole('button', { name: 'Show 1 transaction' })
      .click();

    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    await expect(page.getByTestId('transaction-row')).toContainText('Lidl');
    await expect(
      page.getByText('1 transaction', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('€23.80 spent').first()).toBeVisible();
    await shoot(page, testInfo, 'TransactionsFiltered');

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page.getByTestId('transaction-row')).toHaveCount(6);
    await expect(
      page.getByRole('button', { name: 'Clear all filters' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: /^Kind:/ }).click();
    const kinds = page.getByRole('dialog', { name: /^Kind/ });
    await kinds.getByRole('checkbox', { name: /^Refund/ }).click();
    await kinds.getByRole('button', { name: 'Reset' }).click();
    await expect(
      kinds.getByRole('button', { name: 'Show 6 transactions' }),
    ).toBeVisible();
  });
});

test('searching "64.2" finds the €64.20 expense', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/transactions`);
    await loaded(page);

    await page.getByLabel('Search transactions').fill('64.2');
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    await expect(page.getByTestId('transaction-row')).toContainText('REWE');
    await expect(page.getByTestId('transaction-row')).toContainText('−€64.20');
    await expect(
      page.getByText('1 transaction', { exact: true }),
    ).toBeVisible();
    await shoot(page, testInfo, 'TransactionsSearch');

    await page.getByLabel('Search transactions').fill('nothing like this');
    await expect(page.getByText('No transactions match.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByTestId('transaction-row')).toHaveCount(6);
  });
});

test('"Transactions" on an account opens the list for that account, all time', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/accounts/${ids['ING Visa']}`);
    await page.getByRole('link', { name: 'Transactions' }).click();

    await expect(page).toHaveURL(/\/transactions\?account=\d+&period=all/u);
    await loaded(page);
    await expect(
      page.getByRole('button', { name: 'Period: All time' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Account: ING Visa' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('transaction-row')).toHaveCount(2);
    await expect(page.getByText('2 transactions')).toBeVisible();
    await page
      .getByRole('button', { name: 'Back to account', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/accounts/${ids['ING Visa']}$`, 'u'),
    );
  });
});

test('scrolling loads the next page of fifty', async ({ page }) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    for (let day = 0; day < 55; day++) {
      await create(family, '/api/transactions', {
        kind: 'expense',
        accountId: ids['ING Visa'],
        amount: '100',
        merchant: `Old shop ${day}`,
        date: new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10),
      });
    }
    await page.goto(`${family.origin}/transactions?period=all`);
    await loaded(page);
    await expect(page.getByText('61 transactions')).toBeVisible();
    await expect(page.getByTestId('transaction-row')).toHaveCount(50);

    const list = page.getByTestId('transactions-list');
    await expect(async () => {
      await list.evaluate((element) =>
        element.scrollTo(0, element.scrollHeight),
      );
      await expect(page.getByTestId('transaction-row')).toHaveCount(61, {
        timeout: 1500,
      });
    }).toPass({ timeout: 15_000 });
  });
});

test('the Needs a category tab opens from its link and keeps its count', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/transactions?tab=needs-category`);
    const tab = page.getByRole('tab', { name: 'Needs a category · 1' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: /^Period:/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByTestId('transaction-row')).toHaveCount(6);
  });
});

test('long names and the filter sheets do not scroll sideways', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await create(family, '/api/transactions', {
      kind: 'expense',
      accountId: ids['ING Visa'],
      amount: '123456789',
      merchant: LONG_MERCHANT,
    });
    await page.goto(`${family.origin}/transactions`);
    await loaded(page);
    await expectNoSidewaysScroll(page, 'Transactions, long merchant');
    for (const name of ['Period', 'Account', 'Envelope', 'Kind']) {
      await page
        .getByRole('button', { name: new RegExp(`^${name}:`, 'u') })
        .click();
      await page.waitForTimeout(600);
      await expectNoSidewaysScroll(page, `${name} filter`);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click();
    }
  });
});
