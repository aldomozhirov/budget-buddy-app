import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';
import { expectNoSidewaysScroll } from './support/sideways-scroll.js';

/** Keypad key names where the key's symbol is not its name. */
const KEY_NAMES: Record<string, string> = { '.': 'Decimal point' };

/** Types an amount on the keypad that is open in the page or a sheet. */
async function typeAmount(
  scope: ReturnType<Page['getByRole']>,
  amount: string,
): Promise<void> {
  const keypad = scope.getByRole('group', { name: 'Amount keypad' });
  for (const key of amount) {
    await keypad
      .getByRole('button', { name: KEY_NAMES[key] ?? key, exact: true })
      .click();
  }
}

/** Saves a plain screenshot for the design comparison (webkit-e2e skill). */
async function shoot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'iphone') return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

interface Seeded {
  ids: Record<string, number>;
}

/**
 * Alena and Max; ING Visa and Cash (EUR), Wise $ (USD); Groceries and
 * Eating out envelopes (EUR); a rule for Lidl. Today: REWE (€64.20, ING
 * Visa, Shopping, Groceries envelope), Whole Foods ($23.39 on Wise $ into
 * the Groceries envelope, so at the date's rate), a transfer ING Visa →
 * Cash and one ING Visa → Wise $ at the fixture rate.
 */
async function seed(family: Family): Promise<Seeded> {
  const settings = (await (
    await family.api.get(`${family.origin}/api/settings`)
  ).json()) as { timeZone: string };
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timeZone,
  }).format(new Date());
  const ids: Record<string, number> = {
    Alena: 1,
    Max: await create(family, '/api/members', { name: 'Max' }),
  };
  for (const [name, owner, type, currency] of [
    ['ING Visa', 1, 'bank', 'EUR'],
    ['Cash €', 1, 'cash', 'EUR'],
    ['Wise $', 2, 'bank', 'USD'],
  ] as const) {
    ids[name] = await create(family, '/api/accounts', {
      name,
      ownerMemberId: owner,
      type,
      currency,
      openingBalance: '100000',
    });
  }
  for (const name of ['Groceries', 'Eating out']) {
    ids[name] = await create(family, '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount: '50000',
      mode: 'reset',
    });
  }
  const categories = (await (
    await family.api.get(`${family.origin}/api/categories`)
  ).json()) as { categories: { id: number; name: string }[] };
  for (const category of categories.categories) {
    ids[`category ${category.name}`] = category.id;
  }
  await create(family, '/api/rules', {
    pattern: 'Lidl',
    categoryId: ids['category Groceries'],
  });
  const add = (data: Record<string, unknown>) =>
    create(family, '/api/transactions', { date: today, ...data });
  ids.rewe = await add({
    kind: 'expense',
    accountId: ids['ING Visa'],
    amount: '6420',
    merchant: 'REWE',
    categoryId: ids['category Shopping'],
    envelopeId: ids.Groceries,
  });
  ids.wholeFoods = await add({
    kind: 'expense',
    accountId: ids['Wise $'],
    memberId: ids.Max,
    amount: '2339',
    merchant: 'Whole Foods',
    categoryId: ids['category Groceries'],
    envelopeId: ids.Groceries,
  });
  ids.cashOut = await add({
    kind: 'transfer',
    accountId: ids['ING Visa'],
    toAccountId: ids['Cash €'],
    amount: '20000',
  });
  ids.toWise = await add({
    kind: 'transfer',
    accountId: ids['ING Visa'],
    toAccountId: ids['Wise $'],
    amount: '2000',
    toAmount: '2186',
  });
  return { ids };
}

/** The detail rows of the page, top to bottom, by label. */
async function fieldLabels(page: Page): Promise<string[]> {
  return page
    .getByTestId('detail-row')
    .evaluateAll((rows) =>
      rows.map((row) => row.firstElementChild?.textContent ?? ''),
    );
}

