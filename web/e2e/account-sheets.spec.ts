import { expect, test, type Locator, type Page } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

// The account page's sheets keep every field inside the sheet's 16 px gutter
// (UI-VIS-5), with full-width fields on that gutter, as on New account.

/** A 52-character name, near the longest a name may be (60). */
const LONG = 'A very long name that keeps going on and on and on..';
const GUTTER = 16;

/** Lets a sheet finish its entrance before it is measured. */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

/**
 * Fails when a field, button, label or text in `dialog` reaches past the
 * sheet's gutter, or when a field in `fullWidth` does not span the width
 * between the gutters. Boxes that only hold them may leave room for focus
 * rings, so they are not measured.
 */
async function expectFitsSheet(
  page: Page,
  dialog: Locator,
  fullWidth: Locator[],
): Promise<void> {
  const width = page.viewportSize()!.width;
  const outside = await dialog.evaluate(
    (element, [gutter, right]) =>
      Array.from(
        element.querySelectorAll(
          'input, select, textarea, button, label, p, h2, svg',
        ),
      )
        .map((child) => ({ child, box: child.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0)
        .filter(({ box }) => box.left < gutter - 0.5 || box.right > right + 0.5)
        .map(
          ({ child, box }) =>
            `${child.tagName.toLowerCase()} "${(child.textContent ?? '')
              .trim()
              .slice(0, 30)}" ${Math.round(box.left)}–${Math.round(box.right)}`,
        ),
    [GUTTER, width - GUTTER] as const,
  );
  expect.soft(outside, 'past the sheet gutter').toEqual([]);
  for (const field of fullWidth) {
    const box = (await field.boundingBox())!;
    expect.soft(Math.round(box.x), `${field} left edge`).toBe(GUTTER);
    expect
      .soft(Math.round(box.x + box.width), `${field} right edge`)
      .toBe(width - GUTTER);
  }
}

/** An account with a long name; with history unless `empty`. */
async function account(family: Family, empty = false): Promise<number> {
  return create(family, '/api/accounts', {
    name: LONG,
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    ...(empty ? {} : { openingBalance: '100000' }),
  });
}

test('Account settings and its confirmations fit the sheet', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    await create(family, '/api/members', { name: LONG });
    const id = await account(family);
    await page.goto(`${family.origin}/accounts/${id}`);

    await page.getByRole('button', { name: 'Account settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Account settings' });
    await settled(page);
    await expectFitsSheet(page, settings, [
      settings.getByLabel('Name', { exact: true }),
      settings.getByLabel('Owner'),
      settings.getByLabel('Type'),
      settings.getByLabel('Currency'),
      settings.getByRole('button', { name: 'Save settings' }),
      settings.getByRole('button', { name: 'Deactivate account' }),
    ]);

    await settings.getByRole('button', { name: 'Deactivate account' }).click();
    const deactivate = page.getByRole('dialog', {
      name: 'Deactivate account?',
    });
    await settled(page);
    await expectFitsSheet(page, deactivate, [
      deactivate.getByRole('button', { name: 'Deactivate account' }),
    ]);
    await page.keyboard.press('Escape');

    await settings.getByLabel('Currency').selectOption('USD');
    await settings.getByRole('button', { name: 'Change currency' }).click();
    const relabel = page.getByRole('dialog', { name: 'Relabel as USD?' });
    await settled(page);
    await expectFitsSheet(page, relabel, [
      relabel.getByRole('button', { name: 'Relabel as USD' }),
    ]);
  });
});

test('Delete account, Set balance and Correct balance fit the sheet', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const empty = await account(family, true);
    await page.goto(`${family.origin}/accounts/${empty}`);
    await page.getByRole('button', { name: 'Account settings' }).click();
    await page.getByRole('button', { name: 'Delete account' }).click();
    const remove = page.getByRole('dialog', { name: 'Delete account?' });
    await settled(page);
    await expectFitsSheet(page, remove, [
      remove.getByRole('button', { name: 'Delete account' }),
    ]);

    const id = await account(family);
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: 'Set balance' }).click();
    const balance = page.getByRole('dialog', { name: 'Set balance' });
    await settled(page);
    await expectFitsSheet(page, balance, [
      balance.getByRole('button', { name: 'Date: Today. Change' }),
    ]);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Opening · Alena/u }).click();
    const correction = page.getByRole('dialog', { name: 'Correct balance' });
    await settled(page);
    await expectFitsSheet(page, correction, [
      correction.getByRole('button', { name: 'Date: Today. Change' }),
    ]);
  });
});
