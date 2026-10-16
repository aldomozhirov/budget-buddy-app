import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/** Keypad key names where the key's symbol is not its name. */
const KEY_NAMES: Record<string, string> = {
  '.': 'Decimal point',
  '−': 'Minus',
};

/** Types an amount on the app's keypad, key by key. */
async function typeAmount(page: Page, amount: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of amount) {
    await keypad
      .getByRole('button', { name: KEY_NAMES[key] ?? key, exact: true })
      .click();
  }
}

/** Saves a plain screenshot for the design comparison (webkit-e2e skill). */
async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'iphone') return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

interface Seeded {
  groceries: number;
  transport: number;
  groceriesEnvelope: number;
}

/**
 * Alena and Max; four of Alena's accounts and Max's DKB; the three
 * envelopes; Groceries files into the Groceries envelope by default; a rule
 * sends REWE to Groceries.
 */
async function seed(family: Family): Promise<Seeded> {
  await create(family, '/api/members', { name: 'Max' });
  for (const [name, owner, type, currency] of [
    ['ING Visa', 1, 'bank', 'EUR'],
    ['Cash', 1, 'cash', 'EUR'],
    ['Revolut', 1, 'bank', 'EUR'],
    ['Wise', 1, 'bank', 'USD'],
    ['DKB', 2, 'bank', 'EUR'],
  ] as const) {
    await create(family, '/api/accounts', {
      name,
      ownerMemberId: owner,
      type,
      currency,
      openingBalance: '100000',
    });
  }
  const envelopes: number[] = [];
  for (const name of ['Groceries', 'Eating out', 'Unexpected']) {
    envelopes.push(
      await create(family, '/api/envelopes', {
        name,
        currency: 'EUR',
        monthlyAmount: '50000',
        mode: 'reset',
      }),
    );
  }
  const response = await family.api.get(
    `${family.origin}/api/categories?kind=expense`,
  );
  const { categories } = (await response.json()) as {
    categories: { id: number; name: string }[];
  };
  const byName = (name: string) =>
    categories.find((category) => category.name === name)!.id;
  const groceries = byName('Groceries');
  const patched = await family.api.patch(
    `${family.origin}/api/categories/${groceries}`,
    {
      headers: { Origin: family.origin },
      data: { defaultEnvelopeId: envelopes[0] },
    },
  );
  expect(patched.status()).toBe(200);
  await create(family, '/api/rules', {
    pattern: 'REWE',
    categoryId: groceries,
    envelopeId: envelopes[0],
  });
  return {
    groceries,
    transport: byName('Transport'),
    groceriesEnvelope: envelopes[0]!,
  };
}

async function openAdd(page: Page, family: Family): Promise<void> {
  await page.goto(`${family.origin}/add`);
  await expect(
    page.getByRole('button', { name: 'Enter an amount' }),
  ).toBeDisabled();
}

/** Picks a merchant by typing it in the merchant sheet. */
async function pickMerchant(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /^(Add merchant|Merchant: .*)$/ })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Merchant' });
  await sheet.getByLabel('Search or type a merchant').fill(name);
  await sheet.getByRole('button', { name: `Use “${name}”` }).click();
  await expect(sheet).toHaveCount(0);
}

test('an expense with only an amount saves and fits the screen', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    await screenshot(page, testInfo, 'AddExpense');

    // The whole form fits without scrolling (UI-ADD-1).
    const save = page.getByRole('button', { name: 'Enter an amount' });
    const box = await save.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return main.scrollHeight - main.clientHeight;
      }),
    ).toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    ).toBeLessThanOrEqual(0);

    await expect(
      page.getByRole('radio', { name: 'ING Visa', checked: true }),
    ).toBeVisible();
    await typeAmount(page, '23.80');
    await page.getByRole('button', { name: 'Save €23.80' }).click();

    await expect(
      page.getByRole('heading', { name: 'Expense saved' }),
    ).toBeVisible();
    await expect(
      page.getByText('€23.80 · ING Visa', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'No category yet. It waits in Needs a category, with a suggestion.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Needs a category' }),
    ).toHaveAttribute('href', '/transactions?tab=needs-category');
    await screenshot(page, testInfo, 'AddExpenseSaved');

    await page.getByRole('button', { name: 'Add another' }).click();
    await expect(
      page.getByRole('button', { name: 'Enter an amount' }),
    ).toBeDisabled();
  });
});