test('every row opens a sheet, in the order of the Add form', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);
    await expect(page.getByRole('heading', { name: 'Expense' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Change amount' }),
    ).toHaveText('−€64.20');
    await expect(page.getByText('Today, ')).toContainText('· paid by Alena');

    expect(await fieldLabels(page)).toEqual([
      'Paid from',
      'Merchant',
      'Category',
      'Envelope',
      'Date',
      'Paid by',
      'Note',
    ]);
    for (const [label, title] of [
      ['Paid from', 'Paid from'],
      ['Merchant', 'Merchant'],
      ['Category', 'Category'],
      ['Envelope', 'Envelope'],
      ['Date', 'Date'],
      ['Paid by', 'Paid by'],
      ['Note', 'Note'],
    ] as const) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      const sheet = page.getByRole('dialog', { name: title });
      await expect(sheet).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/transactions/${ids.rewe}$`));
      await sheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(sheet).toHaveCount(0);
    }

    const envelope = page.getByRole('button', { name: /^Envelope/ });
    await envelope.click();
    const sheet = page.getByRole('dialog', { name: 'Envelope' });
    await expect(
      sheet.getByText('Changing it never changes the category.'),
    ).toBeVisible();
    await expect(sheet.getByRole('radio', { name: 'None' })).toBeVisible();
    await expect(
      sheet.getByRole('radio', { name: /^Groceries/ }),
    ).toContainText(/Resets monthly · .*€\d.* left/u);
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();

    await expectNoSidewaysScroll(page, 'Transaction');
    await shoot(page, testInfo, 'TransactionDetail');
  });
});

test('Paid from opens the account sheet; another account of the currency is saved', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);
    const row = page.getByRole('button', { name: /^Paid from/ });
    await expect(row).toContainText('ING Visa · EUR');
    await expect(row).toHaveAttribute('aria-haspopup', 'dialog');

    await row.click();
    const sheet = page.getByRole('dialog', { name: 'Paid from' });
    await expect(
      sheet.getByLabel('Search: bank, person, currency'),
    ).toBeVisible();
    await expect(
      sheet.getByRole('radio', { name: /^ING Visa · EUR/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await shoot(page, testInfo, 'TransactionAccount');
    // The current account closes the sheet and sends nothing.
    await sheet.getByRole('radio', { name: /^ING Visa · EUR/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText(/^Account changed/u)).toHaveCount(0);

    await row.click();
    await sheet.getByRole('radio', { name: /^Cash € · EUR/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect(row).toContainText('Cash € · EUR');
    await expect(
      page.getByRole('button', { name: 'Change amount' }),
    ).toHaveText('−€64.20');
    await expect(
      page.getByText('Account changed to Cash € by Alena', { exact: true }),
    ).toBeVisible();

    await page.goto(`${family.origin}/transactions`);
    await expect(
      page.getByTestId('transaction-row').filter({ hasText: 'REWE' }),
    ).toContainText('Cash €');
  });
});

test('an account in another currency asks for the amount in it first', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);
    const row = page.getByRole('button', { name: /^Paid from/ });

    // Closing the amount sheet changes nothing.
    await row.click();
    await page
      .getByRole('dialog', { name: 'Paid from' })
      .getByRole('radio', { name: /^Wise \$ · USD/ })
      .click();
    const amount = page.getByRole('dialog', { name: 'Amount' });
    await expect(amount).toContainText('$');
    await expect(amount).toContainText('64.20');
    await amount.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(amount).toHaveCount(0);
    await expect(row).toContainText('ING Visa · EUR');
    await page.reload();
    await expect(row).toContainText('ING Visa · EUR');
    await expect(
      page.getByRole('button', { name: 'Change amount' }),
    ).toHaveText('−€64.20');

    // Save stores the account and the amount together.
    await row.click();
    await page
      .getByRole('dialog', { name: 'Paid from' })
      .getByRole('radio', { name: /^Wise \$ · USD/ })
      .click();
    await amount
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await typeAmount(amount, '70');
    await amount.getByRole('button', { name: 'Save' }).click();
    await expect(amount).toHaveCount(0);
    await expect(row).toContainText('Wise $ · USD');
    await expect(
      page.getByRole('button', { name: 'Change amount' }),
    ).toHaveText('−$70.00');
    for (const text of [
      'Amount changed to $70.00 by Alena',
      'Account changed to Wise $ by Alena',
    ]) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    // The EUR envelope now counts the dollars at the date's rate.
    await expect(page.getByRole('button', { name: /^Envelope/ })).toContainText(
      /Groceries · counts as €\d/u,
    );
  });
});

test('income and transfers open the account sheet; a transfer’s To is changed', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    const income = await create(family, '/api/transactions', {
      kind: 'income',
      accountId: ids['ING Visa'],
      amount: '150000',
      categoryId: ids['category Salary'],
    });
    await page.goto(`${family.origin}/transactions/${income}`);
    await page.getByRole('button', { name: /^Paid into/ }).click();
    const into = page.getByRole('dialog', { name: 'Paid into' });
    await expect(
      into.getByRole('radio', { name: /^ING Visa · EUR/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await into.getByRole('button', { name: 'Close', exact: true }).click();

    // Each side's sheet leaves out the other side's account.
    await page.goto(`${family.origin}/transactions/${ids.cashOut}`);
    await page.getByRole('button', { name: /^From/ }).click();
    const from = page.getByRole('dialog', { name: 'Transfer from' });
    await expect(
      from.getByRole('radio', { name: /^ING Visa · EUR/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(from.getByRole('radio', { name: /^Cash €/ })).toHaveCount(0);
    await from.getByRole('button', { name: 'Close', exact: true }).click();
    const toRow = page.getByRole('button', { name: /^To/ });
    await toRow.click();
    const to = page.getByRole('dialog', { name: 'Transfer to' });
    await expect(
      to.getByRole('radio', { name: /^Cash € · EUR/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(to.getByRole('radio', { name: /^ING Visa/ })).toHaveCount(0);

    // A new pair of currencies asks for the amount that arrives.
    await to.getByRole('radio', { name: /^Wise \$ · USD/ }).click();
    const arrives = page.getByRole('dialog', { name: 'Amount that arrives' });
    await arrives
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await typeAmount(arrives, '218.6');
    await arrives.getByRole('button', { name: 'Save' }).click();
    await expect(toRow).toContainText('Wise $ · USD');
    await expect(page.getByRole('button', { name: /^Arrives/ })).toContainText(
      '$218.60',
    );
    await expect(
      page.getByText('To account changed to Wise $ by Alena', { exact: true }),
    ).toBeVisible();

    // Back to one currency: saved at once, and no second amount.
    await toRow.click();
    await to.getByRole('radio', { name: /^Cash € · EUR/ }).click();
    await expect(to).toHaveCount(0);
    await expect(toRow).toContainText('Cash € · EUR');
    expect(await fieldLabels(page)).not.toContain('Arrives');
  });
});

test('a transfer’s From in a new currency asks the amount sent, then what arrives', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await create(family, '/api/accounts', {
      name: 'Monzo £',
      ownerMemberId: 1,
      type: 'bank',
      currency: 'GBP',
      openingBalance: '100000',
    });
    await page.goto(`${family.origin}/transactions/${ids.toWise}`);
    await page.getByRole('button', { name: /^From/ }).click();
    await page
      .getByRole('dialog', { name: 'Transfer from' })
      .getByRole('radio', { name: /^Monzo £ · GBP/ })
      .click();

    const amount = page.getByRole('dialog', { name: 'Amount' });
    await expect(amount).toContainText('20.00');
    await amount
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await typeAmount(amount, '17');
    await amount.getByRole('button', { name: 'Save' }).click();
    const arrives = page.getByRole('dialog', { name: 'Amount that arrives' });
    await expect(arrives).toContainText('21.86');
    // Nothing is saved until the last amount.
    await expect(page.getByRole('button', { name: /^From/ })).toContainText(
      'ING Visa · EUR',
    );
    await arrives
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await typeAmount(arrives, '21.5');
    await arrives.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: /^From/ })).toContainText(
      'Monzo £ · GBP',
    );
    await expect(page.getByRole('button', { name: /^Amount/ })).toContainText(
      '£17.00',
    );
    await expect(page.getByRole('button', { name: /^Arrives/ })).toContainText(
      '$21.50',
    );
    await expect(
      page.getByText('Account changed to Monzo £ by Alena', { exact: true }),
    ).toBeVisible();
  });
});

test('a refused account change shows the server’s message and keeps the transaction', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.route(`**/api/transactions/${ids.rewe}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 400,
            json: {
              error: { message: 'This account was closed before that date.' },
            },
          })
        : route.continue(),
    );
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);
    const row = page.getByRole('button', { name: /^Paid from/ });
    await row.click();
    await page
      .getByRole('dialog', { name: 'Paid from' })
      .getByRole('radio', { name: /^Cash € · EUR/ })
      .click();
    await expect(page.getByRole('alert')).toHaveText(
      'This account was closed before that date.',
    );
    await expect(row).toContainText('ING Visa · EUR');

    await page.unroute(`**/api/transactions/${ids.rewe}`);
    await page.reload();
    await expect(row).toContainText('ING Visa · EUR');
    await expect(page.getByText(/^Account changed/u)).toHaveCount(0);
  });
});

