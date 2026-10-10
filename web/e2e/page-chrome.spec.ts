import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const externalRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, testInfo) => {
  const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  const unexpectedRequests: string[] = [];
  externalRequests.set(page, unexpectedRequests);
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== appOrigin) {
      unexpectedRequests.push(request.url());
    }
  });
  await page.route('**/api/setup', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { needed: false } })
      : route.continue(),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'unauthenticated' } },
    }),
  );
  await page.route('**/api/auth/device', (route) =>
    route.fulfill({
      json: { defaultMember: null, hasPasskey: false },
    }),
  );
});

test.afterEach(async ({ page }) => {
  expect(externalRequests.get(page)).toEqual([]);
});

test('page backgrounds and browser theme colours match each appearance', async ({
  page,
}) => {
  const appearances = [
    { scheme: 'light', color: 'rgb(244, 243, 239)' },
    { scheme: 'dark', color: 'rgb(17, 18, 20)' },
  ] as const;

  for (const { scheme, color } of appearances) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/sign-in');

    await expect
      .poll(() =>
        page.evaluate(() => [
          getComputedStyle(document.documentElement).backgroundColor,
          getComputedStyle(document.body).backgroundColor,
        ]),
      )
      .toEqual([color, color]);

    const themeColors = await page
      .locator('meta[name="theme-color"]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          content: element.getAttribute('content'),
          media: element.getAttribute('media'),
        })),
      );
    expect(themeColors).toEqual([
      {
        content: '#F4F3EF',
        media: '(prefers-color-scheme: light)',
      },
      {
        content: '#111214',
        media: '(prefers-color-scheme: dark)',
      },
    ]);

    const viewport = await page
      .locator('meta[name="viewport"]')
      .getAttribute('content');
    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).not.toMatch(
      /(?:user-scalable\s*=\s*no|maximum-scale\s*=)/iu,
    );
  }
});

test('manipulation applies throughout the app without disabling pinch zoom', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toBeVisible();

  const touchActions = await page.evaluate(() =>
    [
      document.documentElement,
      document.body,
      document.querySelector('#app'),
      ...document.querySelectorAll('#app *'),
    ].map((element) =>
      element ? getComputedStyle(element).touchAction : null,
    ),
  );
  expect(touchActions.length).toBeGreaterThan(3);
  expect(new Set(touchActions)).toEqual(new Set(['manipulation']));

  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no/iu);
  expect(viewport).not.toMatch(/maximum-scale\s*=\s*1(?:\.0+)?(?:\s*,|$)/iu);
});

test('manipulation also preserves pinch zoom inside teleported sheets', async ({
  page,
}) => {
  await page.goto('/dev/components');
  await page.getByRole('button', { name: 'Open sheet preview' }).click();
  const sheet = page.getByRole('dialog', {
    name: 'Close the check-in now?',
  });
  await expect(sheet).toBeVisible();

  const touchActions = await sheet.evaluate((dialog) => {
    const layer = dialog.parentElement;
    if (!layer) return [];
    return [layer, ...layer.querySelectorAll('*')].map(
      (element) => getComputedStyle(element).touchAction,
    );
  });
  expect(touchActions.length).toBeGreaterThan(3);
  expect(new Set(touchActions)).toEqual(new Set(['manipulation']));
});

test('setup content clears injected top and bottom safe-area insets', async ({
  page,
}) => {
  await page.unroute('**/api/setup');
  await page.route('**/api/setup', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { needed: true } })
      : route.continue(),
  );
  await page.goto('/setup');
  const heading = page.getByRole('heading', { name: 'Set up Budget Buddy' });
  await expect(heading).toBeVisible();
  await page.addStyleTag({
    content: ':root { --safe-area-top: 47px; --safe-area-bottom: 34px; }',
  });

  const top = await heading.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  const footerPadding = await page
    .locator('.setup-footer')
    .evaluate((footer) =>
      Number.parseFloat(getComputedStyle(footer).paddingBottom),
    );
  expect(top).toBeGreaterThanOrEqual(71);
  expect(footerPadding).toBeGreaterThanOrEqual(50);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`sign-in content keeps safe top spacing in ${scheme} appearance`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/sign-in');
    await expect(
      page.getByRole('textbox', { name: 'Family password' }),
    ).toBeVisible();
    await page.addStyleTag({
      content: ':root { --safe-area-top: 47px; }',
    });

    const topSpacing = await page.getByRole('main').evaluate((main) => {
      const brand = main.firstElementChild;
      if (!(brand instanceof HTMLElement)) return null;
      return {
        brandTop: brand.getBoundingClientRect().top,
        contentTop: brand.firstElementChild?.getBoundingClientRect().top ?? -1,
        paddingTop: Number.parseFloat(getComputedStyle(brand).paddingTop),
        safeAreaTop: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--safe-area-top',
          ),
        ),
      };
    });

    expect(topSpacing).not.toBeNull();
    expect(topSpacing!.safeAreaTop).toBe(47);
    expect(topSpacing!.paddingTop).toBeGreaterThanOrEqual(
      Math.max(40, topSpacing!.safeAreaTop + 16),
    );
    expect(topSpacing!.contentTop).toBeGreaterThanOrEqual(
      topSpacing!.safeAreaTop + 16,
    );
    expect(topSpacing!.brandTop).toBeGreaterThanOrEqual(0);
  });
}

