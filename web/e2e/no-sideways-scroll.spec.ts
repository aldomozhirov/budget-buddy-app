import { expect, test, type Page } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';
import { expectNoSidewaysScroll } from './support/sideways-scroll.js';

/** 52 characters: the longest a name may be is 60, with an index added. */
const LONG = 'A very long name that keeps going on and on and on..';

/** Lets a sheet or screen finish its entrance before it is measured. */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

/** Envelopes, accounts, a category and a rule, all with long names. */
async function seed(family: Family): Promise<void> {
  for (const [index, currency] of ['EUR', 'USD', 'GBP', 'EUR'].entries()) {
    await create(family, '/api/accounts', {
      name: `${LONG} ${index}`,
      ownerMemberId: 1,
      type: 'bank',
      currency,
      openingBalance: '100000',
    });
    await create(family, '/api/envelopes', {
      name: `${LONG} ${index}`,
      currency,
      monthlyAmount: '50000',
      mode: index % 2 ? 'carry_over' : 'reset',
      startingBalance: '18760',
    });
  }
  const category = await create(family, '/api/categories', {
    name: LONG,
    kind: 'expense',
  });
  await create(family, '/api/rules', {
    pattern: `${LONG}, ${LONG}`,
    categoryId: category,
  });
}

test('envelope screens, the new envelope page and sheets do not scroll sideways', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);

    await page.goto(`${family.origin}/envelopes`);
    await page.getByRole('link', { name: /Archived envelopes/ }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Envelopes');

    await page.getByRole('link', { name: 'New envelope' }).click();
    const fresh = page.getByRole('main');
    await fresh.getByLabel('Name', { exact: true }).fill(LONG);
    await settled(page);
    await expectNoSidewaysScroll(page, 'New envelope');
    await fresh.getByRole('button', { name: 'Other currency or coin' }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Currency picker');
    await page
      .getByRole('dialog', { name: 'Currency or coin' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await fresh.getByRole('button', { name: 'All categories' }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Category picker');
    await page
      .getByRole('dialog', { name: 'Category' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await fresh.getByRole('button', { name: 'Back to envelopes' }).click();

    await page.getByRole('button', { name: 'Move money' }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Move money');
    await page
      .getByRole('dialog', { name: 'Move money' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.getByRole('button', { name: 'History' }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'History picker');
    await page
      .getByRole('dialog', { name: 'History' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.getByRole('link', { name: /Archived envelopes/ }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Archived envelopes');
  });
});

test('the envelope page, the edit page, its sheets and Categories do not scroll sideways', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);

    await page.goto(`${family.origin}/envelopes`);
    await page
      .getByRole('link', { name: new RegExp(LONG) })
      .first()
      .click();
    await page.getByRole('link', { name: 'Edit envelope' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Envelope page');

    await page.getByRole('button', { name: 'Adjust' }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Adjust balance');
    await page
      .getByRole('dialog', { name: 'Adjust balance' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.getByRole('link', { name: 'Edit envelope' }).click();
    const edit = page.getByRole('main');
    await edit.getByLabel('Name', { exact: true }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Edit envelope');
    await edit.getByRole('button', { name: 'Back to envelope' }).click();

    await page.goto(`${family.origin}/categories`);
    await page.getByRole('button', { name: 'New category' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Categories');
    await page.getByRole('button', { name: 'New category' }).click();
    const category = page.getByRole('dialog', { name: 'New category' });
    await category.getByLabel('Name', { exact: true }).fill(LONG);
    await settled(page);
    await expectNoSidewaysScroll(page, 'New category');
    await category.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('list', { name: 'expense categories' })
      .getByRole('button', { name: new RegExp(LONG) })
      .click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Edit category');
    await page
      .getByRole('dialog', { name: 'Edit category' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.goto(`${family.origin}/categories?tab=rules`);
    await page.getByRole('button', { name: 'New rule' }).click();
    const rule = page.getByRole('dialog', { name: 'New rule' });
    await rule.getByLabel('Merchant contains').fill(`${LONG}, ${LONG}`);
    await settled(page);
    await expectNoSidewaysScroll(page, 'New rule');
    for (const [button, dialog] of [
      ['All categories', 'Category'],
      ['All envelopes', 'Envelope'],
      ['All accounts', 'Only for account'],
    ] as const) {
      await rule.getByRole('button', { name: button }).click();
      await settled(page);
      await expectNoSidewaysScroll(page, `${dialog} picker`);
      await page
        .getByRole('dialog', { name: dialog })
        .getByRole('button', { name: 'Close', exact: true })
        .click();
    }
    await rule.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(LONG) }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Edit rule');
  });
});

/**
 * Opens a sheet with `open`, measures it, then closes it with Escape (the
 * top sheet only), so the next sheet starts from the same screen.
 */
async function checkSheet(
  page: Page,
  name: string | RegExp,
  open: () => Promise<unknown>,
): Promise<void> {
  await open();
  await expect(page.getByRole('dialog', { name }).last()).toBeVisible();
  await settled(page);
  await expectNoSidewaysScroll(page, String(name));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name })).toHaveCount(0);
}

test('Home, Settings and their sheets do not scroll sideways', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(family.origin);
    await page.getByRole('heading', { name: 'Hi, Alena' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Home');
    await checkSheet(page, 'Who’s using the app?', () =>
      page
        .getByRole('button', { name: 'Alena — switch profile or sign out' })
        .click(),
    );

    await page.goto(`${family.origin}/settings`);
    await page.getByRole('button', { name: /^Backup/ }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Settings');
    const rows: Array<[string, RegExp | string]> = [
      ['Backup', /^Backup/],
      ['Check-in schedule', /^Schedule/],
      ['Follow-up reminders', /^Follow-up reminders/],
      ['Common currency', /^Common currency/],
      ['Currencies and coins', /^Currencies and coins/],
      ['Exchange rates', /^Exchange rates/],
      ['Time zone', /^Time zone/],
      ['Change family password', 'Family password'],
      ['Edit profile', 'Alena'],
      ['Add profile', 'Add profile'],
    ];
    for (const [title, row] of rows) {
      await checkSheet(page, title, () =>
        page.getByRole('button', { name: row }).first().click(),
      );
    }
    await page.getByRole('button', { name: /^Currencies and coins/ }).click();
    await checkSheet(page, 'Add coin', () =>
      page.getByRole('button', { name: 'Add coin' }).click(),
    );
    await page.keyboard.press('Escape');
  });
});

test('accounts, check-ins and their sheets do not scroll sideways', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await seed(family);

    await page.goto(`${family.origin}/accounts`);
    await page.getByRole('link', { name: 'New account' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Accounts');
    for (const name of ['Type', 'Currency']) {
      await checkSheet(page, name, () =>
        page.getByRole('button', { name, exact: true }).click(),
      );
    }

    await page.goto(`${family.origin}/accounts/new`);
    await page
      .getByRole('button', { name: 'Opening balance', exact: true })
      .waitFor();
    await page.getByLabel('Name', { exact: true }).fill(LONG);
    await settled(page);
    await expectNoSidewaysScroll(page, 'New account');
    for (const name of [
      'Other currency or coin',
      'Opening balance',
      'Opening balance date',
    ]) {
      await checkSheet(
        page,
        name === 'Other currency or coin' ? 'Currency or coin' : name,
        () => page.getByRole('button', { name, exact: true }).click(),
      );
    }

    await page.goto(`${family.origin}/accounts`);
    await page
      .getByRole('link', { name: new RegExp(LONG) })
      .first()
      .click();
    await page.getByRole('button', { name: 'Set balance' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Account page');
    await checkSheet(page, 'Set balance', () =>
      page.getByRole('button', { name: 'Set balance' }).click(),
    );
    await page.getByRole('button', { name: 'Set balance' }).click();
    await checkSheet(page, 'Balance date', () =>
      page.getByRole('button', { name: /Today · Change date/ }).click(),
    );
    await page.keyboard.press('Escape');
    await checkSheet(page, 'Correct balance', () =>
      page.getByRole('button', { name: /Opening · / }).click(),
    );
    await checkSheet(page, 'Account settings', () =>
      page.getByRole('button', { name: 'Account settings' }).click(),
    );
    await checkSheet(page, 'Deactivate account?', async () => {
      await page.getByRole('button', { name: 'Account settings' }).click();
      await page.getByRole('button', { name: 'Deactivate account' }).click();
    });
    // Closing a confirmation goes back to the settings sheet.
    await expect(
      page.getByRole('dialog', { name: 'Account settings' }),
    ).toBeVisible();
    await checkSheet(page, 'Relabel as USD?', async () => {
      await page.getByLabel('Currency', { exact: true }).selectOption('USD');
      await page.getByRole('button', { name: 'Change currency' }).click();
    });
    await page.keyboard.press('Escape');

    // Only an account without balance history can be deleted.
    await page.route('**/api/accounts/*/snapshots', (route) =>
      route.fulfill({ json: { snapshots: [] } }),
    );
    await page.reload();
    await checkSheet(page, 'Delete account?', async () => {
      await page.getByRole('button', { name: 'Account settings' }).click();
      await page.getByRole('button', { name: 'Delete account' }).click();
    });

    await page.goto(`${family.origin}/check-ins`);
    await page.getByRole('heading', { name: 'Check-ins' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Check-ins');
    const opened = await family.api.post(`${family.origin}/api/checkins`, {
      headers: { Origin: family.origin },
      data: {},
    });
    expect(opened.status()).toBe(201);
    await page.goto(`${family.origin}/check-in`);
    await page.getByRole('heading', { name: 'Check-in' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Check-in');
    await checkSheet(page, /^New balance for /, () =>
      page
        .getByRole('button', { name: /^Enter new balance for / })
        .first()
        .click(),
    );
    await page.getByRole('button', { name: 'Close now' }).click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Close the check-in now?');
    await page
      .getByRole('dialog', { name: 'Close the check-in now?' })
      .getByRole('button', { name: 'Close check-in' })
      .click();
    await page.getByRole('heading', { name: 'Check-in complete' }).waitFor();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Check-in complete');
    await page.goto(`${family.origin}/check-ins`);
    await page.getByRole('link').filter({ hasText: /\d{4}/ }).first().click();
    await settled(page);
    await expectNoSidewaysScroll(page, 'Check-in summary');
  });
});
