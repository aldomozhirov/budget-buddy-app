import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const initialProfiles = [
  { id: 1, name: 'Alena', active: true },
  { id: 2, name: 'Max', active: true },
  { id: 3, name: 'Sofia', active: true },
];

test('Settings shows every section in order and matches the screen copy', async ({
  page,
}, testInfo) => {
  const { externalRequests } = await installSettingsApi(page, testInfo);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alena' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('button', { name: 'Add profile' })
        .evaluate((button) => getComputedStyle(button).fontWeight),
    )
    .toBe('600');

  expect(
    (await page.getByRole('heading').allTextContents()).map((text) =>
      text.trim(),
    ),
  ).toEqual([
    'Settings',
    'Profiles',
    'Sign-in',
    'Check-in',
    'Money',
    'This device',
    'Data',
  ]);
  for (const label of [
    'Family password',
    'Unlock with Face ID',
    'Schedule',
    'Follow-up reminders',
    'Common currency',
    'Currencies and coins',
    'Exchange rates',
    'Time zone',
    'Off · the in-app banner still shows',
    'Tap the eye to show them for 30 s',
    'Notifications',
    'Hide amounts on Home',
    'Sign out',
    'Backup',
    'Export all data',
  ]) {
    await expect(page.getByText(label)).toBeVisible();
  }
  await expect(
    page.getByText(
      'Budget Buddy · runs on your Mac mini · only reachable in your Tailscale network',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText('One password for everyone')).toBeVisible();
  await expect(page.getByText('To profiles with accounts left')).toBeVisible();
  await expect(page.getByText('Totals across currencies')).toBeVisible();
  await expect(page.getByText('CSV files in one .zip')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Common currency/u }),
  ).toBeVisible();
  await expect(page.getByText('EUR', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Currencies and coins/u }),
  ).toBeVisible();
  await expect(page.getByText('BTC, ETH, USDT', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Time zone/u })).toBeVisible();
  await expect(page.getByText('Europe/Berlin', { exact: true })).toBeVisible();
  await expect(page.getByText('—', { exact: true })).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'Spending' })).toHaveCount(0);

  const screenshotPath =
    testInfo.project.name === 'iphone'
      ? 'test-results/screens/Settings.png'
      : 'test-results/screens/Settings-ipad.png';
  await mkdir('test-results/screens', { recursive: true });
  await page.screenshot({ path: screenshotPath, scale: 'css' });
  expect(externalRequests).toEqual([]);
});

test('Exchange rates shows when rates were fetched and opens a read-only status sheet', async ({
  page,
}, testInfo) => {
  const { externalRequests } = await installSettingsApi(page, testInfo);
  await page.goto('/settings');
  const row = page.getByRole('button', { name: /Exchange rates/u });
  await expect(row).toContainText('Updated today 06:00');

  await row.click();
  const sheet = page.getByRole('dialog', { name: 'Exchange rates' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Updated today 06:00');

  const currencies = sheet.getByRole('group', {
    name: 'Latest rate per currency',
  });
  const usd = currencies.locator('.row', { hasText: 'USD' });
  await expect(usd).toContainText('European Central Bank');
  await expect(usd).toContainText('Today');
  await expect(usd.getByText('Stale')).toHaveCount(0);
  const rub = currencies.locator('.row', { hasText: 'RUB' });
  await expect(rub).toContainText('Bank of Russia · 3 days old');
  await expect(rub).toContainText('06/10/2026');
  await expect(rub.getByText('Stale')).toHaveCount(0);
  const gbp = currencies.locator('.row', { hasText: 'GBP' });
  await expect(gbp).toContainText('No rate yet');
  await expect(gbp.getByText('Stale')).toBeVisible();

  const feeds = sheet.getByRole('group', { name: 'Price feeds' });
  await expect(
    feeds.locator('.row', { hasText: 'European Central Bank' }),
  ).toContainText('Last answer: today 06:00');
  const failing = feeds.locator('.row', { hasText: 'Bank of Russia' });
  await expect(failing).toContainText('Last answer: yesterday 06:00');
  await expect(feeds.getByRole('alert')).toHaveText(
    'Last error: www.cbr.ru could not be reached: fetch failed',
  );

  // Let the sheet finish sliding up before the picture is taken.
  await page.waitForTimeout(600);
  await mkdir('test-results/screens', { recursive: true });
  await page.screenshot({
    path: `test-results/screens/Settings-rates-${testInfo.project.name}.png`,
    scale: 'css',
  });

  // Read-only: nothing to type into and no row to tap, only Close.
  await expect(sheet.locator('input, textarea, select')).toHaveCount(0);
  await expect(sheet.locator('.row').first()).not.toHaveJSProperty(
    'tagName',
    'BUTTON',
  );
  await sheet
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
  await expect(sheet).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test('Exchange rates explains an empty status and survives an unavailable one', async ({
  page,
}, testInfo) => {
  const { ratesStatus } = await installSettingsApi(page, testInfo);
  ratesStatus.value = {
    ...defaultRatesStatus(),
    lastUpdatedAt: null,
    currencies: [],
    feeds: [],
  };
  await page.goto('/settings');
  const row = page.getByRole('button', { name: /Exchange rates/u });
  await expect(row).toContainText('Not updated yet');
  await row.click();
  const sheet = page.getByRole('dialog', { name: 'Exchange rates' });
  await expect(sheet).toContainText('No rates fetched yet');
  await expect(sheet).toContainText(
    'Only EUR is in use, so no rates are needed.',
  );
  await sheet
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();

  await page.route('**/api/rates/status', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'internal' } } }),
  );
  await page.reload();
  const unavailable = page.getByRole('button', { name: /Exchange rates/u });
  await expect(unavailable).toBeDisabled();
  await expect(unavailable).toContainText('—');
});

