import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { create, startFamily, type Family } from './support/family.js';

/**
 * Offline Home and the locked phone (spec 2 task 18; D1, D3, UI-HOME-7,
 * UI-AUTH-9): the limited Home from the options on the phone, the Add form
 * from the same options, the exception for a locked phone, and what sign-out
 * deletes. The service worker runs, as in the installed app.
 */
test.use({ serviceWorkers: 'allow' });

const password = 'correct horse battery staple';
const minute = 60_000;
const presencePath = '/api/session/presence';
const OFFLINE_NOTE = 'Offline. It stays on this phone and sends itself later.';
const INFO = 'Balances, envelopes and check-ins show when you’re back online';
const STRIP = 'You’re offline. Showing what was loaded last.';

const KEY_NAMES: Record<string, string> = { '.': 'Decimal point' };

async function typeAmount(page: Page, amount: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of amount) {
    await keypad
      .getByRole('button', { name: KEY_NAMES[key] ?? key, exact: true })
      .click();
  }
}

async function pickMerchant(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /^(Add merchant|Merchant: .*)$/ })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Merchant' });
  await sheet.getByLabel('Search or type a merchant').fill(name);
  await sheet.getByRole('button', { name: `Use “${name}”` }).click();
  await expect(sheet).toHaveCount(0);
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

/** Accounts, a Groceries envelope and a rule that sends REWE to it. */
async function seed(family: Family): Promise<void> {
  await create(family, '/api/accounts', {
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
  const groceries = await create(family, '/api/envelopes', {
    name: 'Groceries',
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
  });
  const response = await family.api.get(
    `${family.origin}/api/categories?kind=expense`,
  );
  const { categories } = (await response.json()) as {
    categories: { id: number; name: string }[];
  };
  const category = categories.find((entry) => entry.name === 'Groceries')!.id;
  await family.api.patch(`${family.origin}/api/categories/${category}`, {
    headers: { Origin: family.origin },
    data: { defaultEnvelopeId: groceries },
  });
  await create(family, '/api/rules', {
    pattern: 'REWE',
    categoryId: category,
    envelopeId: groceries,
  });
}

/** Records in a store of the page's device database. */
function records(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('budget-buddy');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const count = open.result
            .transaction(name, 'readonly')
            .objectStore(name)
            .count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
      }),
    store,
  );
}

/** Waits until Home has loaded and the page has stored the options. */
async function homeStored(page: Page): Promise<void> {
  await expect(
    page.getByRole('link', { name: /Family wealth/u }),
  ).toBeVisible();
  await expect.poll(() => records(page, 'addOptions')).toBe(1);
}

/** Waits until a worker controls the page and has saved the shell. */
async function waitForControl(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        return (
          navigator.serviceWorker.controller !== null &&
          (await caches.keys()).length > 0
        );
      }),
    )
    .toBe(true);
}

/**
 * Takes the server away and makes the browser report "offline" from the
 * next page load on (Playwright's own `setOffline` fails a navigation before
 * the worker can answer it in WebKit).
 */
async function goOffline(page: Page, family: Family): Promise<void> {
  await family.stop();
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
  });
}

async function setVisibility(
  page: Page,
  state: 'hidden' | 'visible',
): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => next,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => next === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** The app leaves the foreground, and its last word reaches the server. */
async function hide(page: Page): Promise<void> {
  const sent = page.waitForResponse(
    (response) => new URL(response.url()).pathname === presencePath,
  );
  await setVisibility(page, 'hidden');
  await sent;
}

/** Moves the session's last-foreground mark back, as time away does. */
function backdate(family: Family, ms: number): void {
  type Sqlite = {
    prepare(sql: string): { run(...values: unknown[]): unknown };
    close(): void;
  };
  const Database = createRequire(path.resolve('server/package.json'))(
    'better-sqlite3',
  ) as new (filePath: string) => Sqlite;
  const database = new Database(
    path.join(family.dataDirectory, 'budget-buddy.sqlite'),
  );
  database
    .prepare('UPDATE session SET foreground_at = foreground_at - ?')
    .run(ms);
  database.close();
}

async function serverRows(family: Family, merchant: string) {
  const response = await family.api.get(
    `${family.origin}/api/transactions?period=all&q=${encodeURIComponent(merchant)}`,
  );
  const body = (await response.json()) as {
    transactions: { merchant: string | null }[];
  };
  return body.transactions.filter((row) => row.merchant === merchant);
}

/** What a member sees on the limited Home, and nothing else. */
async function expectLimitedHome(page: Page, locked: boolean): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  const tiles = page.getByRole('navigation', { name: 'Quick actions' });
  await expect(tiles.getByRole('link')).toHaveText(['Income', 'Transfer']);
  await expect(
    page.getByText(`${INFO}${locked ? ' and signed in' : ''}.`),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Add expense/ })).toBeVisible();
  // No eye, no avatar, no other card, and no strip above it.
  await expect(page.getByRole('button', { name: /amounts/u })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /switch profile or sign out/u }),
  ).toHaveCount(0);
  for (const name of [/Family wealth/u, /Everything/u, /Check-in/u]) {
    await expect(page.getByText(name)).toHaveCount(0);
  }
  await expect(page.getByText(STRIP)).toHaveCount(0);
}