test('a merchant rule fills category and envelope, never over a hand pick', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    const categories = page.getByRole('radiogroup', { name: 'Category' });
    const envelopes = page.getByRole('radiogroup', { name: 'Envelope' });

    await pickMerchant(page, 'REWE');
    await expect(page.getByText('Category · from REWE rule')).toBeVisible();
    await expect(page.getByText('Envelope · from REWE rule')).toBeVisible();
    await expect(page.getByText('Rule applied · change')).toBeVisible();
    await expect(
      categories.getByRole('radio', { name: 'Groceries' }),
    ).toBeChecked();
    await expect(
      envelopes.getByRole('radio', { name: 'Groceries' }),
    ).toBeChecked();
    await typeAmount(page, '42.10');
    await screenshot(page, testInfo, 'AddExpenseRule');

    await pickMerchant(page, 'Shell');
    await expect(
      page.getByText('Category · optional', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Envelope · optional', { exact: true }),
    ).toBeVisible();
    await expect(categories.getByRole('radio', { checked: true })).toHaveCount(
      0,
    );
    await expect(envelopes.getByRole('radio', { checked: true })).toHaveCount(
      0,
    );

    // A category picked by hand survives another merchant's rule.
    await categories.getByRole('radio', { name: 'Transport' }).click();
    await pickMerchant(page, 'REWE');
    await expect(
      categories.getByRole('radio', { name: 'Transport' }),
    ).toBeChecked();
    await expect(
      envelopes.getByRole('radio', { name: 'Groceries' }),
    ).toBeChecked();
    await expect(page.getByText('Envelope · from REWE rule')).toBeVisible();
  });
});

test('the envelope label previews the on-save fill and the saved view says it', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    const categories = page.getByRole('radiogroup', { name: 'Category' });

    await categories.getByRole('radio', { name: 'Groceries' }).click();
    await expect(
      page.getByText('Envelope · optional · if empty, Groceries'),
    ).toBeVisible();

    // Tapping the selected chip clears it.
    await categories.getByRole('radio', { name: 'Groceries' }).click();
    await expect(categories.getByRole('radio', { checked: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText('Envelope · optional', { exact: true }),
    ).toBeVisible();

    await categories.getByRole('radio', { name: 'Groceries' }).click();
    await typeAmount(page, '5');
    await page.getByRole('button', { name: 'Save €5.00' }).click();
    await expect(
      page.getByText('Groceries envelope added from the Groceries category.'),
    ).toBeVisible();
    await expect(
      page.getByText('€5.00 · ING Visa · Groceries', { exact: true }),
    ).toBeVisible();
  });
});

test('a refund saves with a leading minus', async ({ page }, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    await typeAmount(page, '−19.99');
    await expect(page.getByText('−€19.99', { exact: true })).toBeVisible();
    await screenshot(page, testInfo, 'AddExpenseRefund');
    await page.getByRole('button', { name: 'Save −€19.99' }).click();
    await expect(
      page.getByText('−€19.99 · ING Visa', { exact: true }),
    ).toBeVisible();
  });
});

test('the date sheet is a month calendar without future days', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-14T10:00:00Z'));
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    const tile = page.getByRole('button', { name: 'Date: Today. Change' });
    await expect(tile).not.toHaveCSS('box-shadow', /inset/);
    await tile.click();
    const sheet = page.getByRole('dialog', { name: 'Date' });
    await expect(
      sheet.getByRole('group', { name: 'October 2026' }),
    ).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: '15 October 2026' }),
    ).toBeDisabled();
    await expect(
      sheet.getByRole('button', { name: '14 October 2026' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      sheet.getByRole('button', { name: 'Next month' }),
    ).toBeDisabled();
    await screenshot(page, testInfo, 'AddExpenseDate');
    await sheet.getByRole('button', { name: '12 October 2026' }).click();
    const changed = page.getByRole('button', {
      name: 'Date: Mon 12 Oct. Change',
    });
    await expect(changed).toHaveCSS('box-shadow', /inset/);

    await changed.click();
    await page
      .getByRole('dialog', { name: 'Date' })
      .getByRole('button', { name: 'Today' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Date: Today. Change' }),
    ).toBeVisible();
  });
});