test('check-in loading and no-open content clear safe-area insets', async ({
  page,
}, testInfo) => {
  await mockAuthenticatedCheckinPage(page);
  let continueCurrentRequest: (() => void) | undefined;
  await page.route('**/api/checkins/current', async (route) => {
    await new Promise<void>((resolve) => {
      continueCurrentRequest = resolve;
    });
    await route.fulfill({ json: { checkin: null } });
  });

  await page.goto('/check-in');
  const loading = page.getByText('Loading check-in…');
  await expect(loading).toBeVisible();
  const safeAreaStyle = await page.addStyleTag({
    content: ':root { --safe-area-top: 47px; --safe-area-bottom: 34px; }',
  });
  const loadingSpacing = await loading.evaluate((element) => {
    const section = element.closest('section');
    return section instanceof HTMLElement
      ? {
          contentTop: element.getBoundingClientRect().top,
          paddingTop: Number.parseFloat(getComputedStyle(section).paddingTop),
          paddingBottom: Number.parseFloat(
            getComputedStyle(section).paddingBottom,
          ),
        }
      : null;
  });
  expect(loadingSpacing).not.toBeNull();
  expect(loadingSpacing!.paddingTop).toBeGreaterThanOrEqual(71);
  expect(loadingSpacing!.contentTop).toBeGreaterThanOrEqual(71);
  expect(loadingSpacing!.paddingBottom).toBeGreaterThanOrEqual(34);

  continueCurrentRequest?.();
  const heading = page.getByRole('heading', {
    name: 'No check-in is open',
  });
  await expect(heading).toBeVisible();
  const closedSpacing = await heading.evaluate((element) => {
    const section = element.closest('section');
    return section instanceof HTMLElement
      ? {
          headingTop: element.getBoundingClientRect().top,
          paddingTop: Number.parseFloat(getComputedStyle(section).paddingTop),
          paddingBottom: Number.parseFloat(
            getComputedStyle(section).paddingBottom,
          ),
        }
      : null;
  });
  expect(closedSpacing).not.toBeNull();
  expect(closedSpacing!.paddingTop).toBeGreaterThanOrEqual(71);
  expect(closedSpacing!.headingTop).toBeGreaterThanOrEqual(71);
  expect(closedSpacing!.paddingBottom).toBeGreaterThanOrEqual(34);
  await safeAreaStyle.evaluate((style) => style.parentNode?.removeChild(style));
  if (testInfo.project.name === 'iphone') {
    mkdirSync('test-results/screens', { recursive: true });
    await page.screenshot({
      path: 'test-results/screens/CheckIn.png',
      scale: 'css',
    });
  }
});

test('check-in error content scrolls above the safe bottom inset', async ({
  page,
}) => {
  await mockAuthenticatedCheckinPage(page);
  await page.route('**/api/checkins/current', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }),
  );
  await page.setViewportSize({ width: 390, height: 280 });
  await page.goto('/check-in');

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText(
    'Could not load the check-in. Check your connection and try again.',
  );
  await page.addStyleTag({
    content: `
      :root { --safe-area-top: 47px; --safe-area-bottom: 34px; }
      .checkin-loading::before {
        content: '';
        display: block;
        min-height: 500px;
        flex: none;
      }
    `,
  });

  const retry = page.getByRole('button', { name: 'Try again' });
  const section = alert.locator('xpath=ancestor::section');
  await expect(section).toHaveCount(1);
  await retry.scrollIntoViewIfNeeded();
  const safeBoundary = await section.evaluate((element) => {
    const section = element as HTMLElement;
    return (
      section.getBoundingClientRect().bottom -
      Number.parseFloat(getComputedStyle(section).paddingBottom)
    );
  });
  const retryBounds = await retry.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  expect(retryBounds.top).toBeGreaterThanOrEqual(0);
  expect(retryBounds.bottom).toBeLessThanOrEqual(safeBoundary + 1);
  expect(
    await section.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => ({
      documentScrollTop: document.documentElement.scrollTop,
      shellScrollTop: document.querySelector('.app-shell')?.scrollTop ?? 0,
    })),
  ).toEqual({ documentScrollTop: 0, shellScrollTop: 0 });
});