test('signed in, a reload offline shows the limited Home from the stored options', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/`);
    await homeStored(page);
    // An item that waits on the phone shows on the card, without an amount.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('budget-buddy');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const transaction = open.result.transaction('outbox', 'readwrite');
            transaction.objectStore('outbox').put({
              clientId: 'e2e-waiting',
              body: {
                clientId: 'e2e-waiting',
                enteredAt: Date.now(),
                kind: 'expense',
                date: new Date().toISOString().slice(0, 10),
                accountId: 1,
                amount: '1240',
                merchant: 'REWE',
              },
              profileId: 1,
              profileName: 'Alena',
              enteredAt: Date.now(),
              names: {
                account: 'ING Visa',
                currency: 'EUR',
                toAccount: null,
                toCurrency: null,
                category: 'Groceries',
                envelope: 'Groceries',
                member: 'Alena',
              },
              state: 'waiting',
              error: null,
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
          };
        }),
    );
    await waitForControl(page);

    await goOffline(page, family);
    await page.reload();
    await expectLimitedHome(page, false);
    const card = page.getByRole('region', { name: 'Waiting to send · 1' });
    await expect(card).toContainText('They send themselves');
    await expect(card).toContainText('REWE');
    await expect(card).toContainText(/Expense · today, \d\d:\d\d/u);
    await expect(card).toContainText('On this phone');
    await expect(card).not.toContainText('12.40');
    await screenshot(page, testInfo, 'HomeOffline');
  });
});

test('signed out, an offline reload shows the sign-in screen, not the limited Home', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/`);
    await homeStored(page);
    await page
      .getByRole('button', { name: 'Alena — switch profile or sign out' })
      .click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    expect(await records(page, 'addOptions')).toBe(0);
    await waitForControl(page);

    await goOffline(page, family);
    await page.reload();
    await expect(
      page.getByRole('textbox', { name: 'Family password' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toHaveCount(
      0,
    );
  });
});

test('a locked phone offline shows the limited Home, takes an expense, and sends it when back', async ({
  page,
  context,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.clock.install();
    await page.goto(`${family.origin}/`);
    await homeStored(page);
    // The Add form's code is loaded while online: Playwright's offline mode
    // also blocks what the worker has saved, which a phone does not.
    await page.getByRole('link', { name: /Add expense/ }).click();
    await expect(
      page.getByRole('button', { name: 'Enter an amount' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Close' }).first().click();
    await homeStored(page);
    await page.getByRole('link', { name: 'Accounts' }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByText('Loading accounts…')).toHaveCount(0);

    // More than five minutes away without a connection: the page locks.
    await hide(page);
    await context.setOffline(true);
    await page.clock.fastForward(7 * minute);
    await setVisibility(page, 'visible');
    await expect(page).toHaveURL(`${family.origin}/`);
    await expectLimitedHome(page, true);
    await expect(
      page.getByRole('region', { name: /Waiting to send/u }),
    ).toHaveCount(0);
    await screenshot(page, testInfo, 'HomeOfflineLocked');

    // A notification tap lands on the same Home.
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'navigate', url: '/check-ins' },
        }),
      );
    });
    await expect(page).toHaveURL(`${family.origin}/`);
    await expectLimitedHome(page, true);

    // The Add form works from the stored accounts, categories and rules.
    await page.getByRole('link', { name: /Add expense/ }).click();
    await expect(page).toHaveURL(`${family.origin}/add`);
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
    await expect(
      page.getByRole('radio', { name: 'ING Visa', checked: true }),
    ).toBeVisible();
    await typeAmount(page, '12.40');
    await pickMerchant(page, 'REWE');
    await expect(page.getByText('Category · from REWE rule')).toBeVisible();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Groceries' }),
    ).toBeChecked();
    // The form fits the phone with the offline note.
    const save = page.getByRole('button', { name: 'Save €12.40' });
    const box = await save.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    expect(
      await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return main.scrollHeight - main.clientHeight;
      }),
    ).toBeLessThanOrEqual(0);
    await screenshot(page, testInfo, 'AddOffline');
    await save.click();
    await expect(
      page.getByRole('heading', { name: 'Expense saved on this phone' }),
    ).toBeVisible();
    expect(await records(page, 'outbox')).toBe(1);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(`${family.origin}/`);
    const card = page.getByRole('region', { name: 'Waiting to send · 1' });
    await expect(card).toContainText('REWE');
    await screenshot(page, testInfo, 'HomeOfflineLockedWaiting');

    // Back online: the server still counts the session as away, yet takes
    // the expense once (D2), and the phone goes to sign-in.
    backdate(family, 7 * minute);
    await context.setOffline(false);
    await expect(page).toHaveURL(`${family.origin}/sign-in?next=/accounts`);
    await expect.poll(() => records(page, 'outbox')).toBe(0);
    await page.getByRole('textbox', { name: 'Family password' }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${family.origin}/accounts`);
    expect(await serverRows(family, 'REWE')).toHaveLength(1);
  });
});

test.describe('without the worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('a locked page offline leaves no data on screen when Home’s code is missing', async ({
    page,
    context,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      await homeStored(page);

      // A new load that never gets Home's code, as a worker still filling its
      // cache would leave it, opens on Accounts.
      await context.route('**/assets/HomeScreen-*', (route) => route.abort());
      await page.clock.install();
      await page.goto(`${family.origin}/accounts`);
      await expect(
        page.getByRole('heading', { name: 'Accounts' }),
      ).toBeVisible();
      await expect(page.getByText('Loading accounts…')).toHaveCount(0);

      await hide(page);
      await context.setOffline(true);
      await page.clock.fastForward(7 * minute);
      await setVisibility(page, 'visible');
      await expect(page.getByRole('heading', { name: 'Accounts' })).toHaveCount(
        0,
      );
      await expect(page.getByText('ING Visa')).toHaveCount(0);
    });
  });
});
