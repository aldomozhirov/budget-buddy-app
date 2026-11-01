import { expect, test, type Page } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

// A tap on the amount reads the clipboard (UI-AMT-5). iOS asks with its own
// Paste bubble; here `navigator.clipboard.readText` is replaced, and
// `copy(page, null)` stands for a dismissed bubble. `reads` counts the calls.

const PASTE_ERROR = 'Can’t paste that. Copy just the amount.';

/** Replaces the clipboard with one that gives what `copy` put on it. */
async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const read = async () => {
      const win = window as { copied?: string | null; reads?: number };
      win.reads = (win.reads ?? 0) + 1;
      const text = win.copied;
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

/** How many times the page has read the clipboard. */
async function reads(page: Page): Promise<number> {
  return page.evaluate(() => (window as { reads?: number }).reads ?? 0);
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
    await expect(sheet.getByRole('button', { name: 'Paste' })).toHaveCount(0);
    await expect(amount).toHaveAccessibleDescription('Tap to paste an amount');

    // An overdrawn balance keeps its minus.
    await copy(page, '−1.234,56 €');
    await amount.click();
    await expect(amount).toContainText('−€1,234.56');

    await copy(page, 'Total: 5');
    await amount.click();
    await expect(sheet.getByRole('alert')).toHaveText(PASTE_ERROR);
    await expect(amount).toContainText('−€1,234.56');
    // The next key clears the message.
    await sheet.getByRole('button', { name: 'Clear' }).click();
    await expect(sheet.getByRole('alert')).toHaveCount(0);

    // A dismissed Paste bubble changes nothing and says nothing.
    await copy(page, null);
    await amount.click();
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
    await amount.click();
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
    const amount = page.getByRole('button', { name: /^€/u });
    await expect(amount).toBeVisible();
    await expect(amount).toHaveAccessibleDescription('Tap to paste an amount');
    await expect(page.getByRole('button', { name: 'Paste' })).toHaveCount(0);

    // An empty amount is still the muted colour although it is a button.
    const muted = await amount.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted)';
      element.parentElement!.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(amount).toHaveCSS('color', muted);

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
    await amount.click();
    await expect(page.getByRole('alert')).toHaveText(PASTE_ERROR);

    // Banking apps show money spent as "−12,30 €"; it is not a refund.
    await copy(page, '−12,30 €');
    await amount.click();
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
    const first = page.getByRole('button', { name: /^Amount €/u });
    const arrives = page.getByRole('button', { name: /^Arrives as \$/u });
    await copy(page, '20,00 €');
    await first.click();
    await expect(first).toHaveAccessibleName('Amount €20.00');
    expect(await reads(page)).toBe(1);

    // The first tap on "Arrives as" only selects it; the next one pastes.
    await arrives.click();
    await expect(arrives).toHaveAttribute('aria-pressed', 'true');
    await expect(arrives).toHaveAccessibleDescription(
      'Tap to paste what arrives',
    );
    expect(await reads(page)).toBe(1);
    await copy(page, '$21.86');
    await arrives.click();
    await expect(arrives).toHaveAccessibleName('Arrives as $21.86. Change');
    expect(await reads(page)).toBe(2);

    // A tap on the dimmed amount only switches back and reads nothing.
    await first.click();
    await expect(arrives).toHaveAttribute('aria-pressed', 'false');
    expect(await reads(page)).toBe(2);
    // Now the amount is selected, and a tap on it pastes.
    await copy(page, '30,00');
    await first.click();
    await expect(first).toHaveAccessibleName('Amount €30.00');
    expect(await reads(page)).toBe(3);
  });
});