test('closing a check-in keeps its result clear of both safe areas', async ({
  page,
}) => {
  await mockAuthenticatedCheckinPage(page);
  const openedAt = Date.UTC(2026, 9, 1, 8, 0);
  const openCheckin = {
    id: 1,
    openedAt,
    openedBy: { memberId: 1, name: 'Alex' },
    scheduleSlot: null,
    closedAt: null,
    closedBy: null,
    totalAccounts: 0,
    completedAccounts: 0,
    members: [
      {
        memberId: 1,
        name: 'Alex',
        active: true,
        accounts: 0,
        completed: 0,
        done: true,
        accountList: [],
      },
    ],
    needsAccounts: true,
  };
  await page.route('**/api/checkins/current', (route) =>
    route.fulfill({ json: { checkin: openCheckin } }),
  );
  await page.route('**/api/checkins/1/close', (route) =>
    route.fulfill({
      json: {
        checkin: {
          ...openCheckin,
          closedAt: openedAt + 60_000,
          closedBy: { memberId: 1, name: 'Alex' },
        },
      },
    }),
  );
  await page.goto('/check-in');
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Close now' }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Close the check-in now?',
  });
  await confirmation.getByRole('button', { name: 'Close check-in' }).click();
  const heading = page.getByRole('heading', { name: 'Check-in complete' });
  await expect(heading).toBeVisible();
  await page.setViewportSize({ width: 390, height: 300 });
  await page.addStyleTag({
    content: ':root { --safe-area-top: 47px; --safe-area-bottom: 34px; }',
  });

  const section = heading.locator('xpath=ancestor::section');
  await expect(section).toHaveCount(1);
  const spacing = await section.evaluate((element) => {
    const section = element as HTMLElement;
    return {
      clientHeight: section.clientHeight,
      paddingBottom: Number.parseFloat(getComputedStyle(section).paddingBottom),
      paddingTop: Number.parseFloat(getComputedStyle(section).paddingTop),
      scrollHeight: section.scrollHeight,
    };
  });
  expect(spacing.paddingTop).toBeGreaterThanOrEqual(47);
  expect(spacing.paddingBottom).toBeGreaterThanOrEqual(34);
  expect(spacing.scrollHeight).toBeGreaterThan(spacing.clientHeight);
  await section.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const safeBoundary = await section.evaluate((element) => {
    const section = element as HTMLElement;
    return (
      section.getBoundingClientRect().bottom -
      Number.parseFloat(getComputedStyle(section).paddingBottom)
    );
  });
  const backHome = page.getByRole('button', { name: 'Back home' });
  const backHomeBounds = await backHome.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  expect(backHomeBounds.top).toBeGreaterThanOrEqual(0);
  expect(backHomeBounds.bottom).toBeLessThanOrEqual(safeBoundary + 1);
  expect(
    await section.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => ({
      documentScrollTop: document.documentElement.scrollTop,
      shellScrollTop: document.querySelector('.app-shell')?.scrollTop ?? 0,
    })),
  ).toEqual({ documentScrollTop: 0, shellScrollTop: 0 });
});

async function mockAuthenticatedCheckinPage(page: Page): Promise<void> {
  await page.unroute('**/api/auth/me');
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        member: { id: 1, name: 'Alex' },
        profiles: [{ id: 1, name: 'Alex' }],
        device: { defaultMemberId: 1, hasPasskey: false },
      },
    }),
  );
  await page.route('**/api/currencies', (route) =>
    route.fulfill({ json: { currencies: [], coins: [] } }),
  );
  await page.route('**/api/settings', (route) =>
    route.fulfill({
      json: { commonCurrency: 'EUR', timeZone: 'Europe/Berlin' },
    }),
  );
}