test('Paid by and Note sheets change their tiles', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    const tile = page.getByRole('button', { name: 'Paid by: Alena. Change' });
    await expect(tile).not.toHaveCSS('box-shadow', /inset/);
    await tile.click();
    const sheet = page.getByRole('dialog', { name: 'Paid by' });
    await expect(
      sheet.getByText('Who paid. The account above stays as picked.'),
    ).toBeVisible();
    await expect(
      sheet.getByRole('radio', { name: 'Alena (you)' }),
    ).toBeChecked();
    await screenshot(page, testInfo, 'AddExpensePaidBy');
    await sheet.getByRole('radio', { name: 'Max' }).click();
    await expect(
      page.getByRole('button', { name: 'Paid by: Max. Change' }),
    ).toHaveCSS('box-shadow', /inset/);

    await page.getByRole('button', { name: 'Add note' }).click();
    const note = page.getByRole('dialog', { name: 'Note' });
    await note.getByLabel('Note').fill('  Birthday cake  ');
    await screenshot(page, testInfo, 'AddExpenseNote');
    await note.getByRole('button', { name: 'Done' }).click();
    await expect(
      page.getByRole('button', { name: 'Note: Birthday cake. Change' }),
    ).toHaveCSS('box-shadow', /inset/);

    await typeAmount(page, '3');
    await page.getByRole('button', { name: 'Save €3.00' }).click();
    await expect(
      page.getByText('€3.00 · paid by Max · ING Visa', { exact: true }),
    ).toBeVisible();
  });
});

test('All… on accounts finds Max’s DKB and puts it first', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    const accounts = page.getByRole('radiogroup', { name: 'Paid from' });
    await expect(
      accounts.getByRole('radio', { name: 'Max · DKB' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'All accounts' }).click();
    const sheet = page.getByRole('dialog', { name: 'Paid from' });
    await expect(sheet.getByRole('heading', { name: 'Yours' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Max’s' })).toBeVisible();
    await screenshot(page, testInfo, 'SearchAccounts');
    await sheet.getByLabel('Search: bank, person, currency').fill('max');
    await expect(sheet.getByRole('heading', { name: '1 match' })).toBeVisible();
    await sheet.getByRole('radio', { name: /DKB · EUR/ }).click();
    await expect(sheet).toHaveCount(0);

    await expect(accounts.getByRole('radio').first()).toHaveAccessibleName(
      'Max · DKB',
    );
    await expect(
      accounts.getByRole('radio', { name: 'Max · DKB' }),
    ).toBeChecked();
  });
});

test('Add category creates and selects it', async ({ page }, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    await page.getByRole('button', { name: 'All categories' }).click();
    const sheet = page.getByRole('dialog', { name: 'Category' });
    await expect(sheet.getByRole('heading', { name: 'Recent' })).toBeVisible();
    await expect(
      sheet.getByRole('heading', { name: 'All categories' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'SearchCategories');
    await sheet.getByLabel('Search or add a category').fill('Pets');
    await sheet.getByRole('button', { name: 'Add category “Pets”' }).click();
    await expect(sheet).toHaveCount(0);
    const categories = page.getByRole('radiogroup', { name: 'Category' });
    await expect(categories.getByRole('radio').first()).toHaveAccessibleName(
      'Pets',
    );
    await expect(categories.getByRole('radio', { name: 'Pets' })).toBeChecked();
  });
});

test('Undo deletes the saved expense and returns to the form', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openAdd(page, family);
    await page.getByRole('button', { name: /^(Add merchant)$/ }).click();
    await screenshot(page, testInfo, 'AddExpenseMerchant');
    await page.keyboard.press('Escape');
    await typeAmount(page, '7.50');
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/transactions') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save €7.50' }).click();
    const { transaction } = (await (await created).json()) as {
      transaction: { id: number };
    };
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.getByRole('button', { name: 'Save €7.50' }),
    ).toBeEnabled();
    const gone = await family.api.get(
      `${family.origin}/api/transactions/${transaction.id}`,
    );
    expect(gone.status()).toBe(404);
  });
});
