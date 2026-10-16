import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/** Keypad key names where the key's symbol is not its name. */
const KEY_NAMES: Record<string, string> = {
  '.': 'Decimal point',
  '−': 'Minus',
};

/** Types on the visible keypad, key by key. */
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

/**
 * Alena and Max; Alena's banks, her two cash accounts (so the chips read
 * "Cash €" and "Cash $"), Wise in dollars, and Max's DKB, which is beyond the
 * five account chips. Starter categories give Salary and Other income.
 */
async function seed(family: Family): Promise<void> {
  await create(family, '/api/members', { name: 'Max' });
  for (const [name, owner, type, currency] of [
    ['ING Visa', 1, 'bank', 'EUR'],
    ['N26', 1, 'bank', 'EUR'],
    ['Revolut', 1, 'bank', 'EUR'],
    ['Wise', 1, 'bank', 'USD'],
    ['Cash', 1, 'cash', 'EUR'],
    ['Cash', 1, 'cash', 'USD'],
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
  await create(family, '/api/envelopes', {
    name: 'Groceries',
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
  });
}

/** Waits until the fixture feed has stored the EUR → USD rate. */
async function waitForRate(family: Family): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await family.api.get(
          `${family.origin}/api/rates/pair?from=EUR&to=USD&date=2099-01-01`,
        );
        return ((await response.json()) as { rate: unknown }).rate !== null;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function openKind(
  page: Page,
  family: Family,
  kind: 'income' | 'transfer',
): Promise<void> {
  await page.goto(`${family.origin}/add?kind=${kind}`);
  await expect(
    page.getByRole('radio', {
      name: kind === 'income' ? 'Income' : 'Transfer',
      checked: true,
    }),
  ).toBeVisible();
}

/** The whole form is on screen without scrolling (UI-ADD-1). */
async function expectFits(page: Page): Promise<void> {
  const save = page.getByRole('button', {
    name: /^(Save|Enter an amount|Type what arrives)/,
  });
  const box = await save.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(
    await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return main.scrollHeight - main.clientHeight;
    }),
  ).toBeLessThanOrEqual(0);
}

/** Clicks Save and returns the transaction the server stored. */
async function saveAndRead(
  page: Page,
  family: Family,
  name: string | RegExp,
): Promise<Record<string, string | number | null>> {
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/transactions') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name }).click();
  const { transaction } = (await (await created).json()) as {
    transaction: { id: number };
  };
  const stored = await family.api.get(
    `${family.origin}/api/transactions/${transaction.id}`,
  );
  return (
    (await stored.json()) as {
      transaction: Record<string, string | number | null>;
    }
  ).transaction;
}

