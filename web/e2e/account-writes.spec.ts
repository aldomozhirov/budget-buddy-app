import { expect, test } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

// The account page's writes against the real server, whose same-origin
// check refuses a write without a JSON body; mocked routes never ran it.

/** A bank account with an opening balance and one balance set by hand. */
async function seedHistory(family: Family): Promise<number> {
  const id = await create(family, '/api/accounts', {
    name: 'Everyday',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '100000',
  });
  await create(family, `/api/accounts/${id}/snapshots`, { amount: '123456' });
  return id;
}

test('a balance is deleted from the correction sheet', async ({ page }) => {
  await startFamily(page, async (family) => {
    const id = await seedHistory(family);
    await page.goto(`${family.origin}/accounts/${id}`);
    const rows = page.getByRole('button', { name: /· Alena/ });
    await expect(rows).toHaveCount(2);

    await page.getByRole('button', { name: /By hand · Alena/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Correct balance' });
    // The keypad's ⌫ key is also named Delete; the sheet's button is last.
    await sheet
      .getByRole('button', { name: 'Delete', exact: true })
      .last()
      .click();

    await expect(sheet).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: /Opening · Alena/ }),
    ).toContainText('€1,000.00');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test('a refused delete shows the server’s message', async ({ page }) => {
  await startFamily(page, async (family) => {
    const id = await seedHistory(family);
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: /By hand · Alena/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Correct balance' });
    await expect(sheet).toBeVisible();

    // Another phone deletes the balance while this sheet is open.
    const snapshots = await family.api.get(
      `${family.origin}/api/accounts/${id}/snapshots`,
    );
    const body = (await snapshots.json()) as {
      snapshots: { id: number; source: string }[];
    };
    const manual = body.snapshots.find((item) => item.source === 'manual');
    const removed = await family.api.delete(
      `${family.origin}/api/snapshots/${manual!.id}`,
      { headers: { Origin: family.origin }, data: {} },
    );
    expect(removed.status()).toBe(200);

    // The keypad's ⌫ key is also named Delete; the sheet's button is last.
    await sheet
      .getByRole('button', { name: 'Delete', exact: true })
      .last()
      .click();
    await expect(sheet.getByRole('alert')).toHaveText('Snapshot not found.');
  });
});

test('an account is deactivated and reactivated', async ({ page }) => {
  await startFamily(page, async (family) => {
    const id = await seedHistory(family);
    await page.goto(`${family.origin}/accounts/${id}`);
    const hero = page.getByRole('region', { name: 'Current balance' });
    await expect(hero).toContainText('€1,234.56');

    await page.getByRole('button', { name: 'Account settings' }).click();
    await page
      .getByRole('dialog', { name: 'Account settings' })
      .getByRole('button', { name: 'Deactivate account' })
      .click();
    await page
      .getByRole('dialog', { name: 'Deactivate account?' })
      .getByRole('button', { name: 'Deactivate account' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(hero.getByText('Inactive', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Account settings' }).click();
    await page
      .getByRole('dialog', { name: 'Account settings' })
      .getByRole('button', { name: 'Reactivate account' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(hero.getByText('Inactive', { exact: true })).toHaveCount(0);
  });
});

test('an account without history is deleted', async ({ page }) => {
  await startFamily(page, async (family) => {
    const id = await create(family, '/api/accounts', {
      name: 'Never used',
      ownerMemberId: 1,
      type: 'cash',
      currency: 'EUR',
    });
    await page.goto(`${family.origin}/accounts/${id}`);
    await expect(page.getByText('No balance history yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Account settings' }).click();
    await page
      .getByRole('dialog', { name: 'Account settings' })
      .getByRole('button', { name: 'Delete account' })
      .click();
    await page
      .getByRole('dialog', { name: 'Delete account?' })
      .getByRole('button', { name: 'Delete account' })
      .click();

    await expect(page).toHaveURL(`${family.origin}/accounts`);
    const gone = await family.api.get(`${family.origin}/api/accounts/${id}`);
    expect(gone.status()).toBe(404);
  });
});

test('a refused account delete shows the server’s message', async ({
  page,
}) => {
  await startFamily(page, async (family) => {
    const id = await create(family, '/api/accounts', {
      name: 'Never used',
      ownerMemberId: 1,
      type: 'cash',
      currency: 'EUR',
    });
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: 'Account settings' }).click();
    await page
      .getByRole('dialog', { name: 'Account settings' })
      .getByRole('button', { name: 'Delete account' })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Delete account?' });
    await expect(confirm).toBeVisible();

    // Another phone sets a balance while this sheet is open.
    await create(family, `/api/accounts/${id}/snapshots`, { amount: '500' });

    await confirm.getByRole('button', { name: 'Delete account' }).click();
    await expect(confirm.getByRole('alert')).toHaveText(
      'An account with balance history or transactions cannot be deleted.',
    );
    await expect(page).toHaveURL(`${family.origin}/accounts/${id}`);
  });
});
