import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * Expenses saved offline (spec 2 task 17; TXN-7, UI-ADD-14, UI-TXN-9,
 * UI-HOME-8): the outbox keeps them, the list and Home show them, they are
 * sent once when the connection returns, a refusal shows "Couldn’t send",
 * and sign-out asks before deleting what is left. The pages are tabs of one
 * phone; the service worker runs, as in the installed app.
 */
test.use({ serviceWorkers: 'allow' });

/** Keypad key names where the key's symbol is not its name. */
const KEY_NAMES: Record<string, string> = { '.': 'Decimal point' };

const OFFLINE_NOTE = 'Offline. It stays on this phone and sends itself later.';
const PHONE_NOTE = 'Items still on this phone are not in the day totals.';

/** Types an amount on the app's keypad, key by key. */
async function typeAmount(page: Page, amount: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of amount) {
    await keypad
      .getByRole('button', { name: KEY_NAMES[key] ?? key, exact: true })
      .click();
  }
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
 * ING Visa and Cash, the Eating out envelope, and a REWE expense of €64.20
 * today, so today's total is known. Returns the envelope's id.
 */
async function seed(family: Family): Promise<number> {
  const visa = await create(family, '/api/accounts', {
    name: 'ING Visa',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '100000',
  });
  await create(family, '/api/accounts', {
    name: 'Cash',
    ownerMemberId: 1,
    type: 'cash',
    currency: 'EUR',
    openingBalance: '10000',
  });
  const eatingOut = await create(family, '/api/envelopes', {
    name: 'Eating out',
    currency: 'EUR',
    monthlyAmount: '20000',
    mode: 'reset',
  });
  await create(family, '/api/transactions', {
    kind: 'expense',
    accountId: visa,
    amount: '6420',
    merchant: 'REWE',
  });
  return eatingOut;
}

async function openAdd(page: Page, family: Family): Promise<void> {
  await page.goto(`${family.origin}/add`);
  await expect(
    page.getByRole('button', { name: 'Enter an amount' }),
  ).toBeDisabled();
}