test('an income into Max’s DKB with Salary saves, with no merchant or envelope', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openKind(page, family, 'income');
    await screenshot(page, testInfo, 'AddIncome');
    await expectFits(page);

    // The income form: Paid into, income categories, Received by.
    await expect(
      page.getByRole('radiogroup', { name: 'Paid into' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add merchant' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('radiogroup', { name: 'Envelope' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('radiogroup', { name: 'To', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Received by: Alena/ }),
    ).toBeVisible();
    const categories = page.getByRole('radiogroup', { name: 'Category' });
    await expect(
      categories.getByRole('radio', { name: 'Salary' }),
    ).toBeVisible();
    await expect(
      categories.getByRole('radio', { name: 'Groceries' }),
    ).toHaveCount(0);

    // DKB is beyond the chips: find it in the sheet, where it goes first.
    await page
      .getByRole('button', { name: 'All accounts', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Paid into' });
    await sheet.getByLabel('Search: bank, person, currency').fill('dkb');
    await sheet.getByRole('radio', { name: /DKB · EUR/ }).click();
    await expect(
      page.getByRole('radio', { name: 'Max · DKB', checked: true }),
    ).toBeVisible();

    // An income is never negative: the minus key is off.
    await expect(
      page.getByRole('button', { name: 'Minus', exact: true }),
    ).toBeDisabled();
    await typeAmount(page, '4200');
    await categories.getByRole('radio', { name: 'Salary' }).click();
    const stored = await saveAndRead(page, family, 'Save €4,200.00');

    await expect(
      page.getByRole('heading', { name: 'Income saved' }),
    ).toBeFocused();
    await expect(
      page.getByText('€4,200.00 · Max · DKB · Salary', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No category yet.')).toHaveCount(0);
    await screenshot(page, testInfo, 'AddIncomeSaved');
    expect(stored).toMatchObject({
      kind: 'income',
      amount: '420000',
      toAccountId: null,
      envelopeId: null,
      merchant: null,
    });
    expect(stored.categoryId).not.toBeNull();
  });
});

test('switching the kind clears category and envelope', async ({ page }) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/add`);
    await page
      .getByRole('radiogroup', { name: 'Category' })
      .getByRole('radio', { name: 'Groceries' })
      .click();
    await page.getByRole('radio', { name: 'Income', exact: true }).click();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { checked: true }),
    ).toHaveCount(0);
    await page.getByRole('radio', { name: 'Expense', exact: true }).click();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { checked: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('radiogroup', { name: 'Envelope' })
        .getByRole('radio', { checked: true }),
    ).toHaveCount(0);

    // A refund is only an expense: the negative amount does not carry over.
    await typeAmount(page, '−5');
    await page.getByRole('radio', { name: 'Income', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Enter an amount' }),
    ).toBeDisabled();
  });
});

test('a transfer in one currency saves one amount, and To never offers From', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openKind(page, family, 'transfer');
    await screenshot(page, testInfo, 'AddTransfer');
    await expectFits(page);

    const from = page.getByRole('radiogroup', { name: 'From' });
    const to = page.getByRole('radiogroup', { name: 'To', exact: true });
    await expect(
      page.getByRole('button', { name: 'Add merchant' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('radiogroup', { name: 'Category' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Done by: Alena/ }),
    ).toBeVisible();
    await expect(
      from.getByRole('radio', { name: 'ING Visa', checked: true }),
    ).toBeVisible();
    await expect(to.getByRole('radio', { name: 'ING Visa' })).toHaveCount(0);

    // Choosing the account it goes to as the account it leaves moves "To".
    await to.getByRole('radio', { name: 'Cash €' }).click();
    await from.getByRole('radio', { name: 'Cash €' }).click();
    await expect(to.getByRole('radio', { name: 'Cash €' })).toHaveCount(0);
    await expect(to.getByRole('radio', { checked: true })).toHaveCount(1);
    await from.getByRole('radio', { name: 'ING Visa' }).click();
    await to.getByRole('radio', { name: 'Cash €' }).click();

    // The sheet leaves the account it leaves out as well.
    await page.getByRole('button', { name: 'All accounts to send to' }).click();
    const sheet = page.getByRole('dialog', { name: 'Transfer to' });
    await expect(sheet.getByRole('radio', { name: /ING Visa/ })).toHaveCount(0);
    await expect(
      sheet.getByRole('radio', { name: /Cash/ }).first(),
    ).toBeVisible();
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();

    await typeAmount(page, '200');
    await expect(page.getByRole('button', { name: /^Arrives as/ })).toHaveCount(
      0,
    );
    const stored = await saveAndRead(page, family, 'Save €200.00');
    await expect(
      page.getByRole('heading', { name: 'Transfer saved' }),
    ).toBeFocused();
    await expect(
      page.getByText('€200.00 · ING Visa → Cash €', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No category yet.')).toHaveCount(0);
    await screenshot(page, testInfo, 'AddTransferSaved');
    expect(stored).toMatchObject({
      kind: 'transfer',
      amount: '20000',
      toAmount: '20000',
      categoryId: null,
    });
  });
});

test('a transfer in two currencies arrives at the date’s rate, and can be typed', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await waitForRate(family);
    await openKind(page, family, 'transfer');
    await page
      .getByRole('radiogroup', { name: 'To', exact: true })
      .getByRole('radio', { name: 'Wise $' })
      .click();
    await typeAmount(page, '20');

    const arrives = page.getByRole('button', { name: /^Arrives as \$/ });
    await expect(arrives).toBeVisible();
    const shown = (await arrives.textContent())!.match(/\$([\d,.]+)/)![1]!;
    const auto = Math.round(Number(shown.replace(',', '')) * 100);
    // 20 euros at a rate near 1.1: a believable number, not the amount.
    expect(auto).toBeGreaterThan(2000);
    await expect(
      page.getByRole('button', { name: `Save €20.00 → $${shown}` }),
    ).toBeEnabled();
    await expectFits(page);
    await screenshot(page, testInfo, 'AddTransferFx');

    // A tap moves the keypad to the second amount; the first one dims.
    await arrives.click();
    await expect(arrives).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Amount €20.00. Type it again' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'AddTransferFxEditing');
    await typeAmount(page, '21.86');
    await expect(
      page.getByRole('button', { name: 'Arrives as $21.86. Change' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Save €20.00 → $21.86' }),
    ).toBeEnabled();

    // A tap on the first amount moves the keypad back.
    await page
      .getByRole('button', { name: 'Amount €20.00. Type it again' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Amount €20.00', exact: true }),
    ).toBeVisible();
    await expect(arrives).toHaveAttribute('aria-pressed', 'false');

    const stored = await saveAndRead(page, family, 'Save €20.00 → $21.86');
    await expect(
      page.getByText('€20.00 → $21.86 · ING Visa → Wise $', { exact: true }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'AddTransferFxSaved');
    expect(stored).toMatchObject({
      kind: 'transfer',
      amount: '2000',
      currency: 'EUR',
      toAmount: '2186',
      toCurrency: 'USD',
    });
  });
});

test('without a rate a transfer asks what arrives and waits for it', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.route('**/api/rates/pair*', (route) =>
      route.fulfill({ json: { rate: null } }),
    );
    await openKind(page, family, 'transfer');
    await page
      .getByRole('radiogroup', { name: 'To', exact: true })
      .getByRole('radio', { name: 'Wise $' })
      .click();
    await typeAmount(page, '20');

    const ask = page.getByRole('button', {
      name: 'Type what arrives in Wise $. Change',
    });
    await expect(ask).toBeVisible();
    // The warning colour: the soft warning background.
    await expect(ask).toHaveCSS('background-color', 'rgb(245, 226, 212)');
    await expect(
      page.getByRole('button', { name: 'Type what arrives', exact: true }),
    ).toBeDisabled();
    await screenshot(page, testInfo, 'AddTransferFxNoRate');

    await ask.click();
    await typeAmount(page, '21.86');
    await expect(
      page.getByRole('button', { name: 'Save €20.00 → $21.86' }),
    ).toBeEnabled();
    // Clearing it again takes the button away.
    await page
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Type what arrives', exact: true }),
    ).toBeDisabled();

    await typeAmount(page, '21.86');
    const stored = await saveAndRead(page, family, 'Save €20.00 → $21.86');
    expect(stored).toMatchObject({ amount: '2000', toAmount: '2186' });
  });
});
