import { expect, test, type Locator, type Page } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

// Balance dates are picked with the Add form's month calendar, not the
// native date input, which iOS draws past the edge of a sheet.

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

interface Day {
  /** YYYY-MM-DD. */
  date: string;
  /** The calendar button's name, e.g. "10 September 2026". */
  name: string;
}

/** Today in the family time zone, YYYY-MM-DD. */
async function familyToday(family: Family): Promise<string> {
  const settings = (await (
    await family.api.get(`${family.origin}/api/settings`)
  ).json()) as { timeZone: string };
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timeZone,
  }).format(new Date());
}

/** Day `day` of the month before `today`'s, always in the past. */
function lastMonth(today: string, day: number): Day {
  const [year, month] = today.split('-').map(Number);
  const index = year! * 12 + month! - 2;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return {
    date: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    name: `${day} ${MONTHS[m - 1]} ${y}`,
  };
}

/** Each balance of an account as [day in the family zone, amount]. */
async function history(
  family: Family,
  id: number,
): Promise<[string, string][]> {
  const settings = (await (
    await family.api.get(`${family.origin}/api/settings`)
  ).json()) as { timeZone: string };
  const body = (await (
    await family.api.get(`${family.origin}/api/accounts/${id}/snapshots`)
  ).json()) as { snapshots: { takenAt: string; amount: string }[] };
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timeZone,
  });
  return body.snapshots
    .map((item): [string, string] => [
      day.format(new Date(item.takenAt)),
      item.amount,
    ])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Picks `day` in the open calendar, a month back, and waits for it to go. */
async function pickLastMonth(page: Page, day: Day): Promise<void> {
  const calendar = page.getByRole('dialog', { name: 'Date' });
  await calendar.getByRole('button', { name: 'Previous month' }).click();
  await calendar.getByRole('button', { name: day.name }).click();
  await expect(calendar).toHaveCount(0);
}

/** Fails unless `inner` lies within the page's width. */
async function expectInsideWidth(page: Page, inner: Locator): Promise<void> {
  const box = await inner.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
}

/**
 * Fails unless the sheet holding `covered` is drawn dimmed: a sheet opened
 * over another dims it, as it dims the page. The sheet below is inert, so
 * hit testing cannot see what covers it; this reads the screenshot's pixel
 * just left of `covered`, on the sheet's background.
 */
async function expectDimmed(page: Page, covered: Locator): Promise<void> {
  const box = (await covered.boundingBox())!;
  const shot = await page.screenshot({ scale: 'css', animations: 'disabled' });
  const [red, green, blue] = await page.evaluate(
    async ([png, x, y]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(x, y, 1, 1).data);
    },
    [
      shot.toString('base64'),
      Math.round(box.x / 2),
      Math.round(box.y + box.height / 2),
    ] as const,
  );
  const surface = await covered.evaluate(
    (element) => getComputedStyle(element.closest('.sheet')!).backgroundColor,
  );
  const [r, g, b] = surface.match(/\d+/gu)!.map(Number);
  expect(
    red! + green! + blue!,
    `sheet pixel rgb(${red}, ${green}, ${blue}) vs surface ${surface}`,
  ).toBeLessThan((r! + g! + b!) * 0.85);
}

test('Set balance picks an earlier date in the calendar and keeps the amount', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const today = await familyToday(family);
    const id = await create(family, '/api/accounts', {
      name: 'Everyday',
      ownerMemberId: 1,
      type: 'bank',
      currency: 'EUR',
      openingBalance: '100000',
      openingDate: lastMonth(today, 1).date,
    });
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: 'Set balance' }).click();
    const sheet = page.getByRole('dialog', { name: 'Set balance' });

    const date = sheet.getByRole('button', { name: 'Date: Today. Change' });
    await expect(date).toHaveCSS('padding-left', '12px');
    for (const digit of ['5', '0']) {
      await sheet.getByRole('button', { name: digit, exact: true }).click();
    }
    await date.click();

    // The calendar opens over Set balance and fits the screen.
    const calendar = page.getByRole('dialog', { name: 'Date' });
    await expect(calendar).toBeVisible();
    await expectInsideWidth(page, calendar);
    await expectDimmed(
      page,
      sheet.getByRole('heading', { name: 'Set balance' }),
    );
    const day = lastMonth(today, 10);
    await pickLastMonth(page, day);

    await expect(date).toHaveCount(0);
    await expect(
      sheet.getByRole('button', { name: /^Date: .*10 .*\. Change$/u }),
    ).toBeVisible();
    await expect(sheet.getByText('€50.00', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Save balance' }).click();
    await expect(sheet).toHaveCount(0);

    expect(await history(family, id)).toEqual([
      [lastMonth(today, 1).date, '100000'],
      [day.date, '5000'],
    ]);
  });
});

test('Correct balance moves a balance to an earlier date and keeps the amount', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const today = await familyToday(family);
    const id = await create(family, '/api/accounts', {
      name: 'Everyday',
      ownerMemberId: 1,
      type: 'bank',
      currency: 'EUR',
      openingBalance: '100000',
    });
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: /Opening · Alena/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Correct balance' });
    await sheet.getByRole('button', { name: 'Clear' }).click();
    for (const digit of ['4', '2']) {
      await sheet.getByRole('button', { name: digit, exact: true }).click();
    }

    await sheet.getByRole('button', { name: 'Date: Today. Change' }).click();
    const calendar = page.getByRole('dialog', { name: 'Date' });
    await expectInsideWidth(page, calendar);
    await expectDimmed(
      page,
      sheet.getByRole('heading', { name: 'Correct balance' }),
    );
    const day = lastMonth(today, 10);
    await pickLastMonth(page, day);
    await expect(sheet.getByText('€42.00', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Save correction' }).click();
    await expect(sheet).toHaveCount(0);

    expect(await history(family, id)).toEqual([[day.date, '4200']]);
  });
});

test('New account picks the opening date in the calendar', async ({ page }) => {
  await startFamily(page, async (family) => {
    const today = await familyToday(family);
    await page.goto(`${family.origin}/accounts/new`);
    await page.getByLabel('Name', { exact: true }).fill('Everyday');
    await page
      .getByRole('button', { name: 'Opening balance', exact: true })
      .click();
    await page.getByRole('button', { name: '7', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save', exact: true })
      .click();

    const date = page.getByRole('button', { name: 'Opening balance date' });
    await expect(date).toHaveText('Today ▾');
    await date.click();
    await expectInsideWidth(page, page.getByRole('dialog', { name: 'Date' }));
    const day = lastMonth(today, 10);
    await pickLastMonth(page, day);
    await expect(date).toContainText('10');

    await page.locator('footer').getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/accounts\/\d+$/u);
    const id = Number(new URL(page.url()).pathname.split('/').pop());
    expect(await history(family, id)).toEqual([[day.date, '700']]);
  });
});
