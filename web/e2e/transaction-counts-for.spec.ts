import { addMonths, type WishesResponse } from '@budget-buddy/shared';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * The transaction page's "Counts for" row and sheet (spec 3a task 43;
 * PLN-14, UI-TXN-10): an envelope, a wish of the month or neither, the
 * Record lines of each change, the wish's "counts as" in another currency
 * and the delete warning. Data is made through the API.
 */
const KEY_NAMES: Record<string, string> = { '.': 'Decimal point' };

async function typeAmount(scope: Locator, amount: string): Promise<void> {
  const keypad = scope.getByRole('group', { name: 'Amount keypad' });
  for (const key of amount) {
    await keypad
      .getByRole('button', { name: KEY_NAMES[key] ?? key, exact: true })
      .click();
  }
}

async function shoot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'iphone') return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

/** The row of the page, and the sheet it opens. */
const row = (page: Page) => page.getByRole('button', { name: /^Counts for/ });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Counts for' });

interface Seeded {
  rewe: number;
  wholeFoods: number;
  tyres: number;
  salzburg: number;
}

/**
 * Today: REWE (€64.20, ING Visa, Groceries envelope) and Whole Foods ($23.39
 * on Wise $, no envelope). Wishes of this month: Winter tyres and Weekend
 * in Salzburg, and Spring bike of next month, which the sheet must leave out.
 */
async function seed(family: Family): Promise<Seeded> {
  const wishes = (await (
    await family.api.get(`${family.origin}/api/wishes`)
  ).json()) as WishesResponse;
  const month = wishes.month;
  const settings = (await (
    await family.api.get(`${family.origin}/api/settings`)
  ).json()) as { timeZone: string };
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timeZone,
  }).format(new Date());
  const ing = await create(family, '/api/accounts', {
    name: 'ING Visa',
    type: 'bank',
    currency: 'EUR',
    ownerMemberId: 1,
    openingBalance: '100000',
  });
  const wise = await create(family, '/api/accounts', {
    name: 'Wise $',
    type: 'bank',
    currency: 'USD',
    ownerMemberId: 1,
    openingBalance: '100000',
  });
  const envelopeIds: Record<string, number> = {};
  for (const name of ['Groceries', 'Eating out']) {
    envelopeIds[name] = await create(family, '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount: '50000',
      mode: 'reset',
    });
  }
  const rewe = await create(family, '/api/transactions', {
    kind: 'expense',
    accountId: ing,
    amount: '6420',
    merchant: 'REWE',
    date: today,
    envelopeId: envelopeIds.Groceries,
  });
  const wholeFoods = await create(family, '/api/transactions', {
    kind: 'expense',
    accountId: wise,
    amount: '2339',
    merchant: 'Whole Foods',
    date: today,
  });
  const wish = (name: string, amount: string, at = month) =>
    create(family, '/api/wishes', {
      month: at,
      name,
      amount,
      currency: 'EUR',
    });
  const tyres = await wish('Winter tyres', '48000');
  const salzburg = await wish('Weekend in Salzburg', '35000');
  await wish('Spring bike', '20000', addMonths(month, 1));
  return { rewe, wholeFoods, tyres, salzburg };
}

/** Links an expense to a wish through the API. */
async function linkTo(
  family: Family,
  transactionId: number,
  wishId: number,
): Promise<void> {
  const response = await family.api.patch(
    `${family.origin}/api/transactions/${transactionId}`,
    { headers: { Origin: family.origin }, data: { wishId } },
  );
  expect(response.ok()).toBe(true);
}

test('an expense in an envelope shows it, and the sheet has the three groups', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const data = await seed(family);
    await page.goto(`${family.origin}/transactions/${data.rewe}`);
    await expect(row(page)).toContainText('Groceries envelope');
    await shoot(page, testInfo, 'TransactionInEnvelope');

    await row(page).click();
    await expect(
      sheet(page).getByText(/^Pick one: an envelope, one of \w+’s wishes, or/u),
    ).toBeVisible();
    await expect(sheet(page).getByRole('heading')).toContainText([
      'Counts for',
      'Envelopes',
      /^Wishes in \w+$/u,
      'Neither',
    ]);
    const groceries = sheet(page).getByRole('radio', { name: /^Groceries/ });
    await expect(groceries).toHaveAttribute('aria-checked', 'true');
    await expect(groceries).toContainText(
      /Resets monthly · −?€[\d,.]+ (left|overspent)/u,
    );
    await expect(
      sheet(page).getByRole('radio', { name: /^Winter tyres/ }),
    ).toContainText('€480.00 · nothing spent yet');
    await expect(
      sheet(page).getByRole('radio', { name: /^Unplanned/ }),
    ).toContainText('No envelope and no wish');
    // Only the wishes of the expense's month are offered (O4).
    await expect(
      sheet(page).getByRole('radio', { name: /^Spring bike/ }),
    ).toHaveCount(0);
    await shoot(page, testInfo, 'TransactionCountsFor');
  });
});

