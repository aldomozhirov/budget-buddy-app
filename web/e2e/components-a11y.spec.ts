import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/components');
  await expect(
    page.getByRole('heading', { name: 'Components · light' }),
  ).toBeVisible();
});

test('an open sheet makes the page behind it inert and restores it', async ({
  page,
}) => {
  const opener = page.getByRole('button', { name: 'Open sheet preview' });
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'Close the check-in now?' });
  await expect(sheet).toBeVisible();

  expect(
    await opener.evaluate((element) => element.closest('[inert]') !== null),
  ).toBe(true);
  expect(
    await sheet.evaluate((element) => element.closest('[inert]') === null),
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await page.locator('[inert]').count()).toBe(0);
});

test('Tab stays inside an open sheet', async ({ page }) => {
  await page.getByRole('button', { name: 'Open sheet preview' }).click();
  const sheet = page.getByRole('dialog', { name: 'Close the check-in now?' });
  await expect(sheet).toBeVisible();

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab');
    expect(
      await sheet.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
});

test('the segmented control is a radio group driven by arrow keys', async ({
  page,
}) => {
  const group = page.getByRole('radiogroup', { name: 'Kind' });
  const radios = group.getByRole('radio');
  const count = await radios.count();
  expect(count).toBeGreaterThan(1);

  const checked = group.getByRole('radio', { checked: true });
  await checked.focus();
  const before = await checked.textContent();
  await page.keyboard.press('ArrowDown');
  const after = group.getByRole('radio', { checked: true });
  await expect(after).toBeFocused();
  expect(await after.textContent()).not.toBe(before);
});

test('a hidden amount is read by its label, not its dots', async ({ page }) => {
  const card = page.getByRole('group', { name: 'Family wealth' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Amount hidden')).toBeAttached();
  await expect(
    card.locator('[aria-hidden="true"]', { hasText: '•' }),
  ).toHaveCount(1);
});