test('Settings scrolls its content without scrolling the shell or document', async ({
  page,
}, testInfo) => {
  const { externalRequests } = await installSettingsApi(page, testInfo);
  await page.route('**/api/members', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            members: Array.from({ length: 40 }, (_, index) => ({
              id: index + 1,
              name: `Profile ${index + 1}`,
              active: true,
            })),
          },
        })
      : route.continue(),
  );
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.addStyleTag({
    content: ':root { --safe-area-bottom: 34px; }',
  });

  const main = page.getByRole('main');
  const content = main.locator(':scope > div');
  const innerScroll = await content.evaluate((element) => ({
    clientHeight: element.clientHeight,
    paddingBottom: Number.parseFloat(getComputedStyle(element).paddingBottom),
    scrollHeight: element.scrollHeight,
  }));
  expect(innerScroll.scrollHeight).toBeGreaterThan(innerScroll.clientHeight);
  expect(innerScroll.paddingBottom).toBeGreaterThanOrEqual(34);

  const dimensions = await page.evaluate(() => {
    const shell = document.querySelector('main')?.parentElement;
    if (!(shell instanceof HTMLElement)) return null;
    return {
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollTop: document.documentElement.scrollTop,
      shellClientHeight: shell.clientHeight,
      shellScrollHeight: shell.scrollHeight,
      shellScrollTop: shell.scrollTop,
    };
  });
  expect(dimensions).not.toBeNull();
  expect(dimensions!.documentScrollHeight).toBeLessThanOrEqual(
    dimensions!.documentClientHeight,
  );
  expect(dimensions!.shellScrollHeight).toBeLessThanOrEqual(
    dimensions!.shellClientHeight,
  );

  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(
    await content.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => {
      const shell = document.querySelector('main')?.parentElement;
      return {
        documentScrollTop: document.documentElement.scrollTop,
        shellScrollTop: shell instanceof HTMLElement ? shell.scrollTop : null,
      };
    }),
  ).toEqual({ documentScrollTop: 0, shellScrollTop: 0 });
  expect(externalRequests).toEqual([]);
});

