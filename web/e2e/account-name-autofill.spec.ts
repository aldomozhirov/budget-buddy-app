import { expect, test, type Locator } from '@playwright/test';
import { create, startFamily } from './support/family.js';

// iOS Password AutoFill offers the family's saved username for a field it
// takes for a login. Playwright cannot show that prompt, so this checks what
// iOS reads: autocomplete off, and an id and name that say neither "name"
// nor "user". The owner confirms the prompt is gone on the iPhone.

/** Fails unless `field` gives iOS nothing to take for a username. */
async function expectNoUsernameHints(field: Locator): Promise<void> {
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await expect(field).toHaveAttribute('autocapitalize', 'words');
  await expect(field).toHaveAttribute('spellcheck', 'false');
  for (const attribute of ['id', 'name']) {
    const value = (await field.getAttribute(attribute)) ?? '';
    expect(value, attribute).not.toBe('');
    expect(value, attribute).not.toMatch(/name|user/iu);
  }
}

test('the account name fields give iOS no username hints', async ({ page }) => {
  await startFamily(page, async (family) => {
    await page.goto(`${family.origin}/accounts/new`);
    await expectNoUsernameHints(page.getByLabel('Name', { exact: true }));

    const id = await create(family, '/api/accounts', {
      name: 'Everyday',
      ownerMemberId: 1,
      type: 'bank',
      currency: 'EUR',
    });
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expectNoUsernameHints(
      page
        .getByRole('dialog', { name: 'Account settings' })
        .getByLabel('Name', { exact: true }),
    );
  });
});
