import { addMonths, type WishesResponse } from '@budget-buddy/shared';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * Wishes and Home's Wishes row (spec 3a task 39; UI-WSH-1, UI-WSH-2,
 * UI-WSH-7, UI-HOME-9). Wishes are seeded through the API. Expenses cannot
 * be linked to a wish yet, so the figures of "spent" come from a changed
 * answer of `GET /api/wishes`.
 */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const FOOTNOTE =
  'Wishes don’t move to the next month by themselves. Move an open one from its page.';
const listRoute = /\/api\/wishes(\?.*)?$/u;

/** `2026-11` as "November 2026". */
function withYear(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** `2026-11` as "November". */
function nameOf(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1]!;
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

async function api<T>(family: Family, route: string): Promise<T> {
  const response = await family.api.get(`${family.origin}${route}`);
  expect(response.status(), route).toBe(200);
  return (await response.json()) as T;
}

/** The family's current month, as the server counts it. */
async function currentMonth(family: Family): Promise<string> {
  return (await api<WishesResponse>(family, '/api/wishes')).month;
}

/** An account, so Home has something to show; and the category ids. */
async function seedBase(family: Family): Promise<Record<string, number>> {
  await create(family, '/api/accounts', {
    name: 'ING Visa',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '100000',
  });
  const { categories } = await api<{
    categories: { id: number; name: string }[];
  }>(family, '/api/categories?kind=expense');
  return Object.fromEntries(categories.map((entry) => [entry.name, entry.id]));
}

interface WishSeed {
  month: string;
  name: string;
  amount: string;
  currency?: string;
  expression?: string;
  categoryId?: number;
}

/** Creates a wish and returns its id. */
function wish(family: Family, seed: WishSeed): Promise<number> {
  return create(family, '/api/wishes', {
    currency: 'EUR',
    categoryId: null,
    ...seed,
  });
}

/** Moves a wish to done or dropped. */
async function setState(
  family: Family,
  id: number,
  state: 'done' | 'dropped',
): Promise<void> {
  const response = await family.api.patch(`${family.origin}/api/wishes/${id}`, {
    headers: { Origin: family.origin },
    data: { state },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Changes the answer of the Wishes list, as expenses on wishes would. */
async function reshape(
  page: Page,
  change: (answer: WishesResponse) => WishesResponse,
): Promise<void> {
  await page.route(listRoute, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: change((await response.json()) as WishesResponse),
    });
  });
}

/** The card of an open wish. */
function card(page: Page, name: string) {
  return page.getByRole('link', { name: new RegExp(`^${name}`, 'u') });
}

/** Home's Wishes row. */
function homeRow(page: Page) {
  return page.getByRole('link', { name: /^Wishes/u });
}

test.describe('Home’s Wishes row', () => {
  test('reads “2 open this month”, opens Wishes on this month, and Back returns', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      await create(family, '/api/envelopes', {
        name: 'Groceries',
        currency: 'EUR',
        monthlyAmount: '50000',
        mode: 'reset',
      });
      const month = await currentMonth(family);
      await wish(family, { month, name: 'Winter tyres', amount: '48000' });
      await wish(family, { month, name: 'Weekend away', amount: '35000' });
      const finished = await wish(family, {
        month,
        name: 'Sofia’s birthday',
        amount: '15000',
      });
      await setState(family, finished, 'done');
      // A wish of another month is not counted.
      await wish(family, {
        month: addMonths(month, 1),
        name: 'Next month’s wish',
        amount: '10000',
      });

      await page.goto(`${family.origin}/`);
      const row = homeRow(page);
      await expect(row).toContainText('2 open this month');
      await expect(row).toHaveAttribute('href', '/wishes');
      await screenshot(page, testInfo, 'HomeWishes');

      await row.click();
      await expect(page).toHaveURL(`${family.origin}/wishes`);
      await expect(page.getByRole('heading', { name: 'Wishes' })).toBeVisible();
      await expect(page.getByText(withYear(month))).toBeVisible();
      await expect(page.getByText('This month', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Back to home' }).click();
      await expect(page).toHaveURL(`${family.origin}/`);
      await expect(homeRow(page)).toContainText('2 open this month');
    });
  });

  test('reads “No wishes this month” with none open, and still opens Wishes', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      // Only a done wish, and one next month: nothing is open this month.
      const finished = await wish(family, {
        month,
        name: 'Sofia’s birthday',
        amount: '15000',
      });
      await setState(family, finished, 'done');
      await wish(family, {
        month: addMonths(month, 1),
        name: 'Next month’s wish',
        amount: '10000',
      });

      await page.goto(`${family.origin}/`);
      await expect(homeRow(page)).toContainText('No wishes this month');
      await expect(homeRow(page)).not.toContainText('open');
      await homeRow(page).click();
      await expect(page).toHaveURL(`${family.origin}/wishes`);
      await expect(page.getByText('1 wish · 0 open')).toBeVisible();
    });
  });

  test('sits under the envelopes card and above “Needs a category”', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      await create(family, '/api/envelopes', {
        name: 'Groceries',
        currency: 'EUR',
        monthlyAmount: '50000',
        mode: 'reset',
      });
      await create(family, '/api/transactions', {
        kind: 'expense',
        date: new Date().toISOString().slice(0, 10),
        accountId: 1,
        amount: '3250',
        merchant: 'Edeka',
      });
      await page.goto(`${family.origin}/`);
      const row = homeRow(page);
      const needs = page.getByRole('link', { name: /^Needs a category/u });
      await expect(row).toBeVisible();
      await expect(needs).toBeVisible();
      const month = nameOf(await currentMonth(family));
      const envelopes = (await page
        .getByRole('region', { name: month })
        .boundingBox())!;
      const wishes = (await row.boundingBox())!;
      const uncategorised = (await needs.boundingBox())!;
      expect(wishes.y).toBeGreaterThanOrEqual(envelopes.y + envelopes.height);
      expect(uncategorised.y).toBeGreaterThanOrEqual(wishes.y + wishes.height);
      // No amount is shown on the row.
      await expect(row).not.toContainText(/\d[.,]\d\d/u);
    });
  });

  test('is left as it is when amounts are hidden or shown', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, { month, name: 'Winter tyres', amount: '48000' });
      await wish(family, { month, name: 'Weekend away', amount: '35000' });

      await page.goto(`${family.origin}/`);
      const eye = page.getByRole('button', {
        name: 'Show amounts for 30 seconds',
      });
      await expect(eye).toHaveAttribute('aria-pressed', 'false');
      await expect(homeRow(page)).toHaveText(/Wishes\s*2 open this month/u);
      const hidden = await homeRow(page).innerText();

      await eye.click();
      await expect(
        page.getByRole('button', { name: 'Hide amounts' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(homeRow(page)).toContainText('2 open this month');
      expect(await homeRow(page).innerText()).toBe(hidden);
    });
  });

  test.describe('offline', () => {
    test.use({ serviceWorkers: 'allow' });

    test('the limited Home has no Wishes row, and Wishes cannot be opened', async ({
      page,
    }) => {
      await startFamily(page, async (family) => {
        await seedBase(family);
        const month = await currentMonth(family);
        await wish(family, { month, name: 'Winter tyres', amount: '48000' });

        await page.goto(`${family.origin}/`);
        await expect(homeRow(page)).toContainText('1 open this month');
        await expect(
          page.getByRole('link', { name: 'Wealth history' }),
        ).toBeVisible();
        await expect.poll(() => records(page, 'addOptions')).toBe(1);

        // Wishes opened once online; the worker keeps none of it (UI-WSH-7).
        await homeRow(page).click();
        await expect(card(page, 'Winter tyres')).toBeVisible();
        await page.goBack();
        await expect(homeRow(page)).toBeVisible();
        await waitForControl(page);
        expect(await cachedApiRequests(page)).toEqual([]);

        await goOffline(page, family);
        await page.reload();
        await expect(
          page.getByRole('heading', { name: 'Hi, Alena' }),
        ).toBeVisible();
        await expect(page.getByText('Offline', { exact: true })).toBeVisible();
        await expect(homeRow(page)).toHaveCount(0);
        await expect(page.getByText('open this month')).toHaveCount(0);
        await expect(page.getByText('No wishes this month')).toHaveCount(0);

        // Typing the address does not open it either: nothing of the list
        // is on the phone.
        await page.goto(`${family.origin}/wishes`);
        await expect(
          page.getByRole('heading', { name: 'Wishes' }),
        ).toBeVisible();
        await expect(page.getByRole('alert')).toContainText(
          'Could not load the wishes. Check your connection and try again.',
        );
        await expect(
          page.getByRole('button', { name: 'Try again' }),
        ).toBeVisible();
        await expect(page.getByText('Winter tyres')).toHaveCount(0);
        await expect(page.getByText('1 wish · 1 open')).toHaveCount(0);
        expect(await cachedApiRequests(page)).toEqual([]);
      });
    });
  });
});