test('profiles can be added, renamed, deactivated, and are hidden from the picker', async ({
  page,
}, testInfo) => {
  const settingsApi = await installSettingsApi(page, testInfo);
  const { externalRequests } = settingsApi;
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Alena' })).toBeVisible();

  await page.getByRole('button', { name: 'Add profile' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add profile' });
  await addDialog.getByRole('textbox', { name: 'Profile name' }).fill('Casey');
  await addDialog.getByRole('button', { name: 'Add profile' }).click();
  await expect(page.getByRole('button', { name: 'Casey' })).toBeVisible();

  await page.getByRole('button', { name: 'Casey' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit profile' });
  await editDialog
    .getByRole('textbox', { name: 'Profile name' })
    .fill('Jordan');
  await editDialog.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Jordan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Casey' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Jordan' }).click();
  await page
    .getByRole('dialog', { name: 'Edit profile' })
    .getByRole('button', { name: 'Deactivate profile' })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Deactivate this profile?',
  });
  await expect(
    confirmation.getByText(
      'Their accounts and history will stay. This profile can’t be opened until it’s reactivated.',
    ),
  ).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Keep profile active' })
    .click();
  await expect(page.getByRole('button', { name: 'Jordan' })).toBeVisible();

  await page.getByRole('button', { name: 'Jordan' }).click();
  await page
    .getByRole('dialog', { name: 'Edit profile' })
    .getByRole('button', { name: 'Deactivate profile' })
    .click();
  settingsApi.rejectNextDeactivation();
  const rejectionDialog = page.getByRole('dialog', {
    name: 'Deactivate this profile?',
  });
  await rejectionDialog
    .getByRole('button', { name: 'Deactivate profile' })
    .click();
  await expect(rejectionDialog.getByRole('alert')).toHaveText(
    'At least one profile must stay active.',
  );
  await expect(rejectionDialog).toBeVisible();
  await rejectionDialog
    .getByRole('button', { name: 'Deactivate profile' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Jordan, inactive' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page
    .getByRole('textbox', { name: 'Family password' })
    .fill('family password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: /Who’s using this (iPhone|iPad)\?/ }),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Alena' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Casey' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Jordan' })).toHaveCount(0);

  await page.getByRole('radio', { name: 'Alena' }).click();
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Jordan, inactive' }).click();
  await page
    .getByRole('dialog', { name: 'Edit profile' })
    .getByRole('button', { name: 'Reactivate profile' })
    .click();
  await expect(page.getByRole('button', { name: 'Jordan' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Jordan, inactive' }),
  ).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test('profile refresh failures stay visible on Settings and can be retried', async ({
  page,
}, testInfo) => {
  const settingsApi = await installSettingsApi(page, testInfo);
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Alena' })).toBeVisible();

  settingsApi.failNextAuthRefresh();
  await page.getByRole('button', { name: 'Add profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add profile' });
  await dialog.getByRole('textbox', { name: 'Profile name' }).fill('Casey');
  await dialog.getByRole('button', { name: 'Add profile' }).click();

  const refreshError = page.getByRole('alert');
  await expect(refreshError).toContainText(
    'Your profile change was saved, but Settings could not refresh. Check your connection and try again.',
  );
  await expect(
    refreshError.getByRole('button', { name: 'Try again' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Casey' })).toHaveCount(0);

  await refreshError.getByRole('button', { name: 'Try again' }).click();
  await expect(refreshError).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Casey' })).toBeVisible();
});

test('money rows open common-currency and coin sheets', async ({
  page,
}, testInfo) => {
  const settingsApi = await installSettingsApi(page, testInfo);
  await page.goto('/settings');

  await page.getByRole('button', { name: /Common currency/u }).click();
  const currencySheet = page.getByRole('dialog', { name: 'Common currency' });
  await expect(
    currencySheet.getByRole('button', { name: 'BTC, Bitcoin' }),
  ).toBeVisible();
  await expect(
    currencySheet.getByRole('button', { name: 'ETH, Ethereum' }),
  ).toHaveCount(0);
  await currencySheet
    .getByRole('searchbox', { name: 'Search currencies' })
    .fill('USD');
  await expect(
    currencySheet.getByRole('button', { name: 'USD, United States Dollar' }),
  ).toBeVisible();
  await currencySheet
    .getByRole('button', { name: 'USD, United States Dollar' })
    .click();
  await expect(currencySheet).toBeHidden();
  await expect(page.getByText('USD', { exact: true })).toBeVisible();
  expect(settingsApi.settings.commonCurrency).toBe('USD');

  await page.getByRole('button', { name: /Currencies and coins/u }).click();
  const coinsSheet = page.getByRole('dialog', { name: 'Currencies and coins' });
  await expect(
    coinsSheet.getByRole('button', { name: 'Bitcoin, BTC, in use' }),
  ).toBeVisible();
  await coinsSheet
    .getByRole('button', { name: 'Bitcoin, BTC, in use' })
    .click();
  const bitcoinEditor = page.getByRole('dialog', { name: 'Edit BTC' });
  await expect(
    bitcoinEditor.getByText('This coin is in use and can’t be deleted.'),
  ).toBeVisible();
  await expect(
    bitcoinEditor.getByRole('button', { name: 'Delete coin' }),
  ).toHaveCount(0);
  await bitcoinEditor.getByRole('button', { name: 'Close' }).first().click();
  await expect(bitcoinEditor).toBeHidden();
  await expect(coinsSheet).toBeVisible();
  await expect(
    coinsSheet.getByRole('button', { name: 'Bitcoin, BTC, in use' }),
  ).toBeVisible();

  await coinsSheet.getByRole('button', { name: 'Add coin' }).click();
  const coinEditor = page.getByRole('dialog', { name: 'Add coin' });
  await expect(
    coinEditor.getByText('Stored with at most 8 decimals', { exact: true }),
  ).toBeVisible();
  await coinEditor.getByRole('textbox', { name: 'Coin code' }).fill('DOGE');
  await coinEditor.getByRole('textbox', { name: 'Coin name' }).fill('Dogecoin');
  await coinEditor
    .getByRole('spinbutton', { name: 'Coin decimals' })
    .fill('18');
  await coinEditor.getByRole('button', { name: 'Add coin' }).click();
  await expect(coinEditor.getByRole('alert')).toHaveText(
    'Stored with at most 8 decimals',
  );
  expect(settingsApi.coinCreateRequests()).toBe(0);

  await coinEditor.getByRole('textbox', { name: 'Coin code' }).fill('USD');
  await coinEditor.getByRole('spinbutton', { name: 'Coin decimals' }).fill('2');
  await coinEditor.getByRole('button', { name: 'Add coin' }).click();
  await expect(coinEditor.getByRole('alert')).toHaveText(
    'Use a code that is not an ISO currency.',
  );

  await coinEditor.getByRole('textbox', { name: 'Coin code' }).fill('DOGE');
  await coinEditor.getByRole('spinbutton', { name: 'Coin decimals' }).fill('8');
  await coinEditor.getByRole('button', { name: 'Add coin' }).click();
  await expect(coinEditor).toBeHidden();
  await expect(
    coinsSheet.getByRole('button', { name: /Dogecoin, DOGE/u }),
  ).toBeVisible();
  expect(settingsApi.coinCreateRequests()).toBe(2);

  await coinsSheet.getByRole('button', { name: 'Dogecoin, DOGE' }).click();
  const dogecoinEditor = page.getByRole('dialog', { name: 'Edit DOGE' });
  await dogecoinEditor.getByRole('button', { name: 'Delete coin' }).click();
  const deleteConfirmation = page.getByRole('dialog', { name: 'Delete DOGE?' });
  await deleteConfirmation.getByRole('button', { name: 'Delete coin' }).click();
  await expect(deleteConfirmation).toBeHidden();
  await expect(dogecoinEditor).toBeHidden();
  await expect(coinsSheet).toBeVisible();
  await expect(
    coinsSheet.getByRole('button', { name: /Dogecoin, DOGE/u }),
  ).toHaveCount(0);
  expect(settingsApi.coinDeleteRequests()).toEqual([
    { code: 'DOGE', contentType: 'application/json', body: {} },
  ]);
});

test('Escape closes the coin editor but leaves its list open', async ({
  page,
}, testInfo) => {
  await installSettingsApi(page, testInfo);
  await page.goto('/settings');
  await page.getByRole('button', { name: /Currencies and coins/u }).click();
  const coinsSheet = page.getByRole('dialog', { name: 'Currencies and coins' });
  await coinsSheet
    .getByRole('button', { name: 'Bitcoin, BTC, in use' })
    .click();
  const bitcoinEditor = page.getByRole('dialog', { name: 'Edit BTC' });
  await expect(bitcoinEditor).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(bitcoinEditor).toBeHidden();
  await expect(coinsSheet).toBeVisible();
});

test('time-zone picker searches IANA names and reports no matches', async ({
  page,
}, testInfo) => {
  const settingsApi = await installSettingsApi(page, testInfo);
  await page.goto('/settings');
  await page.getByRole('button', { name: /Time zone/u }).click();

  const timeZoneSheet = page.getByRole('dialog', { name: 'Time zone' });
  const search = timeZoneSheet.getByRole('searchbox', {
    name: 'Search time zones',
  });
  await search.fill('New_York');
  await expect(
    timeZoneSheet.getByRole('button', { name: 'America/New_York' }),
  ).toBeVisible();
  await expect(
    timeZoneSheet.getByRole('button', { name: 'Europe/Berlin' }),
  ).toHaveCount(0);

  await search.fill('No/Such_Zone');
  await expect(timeZoneSheet.getByRole('status')).toHaveText(
    'No time zones found.',
  );

  await search.fill('New_York');
  await timeZoneSheet.getByRole('button', { name: 'America/New_York' }).click();
  await expect(timeZoneSheet).toBeHidden();
  await expect(
    page.getByText('America/New_York', { exact: true }),
  ).toBeVisible();
  expect(settingsApi.settings.timeZone).toBe('America/New_York');
  expect(settingsApi.externalRequests).toEqual([]);
});

test('family password sheet explains the change and validates both passwords', async ({
  page,
}, testInfo) => {
  const { externalRequests } = await installSettingsApi(page, testInfo);
  let passwordRequests = 0;
  await page.route('**/api/family/password', async (route) => {
    passwordRequests += 1;
    const body = route.request().postDataJSON() as {
      currentPassword: string;
      newPassword: string;
    };
    return body.currentPassword === 'family password'
      ? route.fulfill({ json: { changed: true } })
      : route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'validation',
              message: 'The current password doesn’t match.',
              fields: {
                currentPassword: 'The current password doesn’t match.',
              },
            },
          },
        });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Family password' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change family password' });
  await expect(
    dialog.getByText(
      'Everyone uses the new one. Other phones and iPads are signed out and ask for it next time.',
    ),
  ).toBeVisible();

  await dialog
    .getByRole('textbox', { name: 'Current password' })
    .fill('family password');
  await dialog.getByRole('textbox', { name: 'New password' }).fill('short');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Use at least 10 characters.',
  );
  expect(passwordRequests).toBe(0);

  await dialog
    .getByRole('textbox', { name: 'New password' })
    .fill('a new family password');
  await dialog
    .getByRole('textbox', { name: 'Current password' })
    .fill('incorrect password');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'The current password doesn’t match.',
  );

  await dialog
    .getByRole('textbox', { name: 'Current password' })
    .fill('family password');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Family password changed.');
  expect(passwordRequests).toBe(2);
  expect(externalRequests).toEqual([]);
});

async function installSettingsApi(
  page: Page,
  testInfo: TestInfo,
): Promise<{
  externalRequests: string[];
  rejectNextDeactivation: () => void;
  failNextAuthRefresh: () => void;
  coinCreateRequests: () => number;
  coinDeleteRequests: () => Array<{
    code: string;
    contentType: string | undefined;
    body: unknown;
  }>;
  settings: { commonCurrency: string; timeZone: string };
  ratesStatus: { value: unknown };
}> {
  const userAgent =
    testInfo.project.name === 'iphone'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
      : 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)';
  await page.addInitScript((agent) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => agent });
  }, userAgent);
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  const members = initialProfiles.map((member) => ({ ...member }));
  let signedIn = true;
  let selectedMemberId: number | null = 1;
  let nextMemberId = 4;
  let rejectNextDeactivation = false;
  let failNextAuthRefresh = false;
  let coinCreateRequests = 0;
  const coinDeleteRequests: Array<{
    code: string;
    contentType: string | undefined;
    body: unknown;
  }> = [];
  const settings = { commonCurrency: 'EUR', timeZone: 'Europe/Berlin' };
  const ratesStatus = { value: defaultRatesStatus() as unknown };
  let coins = [
    { code: 'BTC', name: 'Bitcoin', decimals: 8, inUse: true },
    { code: 'ETH', name: 'Ethereum', decimals: 8, inUse: false },
    { code: 'USDT', name: 'Tether', decimals: 6, inUse: false },
  ];
  let currencies = [
    { code: 'EUR', name: 'Euro', decimals: 2, kind: 'fiat', symbol: '€' },
    {
      code: 'USD',
      name: 'United States Dollar',
      decimals: 2,
      kind: 'fiat',
      symbol: '$',
    },
    {
      code: 'GBP',
      name: 'British Pound',
      decimals: 2,
      kind: 'fiat',
      symbol: '£',
    },
    { code: 'BTC', name: 'Bitcoin', decimals: 8, kind: 'coin', symbol: '₿' },
    { code: 'ETH', name: 'Ethereum', decimals: 8, kind: 'coin', symbol: 'ETH' },
    { code: 'USDT', name: 'Tether', decimals: 6, kind: 'coin', symbol: 'USDT' },
  ];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const activeProfiles = () =>
      members
        .filter((member) => member.active)
        .map(({ id, name }) => ({ id, name }));
    const currentMember = () =>
      activeProfiles().find((member) => member.id === selectedMemberId) ?? null;

    if (url.pathname === '/api/setup' && method === 'GET') {
      return route.fulfill({ json: { needed: false } });
    }
    if (url.pathname === '/api/rates/status' && method === 'GET') {
      return route.fulfill({ json: ratesStatus.value });
    }
    if (url.pathname === '/api/settings' && method === 'GET') {
      return route.fulfill({ json: { ...settings } });
    }
    if (url.pathname === '/api/settings' && method === 'PATCH') {
      const body = request.postDataJSON() as {
        commonCurrency?: string;
        timeZone?: string;
      };
      if (body.commonCurrency) settings.commonCurrency = body.commonCurrency;
      if (body.timeZone) settings.timeZone = body.timeZone;
      return route.fulfill({ json: { ...settings } });
    }
    if (url.pathname === '/api/currencies' && method === 'GET') {
      return route.fulfill({ json: { currencies, coins } });
    }
    if (url.pathname === '/api/coins' && method === 'POST') {
      coinCreateRequests += 1;
      const body = request.postDataJSON() as {
        code: string;
        name: string;
        decimals: number;
      };
      if (['EUR', 'USD', 'GBP'].includes(body.code)) {
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'validation',
              message: 'A coin code cannot match an ISO currency.',
              fields: { code: 'Use a code that is not an ISO currency.' },
            },
          },
        });
      }
      const coin = { ...body, inUse: false };
      coins = [...coins, coin].sort((left, right) =>
        left.code.localeCompare(right.code),
      );
      currencies = [
        ...currencies,
        {
          code: coin.code,
          name: coin.name,
          decimals: coin.decimals,
          kind: 'coin',
          symbol: coin.code,
        },
      ];
      return route.fulfill({ status: 201, json: { coin } });
    }
    const coinPath = url.pathname.match(/^\/api\/coins\/([^/]+)$/u);
    if (coinPath && method === 'DELETE') {
      const code = decodeURIComponent(coinPath[1] ?? '');
      coinDeleteRequests.push({
        code,
        contentType: request.headers()['content-type'],
        body: request.postDataJSON(),
      });
      if (coins.find((coin) => coin.code === code)?.inUse) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conflict',
              message: 'This coin is in use and cannot be deleted.',
            },
          },
        });
      }
      coins = coins.filter((coin) => coin.code !== code);
      currencies = currencies.filter((currency) => currency.code !== code);
      return route.fulfill({ json: { deleted: true } });
    }
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      if (failNextAuthRefresh) {
        failNextAuthRefresh = false;
        return route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable' } },
        });
      }
      if (!signedIn) {
        return route.fulfill({
          status: 401,
          json: { error: { code: 'unauthenticated' } },
        });
      }
      return route.fulfill({
        json: {
          member: currentMember(),
          profiles: activeProfiles(),
          device: { defaultMemberId: 1, hasPasskey: false },
        },
      });
    }
    if (url.pathname === '/api/members' && method === 'GET') {
      return route.fulfill({ json: { members } });
    }
    if (url.pathname === '/api/members' && method === 'POST') {
      const body = request.postDataJSON() as { name: string };
      const member = { id: nextMemberId++, name: body.name, active: true };
      members.push(member);
      return route.fulfill({ status: 201, json: { member } });
    }
    const memberMatch = url.pathname.match(/^\/api\/members\/(\d+)$/u);
    if (memberMatch && method === 'PATCH') {
      const memberId = Number(memberMatch[1]);
      const member = members.find((candidate) => candidate.id === memberId);
      if (!member) {
        return route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', message: 'Profile not found.' } },
        });
      }
      const body = request.postDataJSON() as {
        name?: string;
        active?: boolean;
      };
      if (body.active === false && rejectNextDeactivation) {
        rejectNextDeactivation = false;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conflict',
              message: 'At least one profile must stay active.',
            },
          },
        });
      }
      if (body.name !== undefined) member.name = body.name;
      if (body.active !== undefined) member.active = body.active;
      return route.fulfill({ json: { member } });
    }
    if (url.pathname === '/api/auth/sign-out' && method === 'POST') {
      signedIn = false;
      selectedMemberId = null;
      return route.fulfill({ json: { signedOut: true } });
    }
    if (url.pathname === '/api/auth/device' && method === 'GET') {
      return route.fulfill({
        json: { defaultMember: null, hasPasskey: false },
      });
    }
    if (url.pathname === '/api/auth/sign-in' && method === 'POST') {
      signedIn = true;
      selectedMemberId = null;
      return route.fulfill({ json: { profileRequired: true } });
    }
    if (url.pathname === '/api/auth/profile' && method === 'POST') {
      const body = request.postDataJSON() as { memberId: number };
      selectedMemberId = body.memberId;
      const member = currentMember();
      return member
        ? route.fulfill({ json: { member, defaultMemberId: body.memberId } })
        : route.fulfill({
            status: 403,
            json: { error: { code: 'forbidden_state' } },
          });
    }
    if (url.pathname === '/api/family/password' && method === 'PUT') {
      const body = request.postDataJSON() as {
        currentPassword: string;
        newPassword: string;
      };
      return body.currentPassword === 'family password'
        ? route.fulfill({ json: { changed: true } })
        : route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'validation',
                message: 'Check the password fields.',
                fields: {
                  currentPassword: 'The current password doesn’t match.',
                },
              },
            },
          });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'Not found' } },
    });
  });

  return {
    externalRequests,
    rejectNextDeactivation: () => {
      rejectNextDeactivation = true;
    },
    failNextAuthRefresh: () => {
      failNextAuthRefresh = true;
    },
    coinCreateRequests: () => coinCreateRequests,
    coinDeleteRequests: () => coinDeleteRequests,
    settings,
    ratesStatus,
  };
}

