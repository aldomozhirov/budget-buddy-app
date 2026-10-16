import { expect, test, type Page } from '@playwright/test';

function category(id: number, name: string, usedThisYear: number) {
  return {
    id,
    name,
    kind: 'expense',
    defaultEnvelopeId: null,
    position: id,
    archived: false,
    archivedAt: null,
    usedThisYear,
    used: usedThisYear > 0,
    ruleCount: 0,
    createdBy: null,
    createdAt: 1,
    updatedBy: null,
    updatedAt: 1,
  };
}

function month(overrides: Record<string, unknown> = {}) {
  return {
    month: '2026-10',
    opening: '0',
    topUp: '0',
    topUpMode: null,
    dropped: null,
    adjustments: '0',
    spent: '0',
    available: '50000',
    closing: '50000',
    result: '0',
    closed: false,
    withinBudget: null,
    incomplete: false,
    closingIncomplete: false,
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Groceries',
    currency: 'EUR',
    startingBalance: '50000',
    startingMonth: '2026-10',
    defaultCategoryId: null,
    position: 1,
    archived: false,
    archivedAt: null,
    plan: { fromMonth: '2026-10', monthlyAmount: '50000', mode: 'reset' },
    pendingPlan: null,
    current: month(),
    overspent: false,
    used: false,
    expenseCount: 0,
    monthExpenseCount: 0,
    createdBy: 1,
    createdAt: 1,
    updatedBy: 1,
    updatedAt: 1,
    ...overrides,
  };
}

type Write = { method: string; url: string; body: unknown };

/**
 * Answers the form page's reads (and the sign-in checks of the shell) and
 * records the writes it makes. `current` is the envelope the edit page reads.
 */
async function mockApi(page: Page, writes: Write[], current = envelope()) {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      // The shell reports presence on its own; it is not the form's write.
      if (url.pathname === '/api/session/presence') {
        return route.fulfill({ status: 204 });
      }
      if (request.method() !== 'GET') {
        writes.push({
          method: request.method(),
          url: url.pathname,
          body: request.postDataJSON(),
        });
        const body = request.postDataJSON() as { archived?: boolean } | null;
        if (request.method() === 'DELETE') {
          return route.fulfill({ json: { deleted: true } });
        }
        return route.fulfill({
          json: {
            envelope: envelope({
              id: request.method() === 'POST' ? 9 : current.id,
              archived: body?.archived === true,
              used: true,
            }),
          },
        });
      }
      switch (url.pathname) {
        case `/api/envelopes/${String(current.id)}`:
          return route.fulfill({
            json: {
              envelope: current,
              month: month(),
              expenses: [],
              adjustments: [],
            },
          });
        case '/api/currencies':
          return route.fulfill({
            json: {
              currencies: [
                {
                  code: 'EUR',
                  name: 'Euro',
                  decimals: 2,
                  kind: 'fiat',
                  symbol: '€',
                },
                {
                  code: 'USD',
                  name: 'US dollar',
                  decimals: 2,
                  kind: 'fiat',
                  symbol: '$',
                },
              ],
              coins: [],
            },
          });
        case '/api/settings':
          return route.fulfill({
            json: {
              commonCurrency: 'EUR',
              timeZone: 'Europe/Berlin',
              cadence: { kind: 'off' },
              nextSlot: null,
              followupDays: 0,
            },
          });
        case '/api/accounts':
          return route.fulfill({ json: { accounts: [] } });
        case '/api/categories':
          return route.fulfill({
            json: {
              categories: [
                category(1, 'Groceries', 40),
                category(2, 'Eating out', 12),
                category(3, 'Health', 3),
                category(4, 'Gifts', 0),
                category(5, 'Travel', 0),
              ],
            },
          });
        default:
          return route.fulfill({
            status: 404,
            json: { error: { message: 'No' } },
          });
      }
    },
  );
  // Routes added later win, so these come after the catch-all above.
  await page.route('**/api/setup', (route) =>
    route.fulfill({ json: { needed: false } }),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        member: { id: 1, name: 'Alex' },
        profiles: [{ id: 1, name: 'Alex' }],
        device: { defaultMemberId: 1, hasPasskey: false },
      },
    }),
  );
}

test('an unused envelope can be deleted after a confirmation', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/7/edit');
  const form = page.getByRole('main');
  await expect(
    page.getByRole('heading', { name: 'Edit envelope' }),
  ).toBeVisible();
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(
    'Groceries',
  );
  await expect(form.getByText('Unused, so it can be deleted.')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  // The currency chips stay open while nothing uses the envelope.
  await expect(form.getByRole('radio', { name: 'EUR' })).toBeEnabled();
  await expect(
    form.getByText('The currency stays: it has expenses.'),
  ).toHaveCount(0);

  await form.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete Groceries?' });
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await expect(confirm).toBeHidden();
  expect(writes).toEqual([]);

  await form.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete Groceries?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(/\/envelopes$/);
  expect(writes).toEqual([
    { method: 'DELETE', url: '/api/envelopes/7', body: {} },
  ]);
});

