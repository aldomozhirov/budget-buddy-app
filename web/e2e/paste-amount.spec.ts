import { expect, test, type Page } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

// "Paste" reads the clipboard after a tap (UI-AMT-5). iOS asks with its own
// Paste bubble first; here `navigator.clipboard.readText` is replaced, and
// `copy(page, null)` stands for a dismissed bubble.

const PASTE_ERROR = 'Can’t paste that. Copy just the amount.';

/** Replaces the clipboard with one that gives what `copy` put on it. */
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const read = async () => {
      const text = (window as { copied?: string | null }).copied;
      if (text === null || text === undefined) {
        throw new DOMException(
          'The Paste bubble was dismissed.',
          'NotAllowedError',
        );
      }
      return text;
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: read },
    });
  });
}

/** Puts `text` on the stubbed clipboard; null makes the next read fail. */
async function copy(page: Page, text: string | null): Promise<void> {
  await page.evaluate((value) => {
    (window as { copied?: string | null }).copied = value;
  }, text);
}

/**
 * A EUR account and a USD account, both Alena's, and an envelope, so Add
 * expense shows every row it can have.
 */
async function seed(family: Family): Promise<number> {
  await create(family, '/api/envelopes', {
    name: 'Groceries',
    currency: 'EUR',
    monthlyAmount: '50000',
    mode: 'reset',
  });
  const joint = await create(family, '/api/accounts', {
    name: 'Joint',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '100000',
  });
  await create(family, '/api/accounts', {
    name: 'Wise',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'USD',
    openingBalance: '100000',
  });
  return joint;
}

test('Set balance pastes an amount, keeps its minus and explains a bad paste', async ({
  page,
}) => {
  await stubClipboard(page);
  await startFamily(page, async (family) => {
    const id = await seed(family);
    await page.goto(`${family.origin}/accounts/${id}`);
    await page.getByRole('button', { name: 'Set balance' }).click();
    const sheet = page.getByRole('dialog', { name: 'Set balance' });
    const amount = sheet.getByRole('group', { name: 'Account balance' });
    const paste = sheet.getByRole('button', { name: 'Paste', exact: true });

    // An overdrawn balance keeps its minus.
    await copy(page, '−1.234,56 €');
    await paste.click();
    await expect(amount).toContainText('−€1,234.56');

    await copy(page, 'Total: 5');
    await paste.click();
    await expect(sheet.getByRole('alert')).toHaveText(PASTE_ERROR);
    await expect(amount).toContainText('−€1,234.56');
    // The next key clears the message.
    await sheet.getByRole('button', { name: 'Clear' }).click();
    await expect(sheet.getByRole('alert')).toHaveCount(0);

    // A dismissed Paste bubble changes nothing and says nothing.
    await copy(page, null);
    await paste.click();
    await expect(sheet.getByRole('alert')).toHaveCount(0);
    await expect(amount).toContainText('€0.00');

    // Cmd+V on a keyboard arrives as a paste event, without the bubble.
    await amount.evaluate((element) => {
      const data = new DataTransfer();
      data.setData('text/plain', '42,00');
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(amount).toContainText('€42.00');

    // What was typed is replaced, not added to.
    await sheet.getByRole('button', { name: '7', exact: true }).click();
    await copy(page, '€1,234.56');
    await paste.click();
    await expect(amount).toContainText('€1,234.56');
    await sheet.getByRole('button', { name: 'Save balance' }).click();
    await expect(sheet).toHaveCount(0);

    const body = (await (
      await family.api.get(`${family.origin}/api/accounts/${id}/snapshots`)
    ).json()) as { snapshots: { source: string; amount: string }[] };
    expect(
      body.snapshots.filter((item) => item.source === 'manual'),
    ).toMatchObject([{ amount: '123456' }]);
  });
});

test('Add expense pastes without the bank’s minus and still fits', async ({
  page,
}) => {
  await stubClipboard(page);
  await startFamily(page, async (family) => {
    await seed(family);
    await page.goto(`${family.origin}/add`);
    const paste = page.getByRole('button', { name: 'Paste amount' });
    await expect(paste).toBeVisible();

    // The whole form still fits without scrolling (UI-ADD-1).
    const save = page.getByRole('button', { name: 'Enter an amount' });
    const box = (await save.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    ).toBeLessThanOrEqual(0);

    await copy(page, 'Groceries');
    await paste.click();
    await expect(page.getByRole('alert')).toHaveText(PASTE_ERROR);

    // Banking apps show money spent as "−12,30 €"; it is not a refund.
    await copy(page, '−12,30 €');
    await paste.click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save €12.30' }).click();
    await expect(
      page.getByRole('heading', { name: 'Expense saved' }),
    ).toBeVisible();
  });
});

test('a two-currency transfer pastes the amount that arrives', async ({
  page,
}) => {
  await stubClipboard(page);
  await startFamily(page, async (family) => {
    await seed(family);
    await expect
      .poll(
        async () => {
          const response = await family.api.get(
            `${family.origin}/api/rates/pair?from=EUR&to=USD&date=2099-01-01`,
          );
          return ((await response.json()) as { rate: unknown }).rate !== null;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.goto(`${family.origin}/add?kind=transfer`);
    await page
      .getByRole('radiogroup', { name: 'To', exact: true })
      .getByRole('radio', { name: /^Wise/u })
      .click();
    await copy(page, '20,00 €');
    await page.getByRole('button', { name: 'Paste amount' }).click();

    await page.getByRole('button', { name: /^Arrives as \$/u }).click();
    await copy(page, '$21.86');
    await page.getByRole('button', { name: 'Paste what arrives' }).click();
    await expect(
      page.getByRole('button', { name: 'Arrives as $21.86. Change' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Amount €20.00. Type it again' }),
    ).toBeVisible();
  });
});
