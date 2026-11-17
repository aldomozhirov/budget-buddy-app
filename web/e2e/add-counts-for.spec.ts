import { addMonths, type WishesResponse } from '@budget-buddy/shared';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';
import { expectNoSidewaysScroll } from './support/sideways-scroll.js';

/**
 * The Add form's "Counts for" row (spec 3a task 52; UI-ADD-17, UI-ADD-5,
 * UI-ADD-10, UI-ADD-16): an envelope, an open wish of the date's month or
 * neither, in one row of chips with "All…". Data is made through the API.
 */

const KEY_NAMES: Record<string, string> = { '.': 'Decimal point' };
const OFFLINE_NOTE = 'Offline. It stays on this phone and sends itself later.';

async function typeAmount(page: Page, amount: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of amount) {
    await keypad
      .getByRole('button', { name: KEY_NAMES[key] ?? key, exact: true })
      .click();
  }
}

/** Saves the iPhone screenshot the reviewer compares with the design. */
async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'iphone') return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/screens/${name}.png` });
}

/** The row's chips; the group is named by the label above them. */
const counts = (page: Page): Locator =>
  page.getByRole('group', { name: /^Counts for/ });
/** The pressed chip of the row. */
const picked = (page: Page): Locator =>
  counts(page).getByRole('button', { pressed: true });
const chip = (page: Page, name: string): Locator =>
  counts(page).getByRole('button', { name, exact: true });
const sheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Counts for' });

const MONTHS = [
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

interface Seeded {
  month: string;
  tyres: number;
  bike: number;
  boiler: number;
  groceries: number;
  eatingOut: number;
  car: number;
}

/**
 * ING Visa in euros; six envelopes (one more chip than the row holds, so
 * "All…" matters); Groceries files into the Groceries envelope by default
 * and a rule sends REWE there. Open wishes: Winter tyres and New bike this
 * month, Old boiler last month.
 */
async function seed(family: Family): Promise<Seeded> {
  await create(family, '/api/accounts', {
    name: 'ING Visa',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '100000',
  });
  const ids: Record<string, number> = {};
  for (const name of [
    'Groceries',
    'Eating out',
    'Unexpected',
    'Holiday',
    'Gifts',
    'Car',
  ]) {
    ids[name] = await create(family, '/api/envelopes', {
      name,
      currency: 'EUR',
      monthlyAmount: '50000',
      mode: 'reset',
    });
  }
  const categories = (await (
    await family.api.get(`${family.origin}/api/categories?kind=expense`)
  ).json()) as { categories: { id: number; name: string }[] };
  const byName = (name: string) =>
    categories.categories.find((category) => category.name === name)!.id;
  const patched = await family.api.patch(
    `${family.origin}/api/categories/${byName('Groceries')}`,
    {
      headers: { Origin: family.origin },
      data: { defaultEnvelopeId: ids['Groceries'] },
    },
  );
  expect(patched.status()).toBe(200);
  await create(family, '/api/rules', {
    pattern: 'REWE',
    categoryId: byName('Groceries'),
    envelopeId: ids['Groceries'],
  });
  const month = (
    (await (
      await family.api.get(`${family.origin}/api/wishes`)
    ).json()) as WishesResponse
  ).month;
  const wish = (name: string, at: string, amount: string) =>
    create(family, '/api/wishes', {
      month: at,
      name,
      amount,
      currency: 'EUR',
      categoryId: byName('Transport'),
    });
  return {
    month,
    tyres: await wish('Winter tyres', month, '48000'),
    bike: await wish('New bike', month, '90000'),
    boiler: await wish('Old boiler', addMonths(month, -1), '30000'),
    groceries: ids['Groceries']!,
    eatingOut: ids['Eating out']!,
    car: ids['Car']!,
  };
}

async function openAdd(page: Page, family: Family, query = ''): Promise<void> {
  await page.goto(`${family.origin}/add${query}`);
  // Opened from a wish the amount is prefilled; otherwise Save waits for one.
  await expect(
    page.getByRole('button', {
      name: query ? /^Save €/ : 'Enter an amount',
    }),
  ).toBeVisible();
}

async function pickMerchant(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: /^(Add merchant|Merchant: .*)$/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Merchant' });
  await dialog.getByLabel('Search or type a merchant').fill(name);
  await dialog.getByRole('button', { name: `Use “${name}”` }).click();
  await expect(dialog).toHaveCount(0);
}

/** Moves the date to the first day of last month, in the date sheet. */
async function pickLastMonth(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Date:/u }).click();
  const dialog = page.getByRole('dialog', { name: 'Date' });
  await dialog.getByRole('button', { name: 'Previous month' }).click();
  await dialog.getByRole('button', { name: /^1 [A-Z][a-z]+ \d{4}$/u }).click();
  await expect(dialog).toHaveCount(0);
}

interface Saved {
  id: number;
  envelopeId: number | null;
  categoryId: number | null;
  countsFor: { type: string; id?: number; madeHow?: string };
}

/** The newest transaction on the server, with what it counts for. */
async function lastSaved(family: Family): Promise<Saved> {
  const list = (await (
    await family.api.get(`${family.origin}/api/transactions?period=all`)
  ).json()) as { transactions: { id: number }[] };
  expect(list.transactions.length).toBeGreaterThan(0);
  const id = Math.max(...list.transactions.map((item) => item.id));
  const response = await family.api.get(
    `${family.origin}/api/transactions/${id}`,
  );
  return ((await response.json()) as { transaction: Saved }).transaction;
}

async function wishSpent(family: Family, id: number): Promise<string> {
  const response = await family.api.get(`${family.origin}/api/wishes/${id}`);
  return ((await response.json()) as { wish: { spent: string } }).wish.spent;
}

test.describe('Counts for on the Add form', () => {
  test('lists envelope and wish chips with their icons in order, then All…, and fits the screen', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await openAdd(page, family);
      const names = async () =>
        (await counts(page).getByRole('button').all()).map(
          async (button) =>
            (await button.getAttribute('aria-label')) ??
            (await button.innerText()),
        );
      const read = async () => Promise.all(await names());

      // Nothing suggested: the month's wishes, then the envelopes.
      await expect(page.getByText('Counts for · optional')).toBeVisible();
      expect(await read()).toEqual([
        'Wish: Winter tyres',
        'Wish: New bike',
        'Groceries envelope',
        'Eating out envelope',
        'Unexpected envelope',
        'All envelopes and wishes',
      ]);
      // Last month's wish is not offered for today's date.
      await expect(chip(page, 'Wish: Old boiler')).toHaveCount(0);
      // Nothing is picked: the envelope is filled on save (UI-ADD-10).
      await expect(picked(page)).toHaveCount(0);

      // The star marks a wish and the envelope icon an envelope.
      await expect(
        chip(page, 'Wish: Winter tyres').locator('svg.lucide-star'),
      ).toHaveCount(1);
      await expect(chip(page, 'Groceries envelope').locator('svg')).toHaveCount(
        1,
      );
      await expect(
        chip(page, 'Groceries envelope').locator('svg.lucide-star'),
      ).toHaveCount(0);
      await expect(
        chip(page, 'All envelopes and wishes').locator('svg'),
      ).toHaveCount(0);

      // The envelope the category fills comes first, then the wishes.
      await page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Groceries' })
        .click();
      await expect(
        page.getByText('Counts for · optional · if empty, Groceries envelope', {
          exact: true,
        }),
      ).toBeVisible();
      expect(await read()).toEqual([
        'Groceries envelope',
        'Wish: Winter tyres',
        'Wish: New bike',
        'Eating out envelope',
        'Unexpected envelope',
        'All envelopes and wishes',
      ]);
      await expect(picked(page)).toHaveCount(0);

      // The whole form still fits (UI-ADD-1) and the row has no sideways
      // scroll of its own beyond the design's swipeable chip row.
      await typeAmount(page, '5');
      const save = page.getByRole('button', { name: 'Save €5.00' });
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
      await expectNoSidewaysScroll(page, 'Add with Counts for');
      await chip(page, 'Wish: Winter tyres').click();
      await screenshot(page, testInfo, 'AddExpenseCounts');
    });
  });

  test('a wish clears an envelope and the reverse, a second tap clears, and the label previews each state', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await openAdd(page, family);
      const label = (text: string) =>
        expect(page.getByText(text, { exact: true })).toBeVisible();
      await label('Counts for · optional');

      await chip(page, 'Eating out envelope').click();
      await expect(picked(page)).toHaveCount(1);
      await expect(chip(page, 'Eating out envelope')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await label('Counts for · optional');

      await chip(page, 'Wish: Winter tyres').click();
      await expect(picked(page)).toHaveCount(1);
      await expect(chip(page, 'Wish: Winter tyres')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(chip(page, 'Eating out envelope')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await label('Counts for · a wish, so no envelope');

      // Another wish takes its place; an envelope takes the wish's.
      await chip(page, 'Wish: New bike').click();
      await expect(picked(page)).toHaveCount(1);
      await expect(chip(page, 'Wish: New bike')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await chip(page, 'Unexpected envelope').click();
      await expect(picked(page)).toHaveCount(1);
      await expect(chip(page, 'Wish: New bike')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await label('Counts for · optional');

      // Tapping the selected chip clears it, whatever kind it is.
      await chip(page, 'Unexpected envelope').click();
      await expect(picked(page)).toHaveCount(0);
      await chip(page, 'Wish: Winter tyres').click();
      await chip(page, 'Wish: Winter tyres').click();
      await expect(picked(page)).toHaveCount(0);
      await label('Counts for · optional');
    });
  });

  test('All… opens the sheet with search and groups, a pick leads the chips and Unplanned shows as a selected chip', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);
      await page
        .getByRole('button', { name: 'All envelopes and wishes' })
        .click();
      const dialog = sheet(page);
      await expect(dialog).toBeVisible();
      const search = dialog.getByPlaceholder('Search envelopes and wishes');
      await expect(search).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: 'Envelopes' }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('heading', {
          name: `Wishes in ${MONTHS[Number(data.month.slice(5)) - 1]}`,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: 'Neither' }),
      ).toBeVisible();
      // All six envelopes, both wishes of the month and Unplanned.
      await expect(dialog.getByRole('radio')).toHaveCount(9);
      await expect(
        dialog.getByRole('radio', { name: /Old boiler/ }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('radio', { name: /^Unplanned/ }),
      ).toBeVisible();
      // An empty row means the category's default, not "Unplanned".
      await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
      await expect(dialog.getByText('The category stays.')).toHaveCount(0);
      await screenshot(page, testInfo, 'AddCountsFor');

      // Search narrows the groups; an empty group is left out.
      await search.fill('tyre');
      await expect(dialog.getByRole('radio')).toHaveCount(1);
      await expect(
        dialog.getByRole('radio', { name: /Winter tyres/ }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: 'Envelopes' }),
      ).toHaveCount(0);
      await search.fill('zzz');
      await expect(dialog.getByText('Nothing matches.')).toBeVisible();
      await search.fill('car');
      await expect(dialog.getByRole('radio')).toHaveCount(1);

      // The sixth envelope was beyond the chips: a pick leads them.
      await dialog.getByRole('radio', { name: /^Car/ }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        counts(page).getByRole('button').first(),
      ).toHaveAccessibleName('Car envelope');
      await expect(chip(page, 'Car envelope')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(picked(page)).toHaveCount(1);

      // A wish from the sheet leads and clears the envelope.
      await page
        .getByRole('button', { name: 'All envelopes and wishes' })
        .click();
      await expect(
        sheet(page).getByRole('radio', { name: /^Car/, checked: true }),
      ).toBeVisible();
      await sheet(page)
        .getByRole('radio', { name: /New bike/ })
        .click();
      await expect(
        counts(page).getByRole('button').first(),
      ).toHaveAccessibleName('Wish: New bike');
      await expect(picked(page)).toHaveCount(1);

      // "Unplanned" is a chip too, selected, and clears like the others.
      await page
        .getByRole('button', { name: 'All envelopes and wishes' })
        .click();
      await sheet(page)
        .getByRole('radio', { name: /^Unplanned/ })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        counts(page).getByRole('button').first(),
      ).toHaveAccessibleName('Unplanned');
      await expect(chip(page, 'Unplanned')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(chip(page, 'Wish: New bike')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(
        page.getByText('Counts for · no envelope and no wish', { exact: true }),
      ).toBeVisible();
      await chip(page, 'Unplanned').click();
      await expect(chip(page, 'Unplanned')).toHaveCount(0);
      await expect(picked(page)).toHaveCount(0);
      expect(data.car).toBeGreaterThan(0);
    });
  });

  test('saving with a wish picked saves no envelope, despite the category default and a merchant rule, and makes the link', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);
      await pickMerchant(page, 'REWE');
      // The rule filled Groceries and its envelope; the wish takes its place.
      await expect(
        page.getByText('Counts for · from REWE rule', { exact: true }),
      ).toBeVisible();
      await chip(page, 'Wish: Winter tyres').click();
      await expect(picked(page)).toHaveCount(1);
      await typeAmount(page, '25');
      await page.getByRole('button', { name: 'Save €25.00' }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved' }),
      ).toBeVisible();
      await expect(page.getByText('Counts for Winter tyres')).toBeVisible();

      const saved = await lastSaved(family);
      expect(saved.envelopeId).toBeNull();
      expect(saved.countsFor).toMatchObject({
        type: 'wish',
        id: data.tyres,
        madeHow: 'member',
      });
      expect(await wishSpent(family, data.tyres)).toBe('2500');

      // The transaction page shows the wish.
      await page.goto(`${family.origin}/transactions/${saved.id}`);
      await expect(
        page.getByRole('button', { name: /^Counts for/ }),
      ).toContainText('Winter tyres');
    });
  });

  test('saving with a wish picked and only the category’s default envelope still files no envelope', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);
      await page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Groceries' })
        .click();
      await chip(page, 'Wish: New bike').click();
      await typeAmount(page, '12');
      await page.getByRole('button', { name: 'Save €12.00' }).click();
      await expect(page.getByText('Counts for New bike')).toBeVisible();
      // No "envelope added from the category" line: none was filled.
      await expect(page.getByText(/envelope added from/)).toHaveCount(0);
      const saved = await lastSaved(family);
      expect(saved.envelopeId).toBeNull();
      expect(saved.categoryId).not.toBeNull();
      expect(saved.countsFor).toMatchObject({ type: 'wish', id: data.bike });
    });
  });

  test('saving with Unplanned saves no envelope and no link despite the category’s default', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);
      await page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Groceries' })
        .click();
      await page
        .getByRole('button', { name: 'All envelopes and wishes' })
        .click();
      await sheet(page)
        .getByRole('radio', { name: /^Unplanned/ })
        .click();
      await expect(
        page.getByText('Counts for · no envelope and no wish', { exact: true }),
      ).toBeVisible();
      await typeAmount(page, '8');
      await page.getByRole('button', { name: 'Save €8.00' }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved' }),
      ).toBeVisible();
      // The form's own label stays in the page; the saved note has no "·".
      await expect(page.getByText(/^Counts for (?!·)/)).toHaveCount(0);
      await expect(page.getByText(/envelope added from/)).toHaveCount(0);

      const saved = await lastSaved(family);
      expect(saved.envelopeId).toBeNull();
      expect(saved.categoryId).not.toBeNull();
      expect(saved.countsFor.type).toBe('none');
      expect(await wishSpent(family, data.tyres)).toBe('0');
    });
  });

  test('an empty Counts for still takes the category’s default envelope on save', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);
      await page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Groceries' })
        .click();
      await typeAmount(page, '4');
      await page.getByRole('button', { name: 'Save €4.00' }).click();
      await expect(
        page.getByText('Groceries envelope added from the Groceries category.'),
      ).toBeVisible();
      const saved = await lastSaved(family);
      expect(saved.envelopeId).toBe(data.groceries);
      expect(saved.countsFor).toMatchObject({ type: 'envelope' });
    });
  });

  test('another month clears a picked wish and offers that month’s wishes; a rule never replaces a picked wish', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);

      // A merchant rule never replaces a picked wish.
      await chip(page, 'Wish: Winter tyres').click();
      await pickMerchant(page, 'REWE');
      await expect(
        page
          .getByRole('radiogroup', { name: 'Category' })
          .getByRole('radio', { name: 'Groceries' }),
      ).toBeChecked();
      await expect(chip(page, 'Wish: Winter tyres')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(picked(page)).toHaveCount(1);
      await expect(
        page.getByText('Counts for · a wish, so no envelope', { exact: true }),
      ).toBeVisible();

      // Last month: the wish is let go, last month's wishes are offered.
      await pickLastMonth(page);
      await expect(chip(page, 'Wish: Winter tyres')).toHaveCount(0);
      await expect(chip(page, 'Wish: New bike')).toHaveCount(0);
      await expect(chip(page, 'Wish: Old boiler')).toBeVisible();
      await expect(picked(page)).toHaveCount(0);
      await expect(page.getByText(/^Counts for · a wish/)).toHaveCount(0);
      // Save is not blocked: no warning, no "needs a connection".
      await typeAmount(page, '30');
      await expect(page.getByText(/^Pick a date in /)).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Save €30.00' }),
      ).toBeEnabled();

      // The sheet lists that month's wishes too, and the pick saves a link.
      await page
        .getByRole('button', { name: 'All envelopes and wishes' })
        .click();
      const dialog = sheet(page);
      await expect(
        dialog.getByRole('heading', {
          name: `Wishes in ${MONTHS[Number(addMonths(data.month, -1).slice(5)) - 1]}`,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('radio', { name: /Winter tyres/ }),
      ).toHaveCount(0);
      await dialog.getByRole('radio', { name: /Old boiler/ }).click();
      await expect(chip(page, 'Wish: Old boiler')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Save €30.00' }).click();
      await expect(page.getByText('Counts for Old boiler')).toBeVisible();
      const saved = await lastSaved(family);
      expect(saved.envelopeId).toBeNull();
      expect(saved.countsFor).toMatchObject({
        type: 'wish',
        id: data.boiler,
        madeHow: 'member',
      });
    });
  });

  test('back to today’s month, the wishes of this month are offered again', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await openAdd(page, family);
      await pickLastMonth(page);
      await expect(chip(page, 'Wish: Winter tyres')).toHaveCount(0);
      await page.getByRole('button', { name: /^Date:/u }).click();
      await page
        .getByRole('dialog', { name: 'Date' })
        .getByRole('button', { name: 'Today' })
        .click();
      await expect(chip(page, 'Wish: Winter tyres')).toBeVisible();
      await expect(chip(page, 'Wish: Old boiler')).toHaveCount(0);
    });
  });

  test('opened from a wish, the wish leads and can be changed to an envelope; kept, the link is recorded', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family, `?wishId=${data.bike}`);
      await expect(
        counts(page).getByRole('button').first(),
      ).toHaveAccessibleName('Wish: New bike');
      await expect(chip(page, 'Wish: New bike')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(picked(page)).toHaveCount(1);
      await expect(
        page.getByText('Counts for · a wish, so no envelope', { exact: true }),
      ).toBeVisible();
      await screenshot(page, testInfo, 'AddFromWish');

      // Changed to an envelope: no link, the envelope counts.
      await chip(page, 'Eating out envelope').click();
      await expect(chip(page, 'Wish: New bike')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await page.getByRole('button', { name: /^Save €/ }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved' }),
      ).toBeVisible();
      await expect(page.getByText('Counts for New bike')).toHaveCount(0);
      const changed = await lastSaved(family);
      expect(changed.envelopeId).toBe(data.eatingOut);
      expect(changed.countsFor).toMatchObject({ type: 'envelope' });
      expect(await wishSpent(family, data.bike)).toBe('0');

      // Kept: the link is recorded from the wish, with no envelope.
      await openAdd(page, family, `?wishId=${data.bike}`);
      await page.getByRole('button', { name: /^Save €/ }).click();
      await expect(page.getByText('Counts for New bike')).toBeVisible();
      const kept = await lastSaved(family);
      expect(kept.envelopeId).toBeNull();
      expect(kept.countsFor).toMatchObject({
        type: 'wish',
        id: data.bike,
        madeHow: 'recorded',
      });
    });
  });

  test('opened from a wish and changed to another wish, the link is made by the member', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family, `?wishId=${data.bike}`);
      await chip(page, 'Wish: Winter tyres').click();
      await expect(chip(page, 'Wish: New bike')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await typeAmount(page, '3');
      await page.getByRole('button', { name: /^Save €/ }).click();
      await expect(page.getByText('Counts for Winter tyres')).toBeVisible();
      const saved = await lastSaved(family);
      expect(saved.countsFor).toMatchObject({
        type: 'wish',
        id: data.tyres,
        madeHow: 'member',
      });
    });
  });

  test('offline, wishes come from the cached options, Save with a wish needs a connection, and envelope and Unplanned saves queue', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const data = await seed(family);
      await openAdd(page, family);
      const context = page.context();
      await context.setOffline(true);
      await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
      await typeAmount(page, '6.40');

      // The cached options still offer the month's wishes.
      await expect(chip(page, 'Wish: Winter tyres')).toBeVisible();
      await expect(chip(page, 'Wish: New bike')).toBeVisible();
      await chip(page, 'Wish: Winter tyres').click();
      await expect(
        page.getByText('Offline. Adding to a wish needs a connection.'),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: 'Save €6.40 · needs a connection',
        }),
      ).toBeDisabled();

      // Switching to an envelope lets the save queue.
      await chip(page, 'Groceries envelope').click();
      await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Save €6.40' }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Save €6.40' }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved on this phone' }),
      ).toBeVisible();

      // Another one, Unplanned through the sheet, queues too.
      await page.getByRole('button', { name: 'Add another' }).click();
      await typeAmount(page, '2.20');
      await page
        .getByRole('radiogroup', { name: 'Category' })
        .getByRole('radio', { name: 'Groceries' })
        .click();
      await page
        .getByRole('button', { name: 'All envelopes and wishes' })
        .click();
      await sheet(page)
        .getByRole('radio', { name: /^Unplanned/ })
        .click();
      await expect(
        page.getByRole('button', { name: 'Save €2.20' }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Save €2.20' }).click();
      await expect(
        page.getByRole('heading', { name: 'Expense saved on this phone' }),
      ).toBeVisible();

      // Back online both are sent: one in the envelope, one in none.
      await context.setOffline(false);
      await expect
        .poll(
          async () =>
            (
              (await (
                await family.api.get(
                  `${family.origin}/api/transactions?period=all`,
                )
              ).json()) as { transactions: unknown[] }
            ).transactions.length,
          { timeout: 15_000 },
        )
        .toBe(2);
      const list = (await (
        await family.api.get(`${family.origin}/api/transactions?period=all`)
      ).json()) as { transactions: { id: number }[] };
      const rows = await Promise.all(
        list.transactions.map(
          async ({ id }) =>
            (
              (await (
                await family.api.get(`${family.origin}/api/transactions/${id}`)
              ).json()) as { transaction: Saved & { amount: string } }
            ).transaction,
        ),
      );
      const byAmount = Object.fromEntries(rows.map((row) => [row.amount, row]));
      expect(byAmount['640']!.envelopeId).toBe(data.groceries);
      expect(byAmount['220']!.envelopeId).toBeNull();
      expect(byAmount['220']!.countsFor.type).toBe('none');
      expect(await wishSpent(family, data.tyres)).toBe('0');
    });
  });

  test('income and transfer have no Counts for row', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await openAdd(page, family);
      await expect(counts(page)).toBeVisible();
      await page.getByRole('radio', { name: 'Income', exact: true }).click();
      await expect(counts(page)).toHaveCount(0);
      await page.getByRole('radio', { name: 'Transfer', exact: true }).click();
      await expect(counts(page)).toHaveCount(0);
    });
  });
});