test('a used envelope can only be archived and keeps its currency', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(
    page,
    writes,
    envelope({ used: true, expenseCount: 6, monthExpenseCount: 6 }),
  );
  await page.goto('/envelopes/7/edit');
  const form = page.getByRole('main');
  await expect(
    form.getByText(
      'It has 6 expenses, so it can only be archived. They keep this envelope.',
    ),
  ).toBeVisible();
  await expect(form.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  for (const chip of await form
    .getByRole('radiogroup', { name: 'Currency or coin' })
    .getByRole('radio')
    .all()) {
    await expect(chip).toBeDisabled();
  }
  await expect(
    form.getByRole('button', { name: 'Other currency or coin' }),
  ).toBeDisabled();
  await expect(
    form.getByText('The currency stays: it has expenses.'),
  ).toBeVisible();

  await form.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/envelopes$/);
  expect(writes).toEqual([
    { method: 'PATCH', url: '/api/envelopes/7', body: { archived: true } },
  ]);
});

test('editing the amount or mode says when it applies and saves only what changed', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/7/edit');
  const form = page.getByRole('main');
  await expect(form.getByText(/^Applies from the top-up/)).toHaveCount(0);
  await form.getByRole('radio', { name: 'Carries over' }).click();
  await expect(
    form.getByText('Applies from the top-up on 1 November.'),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Monthly amount' }).click();
  for (const key of ['Clear', '4', '5', '0']) {
    await form.getByRole('button', { name: key, exact: true }).click();
  }
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/envelopes\/7$/);
  expect(writes).toEqual([
    {
      method: 'PATCH',
      url: '/api/envelopes/7',
      body: { monthlyAmount: '45000', mode: 'carry_over' },
    },
  ]);
});

test('the default category row has None, three chips and All…, and a pick goes first', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/new');
  const form = page.getByRole('main');
  const row = form.getByRole('radiogroup', { name: 'Default category' });
  await expect(row.getByRole('radio')).toHaveText([
    'None',
    'Groceries',
    'Eating out',
    'Health',
  ]);
  await form.getByRole('button', { name: 'All categories' }).click();
  const picker = page.getByRole('dialog', { name: 'Category' });
  await expect(picker.getByRole('heading', { name: 'Most used' })).toHaveCSS(
    'text-transform',
    'uppercase',
  );
  await expect(
    picker.getByRole('heading', { name: 'All categories' }),
  ).toBeVisible();
  await picker.getByRole('radio', { name: 'Travel' }).click();
  await expect(row.getByRole('radio')).toHaveText([
    'None',
    'Travel',
    'Groceries',
    'Eating out',
  ]);
  await expect(row.getByRole('radio', { name: 'Travel' })).toBeChecked();
});

test('only the starting balance accepts a minus; an unfinished sum does not block Save', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/new');
  const form = page.getByRole('main');
  await form.getByLabel('Name', { exact: true }).fill('Groceries');
  await form.getByRole('button', { name: 'Monthly amount' }).click();
  await expect(form.getByRole('button', { name: 'Minus' })).toBeDisabled();
  await form
    .getByRole('button', { name: 'Starting balance · what’s in it now' })
    .click();
  await expect(form.getByRole('button', { name: 'Minus' })).toBeEnabled();

  // An unfinished sum on Monthly amount, then the keypad goes away.
  await form.getByRole('button', { name: 'Monthly amount' }).click();
  for (const key of ['5', '0', 'Plus']) {
    await form.getByRole('button', { name: key, exact: true }).click();
  }
  await expect(
    form.getByRole('button', { name: 'Add envelope' }),
  ).toBeDisabled();
  await form.getByLabel('Name', { exact: true }).focus();
  await expect(form.getByRole('button', { name: 'Minus' })).toHaveCount(0);
  await expect(
    form.getByRole('button', { name: 'Add envelope' }),
  ).toBeEnabled();
});

test('Back from the new envelope page goes to Envelopes, saving nothing', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/new');
  await expect(
    page.getByRole('heading', { name: 'New envelope' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to envelopes' }).click();
  await expect(page).toHaveURL(/\/envelopes$/);
  expect(writes).toEqual([]);
});

test('Back from the edit envelope page goes to the envelope, saving nothing', async ({
  page,
}) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/7/edit');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Groceries',
  );
  await page.getByRole('button', { name: 'Back to envelope' }).click();
  await expect(page).toHaveURL(/\/envelopes\/7$/);
  expect(writes).toEqual([]);
});

test('saving a new envelope opens its page', async ({ page }) => {
  const writes: Write[] = [];
  await mockApi(page, writes);
  await page.goto('/envelopes/new');
  await page.getByLabel('Name', { exact: true }).fill('Holiday');
  await page.getByRole('button', { name: 'Add envelope' }).click();
  await expect(page).toHaveURL(/\/envelopes\/9$/);
  expect(writes).toEqual([
    {
      method: 'POST',
      url: '/api/envelopes',
      body: {
        name: 'Holiday',
        currency: 'EUR',
        monthlyAmount: '0',
        mode: 'reset',
        startingBalance: '0',
      },
    },
  ]);
});
