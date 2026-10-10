import { expect, test } from '@playwright/test';

const componentHarness = 'http://127.0.0.1:4174/e2e/fixtures/amount-input.html';

test.beforeEach(async ({ page }) => {
  await page.goto(componentHarness);
  await expect(
    page.getByRole('heading', { name: 'Amount input component harness' }),
  ).toBeVisible();
});

test('the keypad evaluates an expression and displays its live result', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of ['1', '2', 'Plus', '3', 'Multiply', '2']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
  }

  await expect(page.getByText('12+3×2', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€18.00',
  );
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('status')).toHaveText('€18.00');
});

test('a trailing operator keeps the last result without an error or saving', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of ['1', 'Plus']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
  }

  await expect(page.getByText('1+', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€1.00',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('an open bracket keeps the last complete result without an error', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of ['Open bracket', '1', 'Plus', '2']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
  }

  await expect(page.getByText('(1+2', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€3.00',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('leading operators are ignored without an error or saving', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of ['Multiply', 'Divide', 'Plus', 'Percent']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Enter an amount', exact: true }),
    ).toBeDisabled();
  }

  await expect(
    page.getByRole('group', { name: 'Amount', exact: true }).getByText(/[×÷+%]/),
  ).toHaveCount(0);
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€0.00',
  );
});

test('a decimal point alone stays quiet and cannot be saved', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad
    .getByRole('button', { name: 'Decimal point', exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('a decimal point after a trailing operator stays quiet and cannot be saved', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: 'Plus', exact: true }).click();
  await keypad
    .getByRole('button', { name: 'Decimal point', exact: true })
    .click();

  await expect(page.getByText('1+.', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€1.00',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('a stray close bracket shows the bracket error and cannot be saved', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad
    .getByRole('button', { name: 'Close bracket', exact: true })
    .click();

  await expect(page.getByRole('alert')).toHaveText(
    'Can’t calculate that. Check the brackets.',
  );
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('division by zero shows its specific error and cannot be saved', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of ['5', 'Divide', '0']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
  }

  await expect(page.getByRole('alert')).toHaveText('Can’t divide by zero.');
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('C clears the whole expression and disables saving', async ({ page }) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: '2', exact: true }).click();
  await keypad.getByRole('button', { name: 'Clear', exact: true }).click();

  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€0.00',
  );
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('⌫ removes one character and recomputes the result', async ({ page }) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: '2', exact: true }).click();
  await keypad.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€1.00',
  );
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled();
});

test('a leading minus is unavailable when negative amounts are disallowed', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  const minus = keypad.getByRole('button', { name: 'Minus', exact: true });
  await expect(minus).toBeDisabled();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€0.00',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('group', { name: 'Amount', exact: true }).focus();
  await page.keyboard.press('-');
  await expect(
    page.getByRole('group', { name: 'Amount', exact: true }).getByText('−', {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€0.00',
  );
});

test('a leading minus is accepted when negative amounts are allowed', async ({
  page,
}) => {
  await page.goto(`${componentHarness}?allowNegative=true`);
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  const minus = keypad.getByRole('button', { name: 'Minus', exact: true });
  await expect(minus).toBeEnabled();
  await minus.click();
  await keypad.getByRole('button', { name: '1', exact: true }).click();

  await expect(page.getByText('−1', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '−€1.00',
  );
});

test('hardware minus cannot add a forbidden unary minus after an open bracket', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: 'Plus', exact: true }).click();
  await keypad
    .getByRole('button', { name: 'Open bracket', exact: true })
    .click();
  await expect(keypad.getByRole('button', { name: 'Minus' })).toBeDisabled();

  await page.getByRole('group', { name: 'Amount', exact: true }).focus();
  await page.keyboard.press('-');

  await expect(page.getByText('1+(', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('overflow has a distinct error and cannot be saved', async ({ page }) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (let digit = 0; digit < 17; digit += 1) {
    await keypad.getByRole('button', { name: '9', exact: true }).click();
  }

  await expect(page.getByRole('alert')).toHaveText('Amount is too large');
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();
});

test('Control and Command copy shortcuts preserve the expression', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  for (const key of ['1', '2', 'Plus', '3']) {
    await keypad.getByRole('button', { name: key, exact: true }).click();
  }
  const display = page.getByRole('group', { name: 'Amount', exact: true });
  await display.focus();

  await page.keyboard.press('Control+c');
  await expect(page.getByText('12+3', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€15.00',
  );

  await page.keyboard.press('Meta+c');
  await expect(page.getByText('12+3', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€15.00',
  );
});

test('Start from last seeds the previous balance before a change', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Start from last' }).click();
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: 'Plus', exact: true }).click();
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: '2', exact: true }).click();
  await keypad.getByRole('button', { name: '0', exact: true }).click();

  await expect(page.getByText('123.45+120', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€243.45',
  );
});

test('hardware keyboard input maps to keypad expression symbols', async ({
  page,
}) => {
  const display = page.getByRole('group', { name: 'Amount', exact: true });
  await display.focus();
  await page.keyboard.type('12+3*2');

  await expect(page.getByText('12+3×2', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€18.00',
  );
});

test('the keypad has the specified four rows of five controls', async ({
  page,
}) => {
  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  const buttons = keypad.getByRole('button');
  await expect(buttons).toHaveCount(20);
  const names = [
    '7',
    '8',
    '9',
    'Open bracket',
    'Close bracket',
    '4',
    '5',
    '6',
    'Multiply',
    'Divide',
    '1',
    '2',
    '3',
    'Plus',
    'Minus',
    'Decimal point',
    '0',
    'Percent',
    'Delete',
    'Clear',
  ];
  for (const [index, name] of names.entries()) {
    await expect(buttons.nth(index)).toHaveAccessibleName(name);
  }
});

test('key controls meet the minimum 44 by 44 touch target', async ({
  page,
}) => {
  const undersized = await page
    .getByRole('group', { name: 'Amount keypad' })
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const bounds = button.getBoundingClientRect();
        return bounds.width < 44 || bounds.height < 44
          ? [`${button.textContent?.trim()}: ${bounds.width}×${bounds.height}`]
          : [];
      }),
    );

  expect(undersized).toEqual([]);
});

test('tapping the amount display does not open a native keyboard', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'iPhone viewport requirement');

  await page.getByRole('group', { name: 'Amount', exact: true }).tap();

  await expect(
    page.locator('input, textarea, [contenteditable="true"]'),
  ).toHaveCount(0);
  expect(
    await page.locator('[inputmode]').count(),
    'no element may request a system keyboard',
  ).toBe(0);
  expect(
    await page.evaluate(() => document.activeElement?.tagName),
    'a native text input must not receive focus',
  ).not.toMatch(/^(INPUT|TEXTAREA)$/);
});

test('captures the amount input at the iPhone viewport', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'iPhone screenshot requirement');

  const keypad = page.getByRole('group', { name: 'Amount keypad' });
  await keypad.getByRole('button', { name: '1', exact: true }).click();
  await keypad.getByRole('button', { name: 'Plus', exact: true }).click();
  await expect(page.getByText('1+', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
    '€1.00',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enter an amount', exact: true }),
  ).toBeDisabled();

  await page.screenshot({
    path: 'test-results/screens/AmountInput.png',
    scale: 'css',
  });
});