test('a foreign-currency expense shows what it counts as and keeps a typed value', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.wholeFoods}`);
    await expect(
      page.getByRole('button', { name: 'Change amount' }),
    ).toHaveText('−$23.39');
    const row = page.getByRole('button', { name: /^Envelope/ });
    await expect(row).toContainText(/Groceries · counts as €\d/u);
    // The whole value is shown, not cut off with an ellipsis.
    const value = page.getByTestId('envelope-value');
    await expect(value).toHaveText(/^Groceries · counts as €\d[\d,]*\.\d\d$/u);
    await expect(value).toBeVisible();
    expect(
      await value.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth &&
          element.scrollHeight <= element.clientHeight,
      ),
    ).toBe(true);
    await shoot(page, testInfo, 'TransactionFx');

    await row.click();
    const sheet = page.getByRole('dialog', { name: 'Envelope' });
    await expect(
      sheet.getByText('Counts in the envelope as').first(),
    ).toBeVisible();
    await expect(
      sheet.getByText(/At the rate of .+: \$1 = €[\d.]+\. Type what/u),
    ).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: 'Type the amount in EUR' }),
    ).toBeDisabled();
    await shoot(page, testInfo, 'TransactionFxEnvelope');

    await typeAmount(sheet, '21.40');
    await sheet.getByRole('button', { name: 'Count it as €21.40' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(row).toContainText('Groceries · counts as €21.40');

    // The typed amount stays and is marked as typed by hand (3.3).
    await row.click();
    await expect(
      page.getByText(/^Typed by hand\. It changes again if/u),
    ).toBeVisible();
    await expect(
      page
        .getByRole('dialog', { name: 'Envelope' })
        .getByText('€21.40')
        .first(),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Envelope' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await page.reload();
    await expect(page.getByRole('button', { name: /^Envelope/ })).toContainText(
      'Groceries · counts as €21.40',
    );
  });
});

test('changing the category offers a rule, which is saved first', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);

    await page.getByRole('button', { name: /^Category/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Category' });
    await sheet.getByLabel('Search or add a category').fill('Groc');
    await sheet.getByRole('radio', { name: 'Groceries' }).first().click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Category/ })).toContainText(
      'Groceries',
    );
    await expect(
      page.getByText('Always label REWE as Groceries?'),
    ).toBeVisible();
    await shoot(page, testInfo, 'TransactionRuleOffer');

    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByText('Rule saved: REWE → Groceries')).toBeVisible();
    await expect(page.getByText('Always label REWE as Groceries?')).toHaveCount(
      0,
    );

    const rules = (await (
      await family.api.get(`${family.origin}/api/rules`)
    ).json()) as { rules: { pattern: string }[] };
    expect(rules.rules.map((rule) => rule.pattern)).toEqual(['REWE', 'Lidl']);

    // The Record names both changes.
    await expect(page.getByText('Typed in by Alena')).toBeVisible();
    await expect(
      page.getByText('Category changed to Groceries by Alena'),
    ).toBeVisible();

    await page.goto(`${family.origin}/categories?tab=rules`);
    await expect(
      page.getByRole('list', { name: 'Rules' }).getByRole('listitem').first(),
    ).toContainText('REWE');
  });
});

test('"Just this once" saves no rule; the envelope can be cleared on its own', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);

    await page.getByRole('button', { name: /^Category/ }).click();
    await page
      .getByRole('dialog', { name: 'Category' })
      .getByRole('radio', { name: 'Eating out' })
      .first()
      .click();
    await expect(
      page.getByText('Always label REWE as Eating out?'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Just this once' }).click();
    await expect(
      page.getByText('Always label REWE as Eating out?'),
    ).toHaveCount(0);
    const rules = (await (
      await family.api.get(`${family.origin}/api/rules`)
    ).json()) as { rules: unknown[] };
    expect(rules.rules).toHaveLength(1);

    // "None" keeps the category (UI-ADD-12, UI-TXN-5).
    await page.getByRole('button', { name: /^Envelope/ }).click();
    await page
      .getByRole('dialog', { name: 'Envelope' })
      .getByRole('radio', { name: 'None' })
      .click();
    await expect(page.getByRole('button', { name: /^Envelope/ })).toContainText(
      'None',
    );
    await expect(page.getByRole('button', { name: /^Category/ })).toContainText(
      'Eating out',
    );
  });
});

test('the amount, merchant, date, payer and note are edited and recorded', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.rewe}`);

    await page.getByRole('button', { name: 'Change amount' }).click();
    const amount = page.getByRole('dialog', { name: 'Amount' });
    await amount
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await typeAmount(amount, '70');
    await amount.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('button', { name: 'Change amount' }),
    ).toHaveText('−€70.00');

    await page.getByRole('button', { name: /^Merchant/ }).click();
    const merchant = page.getByRole('dialog', { name: 'Merchant' });
    await merchant.getByLabel('Search or type a merchant').fill('Edeka');
    await merchant.getByRole('button', { name: 'Use “Edeka”' }).click();
    await expect(page.getByRole('button', { name: /^Merchant/ })).toContainText(
      'Edeka',
    );

    await page.getByRole('button', { name: /^Paid by/ }).click();
    await page
      .getByRole('dialog', { name: 'Paid by' })
      .getByRole('radio', { name: 'Max' })
      .click();
    await expect(page.getByRole('button', { name: /^Paid by/ })).toContainText(
      'Max',
    );

    await page.getByRole('button', { name: /^Date/ }).click();
    const date = page.getByRole('dialog', { name: 'Date' });
    await date.getByRole('button', { name: /^Yesterday/ }).click();
    await expect(page.getByText(/^Yesterday, /u)).toContainText(
      '· paid by Max',
    );

    await page.getByRole('button', { name: /^Note/ }).click();
    const note = page.getByRole('dialog', { name: 'Note' });
    await note.getByLabel('Note').fill('Birthday cake');
    await note.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: /^Note/ })).toContainText(
      'Birthday cake',
    );

    for (const text of [
      'Amount changed to €70.00 by Alena',
      'Merchant changed to Edeka by Alena',
      'Paid by changed to Max by Alena',
      'Note changed by Alena',
    ]) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText(/^Date changed to Yesterday by Alena/u),
    ).toBeVisible();
  });
});