/** Rates status for Friday 09/10/2026: fetched at 06:00 Berlin time. */
function defaultRatesStatus() {
  const fetchedAt = Date.parse('2026-10-09T04:00:00Z');
  return {
    today: '2026-10-09',
    timeZone: 'Europe/Berlin',
    commonCurrency: 'EUR',
    lastUpdatedAt: fetchedAt,
    currencies: [
      {
        code: 'GBP',
        latestDate: null,
        ageDays: null,
        source: null,
      },
      {
        code: 'RUB',
        latestDate: '2026-10-06',
        ageDays: 3,
        source: 'Bank of Russia',
      },
      {
        code: 'USD',
        latestDate: '2026-10-09',
        ageDays: 0,
        source: 'European Central Bank',
      },
    ],
    feeds: [
      {
        id: 'ecb',
        name: 'European Central Bank',
        lastFetchAt: fetchedAt,
        lastSuccessAt: fetchedAt,
        lastError: null,
      },
      {
        id: 'cbr',
        name: 'Bank of Russia',
        lastFetchAt: fetchedAt,
        lastSuccessAt: Date.parse('2026-10-08T04:00:00Z'),
        lastError: {
          message: 'www.cbr.ru could not be reached: fetch failed',
          at: fetchedAt,
        },
      },
    ],
  };
}
