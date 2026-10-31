import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';
import { expectNoSidewaysScroll } from './support/sideways-scroll.js';

/** Saves a plain screenshot of the iPhone run for the design comparison. */
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
  /** The three rows of the design: Spotify, Shell and no merchant. */
  waiting: { spotify: number; shell: number; bare: number };
}

/** A `YYYY-MM-DD` date some days before `today`. */
function daysBefore(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Alena and Max, three accounts, the starter categories and a Groceries
 * envelope that is Groceries' default. Earlier labelled expenses give the
 * suggestions: Spotify and Shell by merchant. Three expenses of the design
 * wait (Spotify, Shell and one without a merchant, which gets no
 * suggestion), and "Edeka" waits with a merchant that points to Groceries.
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
  for (const [name, owner, type] of [
    ['ING Visa', 1, 'bank'],
    ['DKB', 2, 'bank'],
    ['Cash €', 2, 'cash'],
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
  const patch = await family.api.patch(
    `${family.origin}/api/categories/${ids['category Groceries']}`,
    {
      headers: { Origin: family.origin },
      data: { defaultEnvelopeId: ids.Groceries },
    },
  );
  expect(patch.status()).toBe(200);

  // The labelled history is in an earlier month on any day, and inside the
  // 90 days suggestions use, so this month's list has one Spotify payment.
  const add = (data: Record<string, unknown>) =>
    create(family, '/api/transactions', {
      kind: 'expense',
      date: daysBefore(`${today.slice(0, 8)}01`, 10),
      ...data,
    });
  await add({
    accountId: ids['ING Visa'],
    amount: '1099',
    merchant: 'PayPal *Spotify',
    categoryId: ids['category Subscriptions'],
  });
  await add({
    accountId: ids.DKB,
    memberId: ids.Max,
    amount: '5000',
    merchant: 'Shell',
    categoryId: ids['category Transport'],
  });
  // Payer history on the account: it must not suggest for the bare row.
  await add({
    accountId: ids['Cash €'],
    memberId: ids.Max,
    amount: '300',
    categoryId: ids['category Eating out'],
  });
  await add({
    accountId: ids.DKB,
    memberId: ids.Max,
    amount: '2100',
    merchant: 'Edeka',
    categoryId: ids['category Groceries'],
    envelopeId: ids.Groceries,
  });
  const spotify = await add({
    date: today,
    accountId: ids['ING Visa'],
    amount: '1099',
    merchant: 'PayPal *Spotify',
  });
  const shell = await add({
    date: daysBefore(today, 3),
    accountId: ids.DKB,
    memberId: ids.Max,
    amount: '6840',
    merchant: 'Shell',
  });
  const bare = await add({
    date: daysBefore(today, 4),
    accountId: ids['Cash €'],
    memberId: ids.Max,
    amount: '450',
  });
  return { ids, waiting: { spotify, shell, bare } };
}

async function openTab(page: Page, family: Family): Promise<void> {
  await page.goto(`${family.origin}/transactions?tab=needs-category`);
  await expect(
    page.getByText(
      'These were saved without a category. Tap a suggestion, or tick several and apply all.',
    ),
  ).toBeVisible();
}

async function transaction(family: Family, id: number) {
  const response = await family.api.get(
    `${family.origin}/api/transactions/${id}`,
  );
  return (await response.json()) as {
    transaction: { categoryId: number | null; envelopeId: number | null };
    revisions: { changes: Record<string, unknown> }[];
  };
}

test('the tab lists what waits, with a suggestion where one is sure and Other…', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openTab(page, family);

    await expect(
      page.getByRole('tab', { name: 'Needs a category · 3' }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('tabpanel', { name: 'Needs a category · 3' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Select PayPal *Spotify' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('−€10.99')).toBeVisible();
    await expect(page.getByText('Today · ING Visa · Alena')).toBeVisible();
    await expect(page.getByText('No merchant')).toBeVisible();
    await expect(page.getByText('−€4.50')).toBeVisible();
    await expect(page.getByText(/ · Cash € · Max$/u)).toBeVisible();
    for (const category of ['Subscriptions', 'Transport']) {
      await expect(page.getByRole('button', { name: category })).toBeVisible();
    }
    // The row without a merchant has no chip, only Other….
    await expect(page.getByRole('button', { name: 'Eating out' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Other…' })).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Apply/u })).toHaveCount(0);
    await expectNoSidewaysScroll(page, 'Needs a category');
    await shoot(page, testInfo, 'ToLabel');
  });
});

test('an expense saved with only an amount has no suggestion, and Other… labels it', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { waiting, ids } = await seed(family);
    await openTab(page, family);

    // The row is ticked alone: nothing to apply, so the button is disabled.
    await page.getByRole('button', { name: 'Select No merchant' }).click();
    await expect(
      page.getByText('1 selected has no suggestion. Use Other… on it.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Apply suggestions', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Select No merchant' }).click();
    await expect(page.getByText(/no suggestion/u)).toHaveCount(0);

    await page.getByRole('button', { name: 'Other…' }).nth(2).click();
    await page
      .getByRole('dialog', { name: 'Category' })
      .getByRole('radio', { name: 'Health' })
      .click();
    await expect(page.getByText('No merchant → Health')).toBeVisible();
    expect(
      (await transaction(family, waiting.bare)).transaction.categoryId,
    ).toBe(ids['category Health']);
    await expect(
      page.getByRole('tab', { name: 'Needs a category · 2' }),
    ).toBeVisible();
  });
});

test('a row opens its transaction, and Back returns to the tab', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await openTab(page, family);

    await page.getByRole('link', { name: /PayPal \*Spotify/u }).click();
    await expect(page).toHaveURL(/\/transactions\/\d+$/u);
    await expect(page.getByRole('heading', { name: 'Expense' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Merchant/u }),
    ).toContainText('PayPal *Spotify');

    await page.getByRole('button', { name: 'Back to transactions' }).click();
    await expect(page).toHaveURL(/\/transactions\?tab=needs-category$/u);
    await expect(
      page.getByRole('tab', { name: /^Needs a category/u }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('button', { name: 'Select PayPal *Spotify' }),
    ).toBeVisible();

    // The tick and the chips stay buttons, outside the link.
    await page.getByRole('button', { name: 'Select PayPal *Spotify' }).click();
    await expect(page).toHaveURL(/\/transactions\?tab=needs-category$/u);
  });
});

test('a suggestion labels its row at once, and Undo brings it back', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { waiting } = await seed(family);
    await openTab(page, family);

    await page.getByRole('button', { name: 'Subscriptions' }).click();
    await expect(
      page.getByText('PayPal *Spotify → Subscriptions'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Select PayPal *Spotify' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('tab', { name: 'Needs a category · 2' }),
    ).toBeVisible();
    expect(
      (await transaction(family, waiting.spotify)).transaction,
    ).toMatchObject({ categoryId: expect.any(Number) });

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.getByRole('button', { name: 'Select PayPal *Spotify' }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Needs a category · 3' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    expect(
      (await transaction(family, waiting.spotify)).transaction.categoryId,
    ).toBeNull();
  });
});

test('ticked rows are labelled together and Undo brings all of them back', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { waiting } = await seed(family);
    await openTab(page, family);

    await page.getByRole('button', { name: 'Select PayPal *Spotify' }).click();
    await page.getByRole('button', { name: 'Select Shell' }).click();
    await page.getByRole('button', { name: 'Select No merchant' }).click();
    await expect(
      page.getByRole('button', { name: 'Select Shell' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // The row without a suggestion is ticked but not counted.
    const apply = page.getByRole('button', {
      name: 'Apply suggestions to 2 selected',
    });
    await expect(apply).toBeVisible();
    await expect(
      page.getByText('1 selected has no suggestion. Use Other… on it.'),
    ).toBeVisible();
    await shoot(page, testInfo, 'ToLabel-selected');

    await apply.click();
    await expect(page.getByText('2 expenses labelled')).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Needs a category · 1' }),
    ).toBeVisible();
    // The row without a suggestion stays, still ticked, and cannot apply.
    await expect(
      page.getByRole('button', { name: 'Select No merchant' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Apply suggestions', exact: true }),
    ).toBeDisabled();
    expect(
      (await transaction(family, waiting.bare)).transaction.categoryId,
    ).toBeNull();
    await shoot(page, testInfo, 'ToLabel-applied');

    await page.getByRole('button', { name: 'Undo' }).click();
    for (const name of ['PayPal *Spotify', 'Shell', 'No merchant']) {
      await expect(
        page.getByRole('button', { name: `Select ${name}` }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole('tab', { name: 'Needs a category · 3' }),
    ).toBeVisible();
    for (const id of Object.values(waiting)) {
      expect((await transaction(family, id)).transaction.categoryId).toBeNull();
    }
  });
});

test('Other… opens the category sheet and a pick labels the row', async ({
  page,
}, testInfo) => {
  await startFamily(page, async (family) => {
    const { waiting, ids } = await seed(family);
    await openTab(page, family);

    await page.getByRole('button', { name: 'Other…' }).nth(1).click();
    const sheet = page.getByRole('dialog', { name: 'Category' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Recent' })).toBeVisible();
    await expect(
      sheet.getByRole('heading', { name: 'All categories' }),
    ).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Recent' })).toHaveCSS(
      'text-transform',
      'uppercase',
    );
    await shoot(page, testInfo, 'SearchCategories');

    await sheet.getByRole('radio', { name: 'Health' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Shell → Health')).toBeVisible();
    expect(
      (await transaction(family, waiting.shell)).transaction.categoryId,
    ).toBe(ids['category Health']);
  });
});

test('labelling an expense with no envelope gives it the default one, and Undo takes both back', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    const edeka = await create(family, '/api/transactions', {
      kind: 'expense',
      accountId: ids.DKB,
      memberId: ids.Max,
      amount: '3250',
      merchant: 'Edeka',
    });
    await openTab(page, family);

    await page.getByRole('button', { name: 'Groceries' }).click();
    await expect(
      page.getByText('Edeka → Groceries · Groceries envelope added'),
    ).toBeVisible();
    const labelled = await transaction(family, edeka);
    expect(labelled.transaction).toMatchObject({
      categoryId: ids['category Groceries'],
      envelopeId: ids.Groceries,
    });
    // Labelling is a revision, like an edit (MEM-5).
    expect(labelled.revisions).toHaveLength(1);
    expect(labelled.revisions[0]!.changes).toMatchObject({
      categoryId: [null, ids['category Groceries']],
      envelopeId: [null, ids.Groceries],
    });

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.getByRole('button', { name: 'Select Edeka' }),
    ).toBeVisible();
    expect((await transaction(family, edeka)).transaction).toMatchObject({
      categoryId: null,
      envelopeId: null,
    });
  });
});

test('the All list reloads after labelling, and an empty tab says so', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/transactions`);
    await expect(page.getByTestId('transaction-row').first()).toBeVisible();
    await expect(page.getByText(/^No category · ING Visa/u)).toBeVisible();
    await page.getByRole('tab', { name: 'Needs a category · 3' }).click();
    for (const name of ['Subscriptions', 'Transport']) {
      await page.getByRole('button', { name }).click();
    }
    await expect(
      page.getByRole('tab', { name: 'Needs a category · 1' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Other…' }).click();
    await page
      .getByRole('dialog', { name: 'Category' })
      .getByRole('radio', { name: 'Eating out' })
      .last()
      .click();
    await expect(page.getByText('Everything is labelled')).toBeVisible();
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByTestId('transaction-row').first()).toBeVisible();
    await expect(page.getByText(/^No category · ING Visa/u)).toHaveCount(0);
    // The list is this month's: only today's Spotify payment is in it.
    await expect(page.getByText(/^Subscriptions · ING Visa/u)).toHaveCount(1);
  });
});

test('long names and the sheet do not scroll sideways', async ({ page }) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    await create(family, '/api/transactions', {
      kind: 'expense',
      accountId: ids['ING Visa'],
      amount: '123456789',
      merchant:
        'A very long merchant name that goes on and on and on and on and on',
    });
    await openTab(page, family);
    await expectNoSidewaysScroll(page, 'Needs a category, long merchant');
    await page.getByRole('button', { name: 'Other…' }).first().click();
    await page.waitForTimeout(600);
    await expectNoSidewaysScroll(page, 'Needs a category, category sheet');
  });
});

test('a failed next page keeps the rows and retries', async ({ page }) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    for (let i = 0; i < 50; i += 1) {
      await create(family, '/api/transactions', {
        kind: 'expense',
        accountId: ids['ING Visa'],
        amount: '100',
        merchant: `Bulk ${i}`,
        date: '2026-01-01',
      });
    }
    await create(family, '/api/rules', {
      pattern: 'bulk',
      categoryId: ids['category Transport'],
    });
    let failures = 1;
    await page.route(/needs-category\?cursor=/u, (route) =>
      failures-- > 0 ? route.abort('failed') : route.continue(),
    );
    await openTab(page, family);
    await page
      .getByRole('button', { name: 'Select Bulk 40', exact: true })
      .click();
    await page.getByTestId('transactions-list').evaluate((list) => {
      list.scrollTop = list.scrollHeight;
    });

    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(
      /Could not load more. Check your connection and try again./u,
    );
    // The rows and the apply bar stay on show beside the message.
    await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(
      50,
    );
    await expect(
      page.getByRole('button', { name: 'Apply suggestions to 1 selected' }),
    ).toBeVisible();

    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(
      53,
    );
  });
});

test('no "Everything is labelled" while the next page is still to come', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const { ids } = await seed(family);
    for (let i = 0; i < 51; i += 1) {
      await create(family, '/api/transactions', {
        kind: 'expense',
        accountId: ids['ING Visa'],
        amount: '100',
        merchant: `Bulk ${i}`,
        date: '2026-01-01',
      });
    }
    await create(family, '/api/rules', {
      pattern: 'bulk',
      categoryId: ids['category Transport'],
    });
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/needs-category\?cursor=/u, async (route) => {
      await held;
      await route.continue();
    });
    await openTab(page, family);
    const selects = page.getByRole('button', { name: /^Select / });
    await expect(selects).toHaveCount(50);
    for (let i = 0; i < 50; i += 1) await selects.nth(i).click();
    // The row without a merchant has no suggestion, so 49 are applied.
    await page
      .getByRole('button', { name: 'Apply suggestions to 49 selected' })
      .click();

    // Every suggested row is labelled; four more wait on the server.
    await expect(page.getByText('49 expenses labelled')).toBeVisible();
    await expect(page.getByText('Everything is labelled')).toHaveCount(0);
    release();
    await expect(selects).toHaveCount(5);
    await expect(page.getByText('Everything is labelled')).toHaveCount(0);
  });
});