test('a transfer shows From, To, both amounts, Done by, Date and Note', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions/${ids.toWise}`);
    await expect(page.getByRole('heading', { name: 'Transfer' })).toBeVisible();
    expect(await fieldLabels(page)).toEqual([
      'From',
      'To',
      'Amount',
      'Arrives',
      'Done by',
      'Date',
      'Note',
    ]);
    await expect(page.getByRole('button', { name: /^To/ })).toContainText(
      'Wise $ · USD',
    );
    await expect(page.getByRole('button', { name: /^Arrives/ })).toContainText(
      '$21.86',
    );
    await shoot(page, testInfo, 'TransactionTransfer');

    await page.getByRole('button', { name: /^Arrives/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Amount that arrives' });
    await sheet
      .getByRole('group', { name: 'Amount keypad' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await typeAmount(sheet, '22');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: /^Arrives/ })).toContainText(
      '$22.00',
    );
    await expect(
      page.getByText('Amount that arrives changed to $22.00 by Alena'),
    ).toBeVisible();

    // Within one currency there is no second amount.
    await page.goto(`${family.origin}/transactions/${ids.cashOut}`);
    expect(await fieldLabels(page)).not.toContain('Arrives');
  });
});

test('Delete asks first, says where the money goes back, and returns to the list', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions`);
    await page
      .getByTestId('transaction-row')
      .filter({ hasText: 'REWE' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${ids.rewe}$`));

    await page.getByRole('button', { name: 'Delete' }).click();
    const sheet = page.getByRole('dialog', { name: 'Delete this expense?' });
    await expect(
      sheet.getByText('€64.20 goes back into Groceries. This can’t be undone.'),
    ).toBeVisible();
    await shoot(page, testInfo, 'TransactionDelete');
    await sheet.getByRole('button', { name: 'Keep it' }).click();
    await expect(sheet).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete this expense?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByTestId('transaction-row')).toHaveCount(3);
    await expect(
      page.getByTestId('transaction-row').filter({ hasText: 'REWE' }),
    ).toHaveCount(0);
  });
});

test('Back returns to the list as it was, and to the envelope page', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await page.goto(`${family.origin}/transactions`);
    await expect(page.getByTestId('transaction-row').first()).toBeVisible();

    // A filter picked on the list is still there after Back.
    await page.getByRole('button', { name: /^Member:/ }).click();
    const members = page.getByRole('dialog', { name: /^Member/ });
    await members.getByRole('checkbox', { name: /^Max/ }).click();
    await members.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    await page.getByTestId('transaction-row').click();
    await expect(page).toHaveURL(
      new RegExp(`/transactions/${ids.wholeFoods}$`),
    );
    await page.getByRole('button', { name: 'Back to transactions' }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(
      page.getByRole('button', { name: 'Member: Max' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);

    // An expense on the envelope page opens its transaction.
    await page.goto(`${family.origin}/envelopes/${ids.Groceries}`);
    await page.getByRole('link', { name: /REWE/ }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${ids.rewe}$`));
    await page
      .getByRole('button', { name: 'Back to envelope', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/envelopes/${ids.Groceries}$`));
  });
});

test('a page that cannot be found says so', async ({ page }) => {
  await startFamily(page, async (family) => {
    await page.goto(`${family.origin}/transactions/9999`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