test.describe('Wishes', () => {
  test('shows the summary, a card per open wish and the Done and dropped card', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const category = await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, {
        month,
        name: 'Winter tyres',
        amount: '48000',
        categoryId: category.Transport!,
      });
      await wish(family, {
        month,
        name: 'Weekend in Salzburg',
        amount: '35000',
        categoryId: category.Travel!,
      });
      const finished = await wish(family, {
        month,
        name: 'Sofia’s birthday',
        amount: '15000',
      });
      await setState(family, finished, 'done');
      const dropped = await wish(family, {
        month,
        name: 'Old bike',
        amount: '20000',
      });
      await setState(family, dropped, 'dropped');
      // A wish of another month leaves this one's figures alone.
      await wish(family, {
        month: addMonths(month, 1),
        name: 'Next month’s wish',
        amount: '99900',
      });
      await reshape(page, (answer) => ({
        ...answer,
        wishes: answer.wishes.map((entry) => {
          if (entry.name === 'Weekend in Salzburg') {
            return {
              ...entry,
              spent: '12000',
              left: '23000',
              expenseCount: 1,
            };
          }
          if (entry.name === 'Sofia’s birthday') {
            return { ...entry, spent: '13780', left: '1220', under: '1220' };
          }
          return entry;
        }),
      }));

      await page.goto(`${family.origin}/wishes`);
      await expect(page.getByRole('heading', { name: 'Wishes' })).toBeVisible();
      await expect(
        page.getByText('What this month’s spare money is for'),
      ).toBeVisible();
      // The dropped wish counts in the wishes, not in the total.
      await expect(page.getByText('4 wishes · 2 open')).toBeVisible();
      await expect(page.getByText('€980.00', { exact: true })).toBeVisible();

      const tyres = card(page, 'Winter tyres');
      await expect(tyres).toContainText('Transport');
      await expect(tyres).toContainText('€480.00 to spend');
      await expect(tyres).toContainText('Nothing spent yet · €480.00');
      await expect(tyres).toHaveAttribute('href', /^\/wishes\/\d+$/u);
      const salzburg = card(page, 'Weekend in Salzburg');
      await expect(salzburg).toContainText('Travel');
      await expect(salzburg).toContainText('€230.00 left');
      await expect(salzburg).toContainText(
        '€120.00 spent of €350.00 · 1 expense',
      );
      await expect(
        salzburg.getByRole('progressbar', {
          name: 'Weekend in Salzburg spent',
        }),
      ).toBeVisible();

      await expect(
        page.getByRole('heading', { name: 'Done and dropped' }),
      ).toBeVisible();
      const done = page.getByRole('link', { name: /^Sofia’s birthday/u });
      await expect(done).toContainText('€137.80 of €150.00 · €12.20 under');
      await expect(done.getByText('Done', { exact: true })).toBeVisible();
      const gone = page.getByRole('link', { name: /^Old bike/u });
      await expect(gone).toContainText('€200.00 · nothing spent');
      await expect(gone.getByText('Dropped', { exact: true })).toBeVisible();
      // Open wishes are in cards only, the closed ones in the list only.
      await expect(
        page.getByRole('link', { name: /Winter tyres/u }),
      ).toHaveCount(1);
      await expect(page.getByText('Next month’s wish')).toHaveCount(0);
      await expect(page.getByText(FOOTNOTE)).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'New wish' }),
      ).toHaveAttribute('href', `/wishes/new?month=${month}`);
      await screenshot(page, testInfo, 'Wishes');
    });
  });

  test('says “over” in the warning colour past the amount, and “left” at zero', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, { month, name: 'Sofa', amount: '10000' });
      await wish(family, { month, name: 'Lamp', amount: '5000' });
      await reshape(page, (answer) => ({
        ...answer,
        wishes: answer.wishes.map((entry) =>
          entry.name === 'Sofa'
            ? {
                ...entry,
                spent: '11200',
                left: '-1200',
                over: '1200',
                expenseCount: 2,
              }
            : { ...entry, spent: '5000', left: '0', expenseCount: 1 },
        ),
      }));

      await page.goto(`${family.origin}/wishes`);
      const sofa = card(page, 'Sofa');
      await expect(sofa).toContainText('€12.00 over');
      await expect(sofa).toContainText('€112.00 spent of €100.00 · 2 expenses');
      const figure = sofa.getByText('€12.00 over');
      const color = await figure.evaluate(
        (node) => getComputedStyle(node).color,
      );
      const ink = await card(page, 'Lamp')
        .getByText('€0.00 left')
        .evaluate((node) => getComputedStyle(node).color);
      expect(color).not.toBe(ink);
      await expect(card(page, 'Lamp')).toContainText('€0.00 left');
    });
  });

  test('switches to last month and the next one, and stops after the next', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      const last = addMonths(month, -1);
      const next = addMonths(month, 1);
      await wish(family, { month: last, name: 'Old plan', amount: '30000' });
      await wish(family, { month, name: 'This plan', amount: '20000' });

      await page.goto(`${family.origin}/wishes`);
      const previous = page.getByRole('button', { name: 'Previous month' });
      const following = page.getByRole('button', { name: 'Next month' });
      await expect(page.getByText(withYear(month))).toBeVisible();
      await expect(page.getByText('This month', { exact: true })).toBeVisible();
      await expect(card(page, 'This plan')).toBeVisible();

      await previous.click();
      await expect(page.getByText(withYear(last))).toBeVisible();
      await expect(page.getByText('Last month', { exact: true })).toBeVisible();
      await expect(card(page, 'Old plan')).toContainText('€300.00 to spend');
      await expect(card(page, 'This plan')).toHaveCount(0);
      await expect(page.getByText('1 wish · 1 open')).toBeVisible();

      await previous.click();
      await expect(
        page.getByText('2 months ago', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(`No wishes for ${nameOf(addMonths(month, -2))} yet.`, {
          exact: false,
        }),
      ).toBeVisible();

      await following.click();
      await following.click();
      await expect(page.getByText('This month', { exact: true })).toBeVisible();
      await expect(card(page, 'This plan')).toBeVisible();
      await following.click();
      await expect(page.getByText(withYear(next))).toBeVisible();
      await expect(
        page.getByText('Next month · plan ahead', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          `No wishes for ${nameOf(next)} yet. Add one to plan ahead.`,
        ),
      ).toBeVisible();
      const add = page.getByRole('link', { name: 'Add a wish' });
      await expect(add).toHaveAttribute('href', `/wishes/new?month=${next}`);
      // Nothing to summarise, so no summary line; the footnote stays.
      await expect(page.getByText(/ wishes? · \d+ open/u)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: 'Done and dropped' }),
      ).toHaveCount(0);
      await expect(page.getByText(FOOTNOTE)).toBeVisible();
      // Plans stop one month ahead.
      await expect(following).toBeDisabled();
      await expect(previous).toBeEnabled();
      await screenshot(page, testInfo, 'WishesNext');

      await add.click();
      await expect(page).toHaveURL(`${family.origin}/wishes/new?month=${next}`);
    });
  });

  test('an empty month a year back shows its name and the earliest month has no earlier arrow', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await page.route(listRoute, async (route) => {
        const query = new URL(route.request().url()).searchParams.get('month');
        if (query !== '2000-01') return route.continue();
        return route.fulfill({
          json: {
            month: '2000-01',
            wishes: [],
            counts: { total: 0, open: 0 },
            total: {
              amount: null,
              currency: 'EUR',
              incomplete: false,
              estimated: false,
            },
          },
        });
      });
      await page.goto(`${family.origin}/wishes`);
      // Go back until the earliest month the server serves.
      const previous = page.getByRole('button', { name: 'Previous month' });
      const [year, mm] = month.split('-').map(Number);
      const steps = (year! - 2000) * 12 + (mm! - 1);
      for (let index = 0; index < steps; index += 1) {
        await expect(previous).toBeEnabled();
        await previous.click();
        await expect(
          page.getByText(withYear(addMonths(month, -(index + 1)))),
        ).toBeVisible();
      }
      await expect(page.getByText('January 2000')).toBeVisible();
      await expect(
        page.getByText('No wishes for January yet. Add one to plan ahead.'),
      ).toBeVisible();
      await expect(previous).toBeDisabled();
    });
  });

  test('a wish typed as an expression shows the expression on its card', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, {
        month,
        name: 'Birthday trip',
        amount: '36000',
        expression: '120 + 80 × 3',
      });
      await wish(family, { month, name: 'Plain wish', amount: '10000' });

      await page.goto(`${family.origin}/wishes`);
      const trip = card(page, 'Birthday trip');
      await expect(trip).toContainText('€360.00 to spend');
      await expect(
        trip.getByText('120 + 80 × 3', { exact: true }),
      ).toBeVisible();
      // A wish typed as a plain amount has no second line.
      await expect(card(page, 'Plain wish').locator('.num.t-sub')).toHaveCount(
        1,
      );
      await expect(trip.locator('.num.t-sub')).toHaveCount(2);
    });
  });

  test('the total is in the common currency, with the estimate sign for a coming month', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      const next = addMonths(month, 1);
      await wish(family, { month, name: 'Tyres', amount: '48000' });
      await wish(family, { month, name: 'Shoes', amount: '12050' });
      await wish(family, { month: next, name: 'Holiday', amount: '30000' });

      await page.goto(`${family.origin}/wishes`);
      // The family's common currency is the euro.
      await expect(page.getByText('€600.50', { exact: true })).toBeVisible();
      await expect(page.getByText('Rate missing')).toHaveCount(0);

      await page.getByRole('button', { name: 'Next month' }).click();
      await expect(page.getByText('≈ €300.00', { exact: true })).toBeVisible();
      await expect(page.getByText('Rate missing')).toHaveCount(0);
    });
  });

  test('the total says “Rate missing” when a wish’s currency has no rate', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, { month, name: 'Tyres', amount: '48000' });
      await wish(family, {
        month,
        name: 'Gift from abroad',
        amount: '20000',
        currency: 'USD',
      });
      // No account or envelope uses USD, so the server holds no rate for it.
      const answer = await api<WishesResponse>(
        family,
        `/api/wishes?month=${month}`,
      );
      test.skip(
        !answer.total.incomplete,
        'The server has a USD rate here; the mocked case below covers it.',
      );
      await page.goto(`${family.origin}/wishes`);
      await expect(page.getByText('2 wishes · 2 open')).toBeVisible();
      await expect(page.getByText('€480.00 · Rate missing')).toBeVisible();
      await expect(card(page, 'Gift from abroad')).toContainText('$200.00');
    });
  });

  test('the total shows “Rate missing” alone when nothing can be converted', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, { month, name: 'Tyres', amount: '48000' });
      await reshape(page, (answer) => ({
        ...answer,
        total: { ...answer.total, amount: null, incomplete: true },
      }));
      await page.goto(`${family.origin}/wishes`);
      await expect(
        page.getByText('Rate missing', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('€480.00', { exact: true })).toHaveCount(0);

      await page.unroute(listRoute);
      await reshape(page, (answer) => ({
        ...answer,
        total: { ...answer.total, amount: '48000', incomplete: true },
        wishes: answer.wishes.map((entry) => ({
          ...entry,
          incomplete: true,
          expenseCount: 1,
        })),
      }));
      await page.reload();
      await expect(page.getByText('€480.00 · Rate missing')).toBeVisible();
      await expect(card(page, 'Tyres')).toContainText('Rate missing');
    });
  });

  test('a failed load says so, and Try again loads the list', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seedBase(family);
      const month = await currentMonth(family);
      await wish(family, { month, name: 'Tyres', amount: '48000' });
      let failing = true;
      await page.route(listRoute, (route) =>
        failing ? route.abort('connectionfailed') : route.continue(),
      );
      await page.goto(`${family.origin}/wishes`);
      await expect(page.getByRole('alert')).toContainText(
        'Could not load the wishes. Check your connection and try again.',
      );
      await expect(page.getByText('Tyres')).toHaveCount(0);
      failing = false;
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(card(page, 'Tyres')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  });
});

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

/** Every cached request that is an API call; the worker keeps none. */
function cachedApiRequests(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith('/api/')) {
          urls.push(request.url);
        }
      }
    }
    return urls;
  });
}

/** Takes the server away and makes the browser report "offline". */
async function goOffline(page: Page, family: Family): Promise<void> {
  await family.stop();
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
  });
}