test('a wish takes the expense out of its envelope; Unplanned and an envelope undo it', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const data = await seed(family);
    await page.goto(`${family.origin}/transactions/${data.rewe}`);

    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Weekend in Salzburg/ })
      .click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(row(page)).toContainText('Weekend in Salzburg');
    await expect(row(page)).not.toContainText('envelope');
    await expect(
      page.getByText(
        'Moved from the Groceries envelope to the wish Weekend in Salzburg by Alena',
        { exact: true },
      ),
    ).toBeVisible();
    await shoot(page, testInfo, 'TransactionWish');

    // The wish is checked, shows what was spent, and opens.
    await row(page).click();
    const picked = sheet(page).getByRole('radio', {
      name: /^Weekend in Salzburg/,
    });
    await expect(picked).toHaveAttribute('aria-checked', 'true');
    await expect(picked).toContainText('€350.00 · €64.20 spent');
    await sheet(page)
      .getByRole('link', { name: 'Open Weekend in Salzburg' })
      .click();
    await expect(page).toHaveURL(/\/wishes\/\d+$/u);
    await page.goBack();
    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Winter tyres/ })
      .click();
    await expect(
      page.getByText(
        'Moved from the wish Weekend in Salzburg to the wish Winter tyres by Alena',
        { exact: true },
      ),
    ).toBeVisible();

    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Unplanned/ })
      .click();
    await expect(row(page)).toContainText('Unplanned');
    await expect(
      page.getByText('Link to Winter tyres removed by Alena', { exact: true }),
    ).toBeVisible();

    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Winter tyres/ })
      .click();
    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Groceries/ })
      .click();
    await expect(row(page)).toContainText('Groceries envelope');
    await expect(
      page.getByText('Linked to the wish Winter tyres by Alena', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Charged to Groceries; link to Winter tyres removed by', {
        exact: false,
      }),
    ).toBeVisible();
  });
});

test('a wish in another currency counts as a converted amount that can be typed', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const data = await seed(family);
    await page.goto(`${family.origin}/transactions/${data.wholeFoods}`);
    await expect(row(page)).toContainText('Unplanned');

    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Winter tyres/ })
      .click();
    // The sheet stays open for the keypad.
    await expect(sheet(page).getByText('Counts for the wish as')).toBeVisible();
    await expect(
      sheet(page).getByText(/At the rate of .+: \$1 = €[\d.]+\. Type what/u),
    ).toBeVisible();
    await shoot(page, testInfo, 'TransactionWishFx');
    await typeAmount(sheet(page), '21.40');
    await sheet(page)
      .getByRole('button', { name: 'Count it as €21.40' })
      .click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(row(page)).toContainText('Winter tyres · counts as €21.40');
    await expect(
      page.getByText('Counts for Winter tyres as €21.40 by Alena', {
        exact: true,
      }),
    ).toBeVisible();

    await row(page).click();
    await expect(sheet(page).getByText(/^Typed by hand\./u)).toBeVisible();
    await sheet(page)
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    // An envelope keeps "Counts in the envelope as".
    await row(page).click();
    await sheet(page)
      .getByRole('radio', { name: /^Groceries/ })
      .click();
    await expect(
      sheet(page).getByText('Counts in the envelope as').first(),
    ).toBeVisible();
    await sheet(page)
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(row(page)).toContainText(
      /Groceries envelope · counts as €\d/u,
    );
  });
});

test('deleting a linked expense says what it no longer counts for', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const data = await seed(family);
    await linkTo(family, data.rewe, data.tyres);
    await page.goto(`${family.origin}/transactions/${data.rewe}`);
    await expect(row(page)).toContainText('Winter tyres');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByText(
        'It no longer counts for Winter tyres. This can’t be undone.',
      ),
    ).toBeVisible();
  });
});

test('the Record names a deleted wish by its snapshot and reads a recorded link', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const data = await seed(family);
    await linkTo(family, data.rewe, data.tyres);
    // Recording a wish comes with another task; its revision is injected.
    await page.route(`**/api/transactions/${data.rewe}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        revisions: Record<string, unknown>[];
      };
      body.revisions.push({
        id: 9999,
        action: 'update',
        changedBy: 1,
        changedAt: Date.now(),
        changes: {
          link: [
            null,
            {
              kind: 'wish',
              wishId: data.salzburg,
              name: 'Weekend in Salzburg',
              madeHow: 'recorded',
            },
          ],
        },
      });
      await route.fulfill({ response, json: body });
    });
    const removed = await family.api.delete(
      `${family.origin}/api/wishes/${data.tyres}`,
      { headers: { Origin: family.origin }, data: {} },
    );
    expect(removed.status()).toBe(204);
    await page.goto(`${family.origin}/transactions/${data.rewe}`);
    await expect(
      page.getByText('Link to Winter tyres removed by Alena', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Recorded from the wish Weekend in Salzburg by Alena', {
        exact: true,
      }),
    ).toBeVisible();
  });
});