/** The rows of the server whose merchant is `merchant`, over all time. */
async function serverRows(family: Family, merchant: string) {
  const response = await family.api.get(
    `${family.origin}/api/transactions?period=all&q=${encodeURIComponent(merchant)}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    transactions: { merchant: string | null }[];
  };
  return body.transactions.filter((row) => row.merchant === merchant);
}

/** The records in the page's outbox store. */
function outboxRecords(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('budget-buddy');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const count = open.result
            .transaction('outbox', 'readonly')
            .objectStore('outbox')
            .count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
      }),
  );
}

test('an expense saved offline waits in the list and is sent once', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    const context = page.context();
    const list = await context.newPage();
    await list.goto(`${family.origin}/transactions`);
    await expect(list.getByText('€64.20 spent').first()).toBeVisible();

    await openAdd(page, family);
    await context.setOffline(true);
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
    await typeAmount(page, '6.40');
    await pickMerchant(page, 'Bäckerei Müller');
    await page.getByRole('button', { name: 'Save €6.40' }).click();
    await expect(
      page.getByRole('heading', { name: 'Expense saved on this phone' }),
    ).toBeFocused();
    await expect(
      page.getByText('€6.40 · Bäckerei Müller · ING Visa', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
    expect(await outboxRecords(page)).toBe(1);

    // The list loaded before shows it at the top of today, outside the total.
    const waiting = list.getByRole('button', { name: /^Bäckerei Müller/ });
    await expect(waiting).toContainText('Waiting to send');
    await expect(waiting).toContainText('−€6.40');
    await expect(list.getByText(PHONE_NOTE)).toBeVisible();
    await expect(list.getByText('€64.20 spent').first()).toBeVisible();
    await expect(list.getByTestId('transaction-row').first()).toContainText(
      'Bäckerei Müller',
    );
    await screenshot(list, testInfo, 'TransactionsOutboxWaiting');

    // Back online, both tabs send; the server keeps one row (client id).
    await context.setOffline(false);
    await expect(
      list.getByRole('link', { name: /^Bäckerei Müller/ }),
    ).toBeVisible();
    await expect(list.getByText('Waiting to send')).toHaveCount(0);
    await expect(list.getByText(PHONE_NOTE)).toHaveCount(0);
    await expect(list.getByText('€70.60 spent').first()).toBeVisible();
    expect(await serverRows(family, 'Bäckerei Müller')).toHaveLength(1);
    expect(await outboxRecords(page)).toBe(0);
    await list.close();
  });
});

test('a refused expense shows “Couldn’t send” and sign-out asks first', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const eatingOut = await seed(family);
    const context = page.context();
    const list = await context.newPage();
    await list.goto(`${family.origin}/transactions`);
    await expect(list.getByText('€64.20 spent').first()).toBeVisible();
    const home = await context.newPage();
    await home.goto(`${family.origin}/`);
    await expect(
      home.getByRole('heading', { name: 'Hi, Alena' }),
    ).toBeVisible();

    // Saved offline into an envelope that is archived before it is sent.
    await openAdd(page, family);
    await context.setOffline(true);
    await typeAmount(page, '28.90');
    await pickMerchant(page, 'Lieferando');
    await page
      .getByRole('radiogroup', { name: 'Envelope' })
      .getByRole('radio', { name: 'Eating out' })
      .click();
    await page.getByRole('button', { name: 'Save €28.90' }).click();
    await expect(
      page.getByRole('heading', { name: 'Expense saved on this phone' }),
    ).toBeVisible();
    const archived = await family.api.patch(
      `${family.origin}/api/envelopes/${eatingOut}`,
      { headers: { Origin: family.origin }, data: { archived: true } },
    );
    expect(archived.status()).toBe(200);
    await context.setOffline(false);
    const failed = list.getByRole('button', { name: /^Lieferando/ });
    await expect(failed).toContainText('Couldn’t send');

    // A second one waits while the phone is offline again.
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Add another' }).click();
    await typeAmount(page, '6.40');
    await pickMerchant(page, 'Bäckerei Müller');
    await page.getByRole('button', { name: 'Save €6.40' }).click();
    await expect(
      page.getByRole('heading', { name: 'Expense saved on this phone' }),
    ).toBeVisible();

    // Home's card under the tiles (UI-HOME-8).
    const card = home.getByRole('link', { name: /^Waiting to send · 2/ });
    await expect(card).toContainText(
      'One couldn’t be sent. Open it to see why.',
    );
    await expect(card).toContainText('Bäckerei Müller');
    await expect(card).toContainText('Lieferando');
    await screenshot(home, testInfo, 'HomeWaiting');

    // The list's sheet: the server's message, the hint, Delete and Keep it.
    await expect(
      list.getByRole('button', { name: /^Bäckerei Müller/ }),
    ).toContainText('Waiting to send');
    await screenshot(list, testInfo, 'TransactionsOutboxList');
    await failed.click();
    const sheet = list.getByRole('dialog', { name: 'Couldn’t send' });
    await expect(sheet.getByRole('alert')).toHaveText(
      'Choose an envelope that is not archived.',
    );
    await expect(sheet).toContainText('Expense · on this phone');
    await expect(sheet).toContainText('Amount€28.90');
    await expect(sheet).toContainText('Paid fromING Visa');
    await expect(sheet).toContainText('EnvelopeEating out');
    await expect(sheet).toContainText(/Typed inToday, \d\d:\d\d by Alena/);
    await expect(sheet).toContainText(
      'It won’t be sent again by itself. Delete it here and type it again with another account.',
    );
    await expect(sheet.getByRole('button', { name: 'Delete' })).toBeVisible();
    await screenshot(list, testInfo, 'TransactionsOutbox');
    await sheet.getByRole('button', { name: 'Keep it' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(failed).toBeVisible();

    // Online: the waiting one goes; the refused one stays until deleted.
    await context.setOffline(false);
    await expect(
      list.getByRole('link', { name: /^Bäckerei Müller/ }),
    ).toBeVisible();
    await expect(
      home.getByRole('link', { name: /^Waiting to send · 1/ }),
    ).toBeVisible();

    // Sign-out sends first, then asks about what is left.
    await home
      .getByRole('button', { name: 'Alena — switch profile or sign out' })
      .click();
    await home.getByRole('button', { name: 'Sign out', exact: true }).click();
    const question = home.getByRole('dialog', { name: 'Sign out?' });
    await expect(question).toContainText(
      '1 expense hasn’t been sent yet. Signing out deletes it from this phone.',
    );
    await screenshot(home, testInfo, 'SignOutUnsent');
    await question.getByRole('button', { name: 'Keep me signed in' }).click();
    await expect(question).toHaveCount(0);
    expect(await outboxRecords(home)).toBe(1);
    expect(await serverRows(family, 'Lieferando')).toHaveLength(0);

    await home.getByRole('button', { name: 'Sign out', exact: true }).click();
    await home
      .getByRole('dialog', { name: 'Sign out?' })
      .getByRole('button', { name: 'Sign out anyway' })
      .click();
    await expect(home).toHaveURL(/\/sign-in/);
    expect(await outboxRecords(home)).toBe(0);
    await expect(list.getByRole('button', { name: /^Lieferando/ })).toHaveCount(
      0,
    );
    await list.close();
    await home.close();
  });
});

test('Delete takes a refused expense off the phone', async ({ page }) => {
  await startFamily(page, async (family) => {
    const eatingOut = await seed(family);
    await openAdd(page, family);
    await page.context().setOffline(true);
    await typeAmount(page, '12');
    await page
      .getByRole('radiogroup', { name: 'Envelope' })
      .getByRole('radio', { name: 'Eating out' })
      .click();
    await page.getByRole('button', { name: 'Save €12.00' }).click();
    await expect(
      page.getByRole('heading', { name: 'Expense saved on this phone' }),
    ).toBeVisible();
    await family.api.patch(`${family.origin}/api/envelopes/${eatingOut}`, {
      headers: { Origin: family.origin },
      data: { archived: true },
    });
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.goto(`${family.origin}/transactions`);

    // With no merchant or category the row is named by its kind.
    const row = page.getByRole('button', { name: /^Expense/ });
    await expect(row).toContainText('Couldn’t send');
    await row.click();
    await page
      .getByRole('dialog', { name: 'Couldn’t send' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText(PHONE_NOTE)).toHaveCount(0);
    expect(await outboxRecords(page)).toBe(0);
  });
});
