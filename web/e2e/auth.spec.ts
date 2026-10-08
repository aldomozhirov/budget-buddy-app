import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const profiles = [
  { id: 1, name: 'Alex' },
  { id: 2, name: 'Blair' },
  { id: 3, name: 'Casey' },
];

test('wrong passwords show the remaining tries and a controlled lockout', async ({
  page,
}, testInfo) => {
  const deviceName =
    testInfo.project.name === 'iphone' ? 'this iPhone' : 'this iPad';
  await installApi(page, testInfo, {
    defaultMemberId: 1,
    wrongPasswordOnly: true,
  });
  await page.clock.install();
  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Use Face ID' })).toBeVisible();
  await expect(page.getByText(`Opens as Alex on ${deviceName}`)).toBeVisible();
  if (testInfo.project.name === 'iphone') {
    await saveScreenshot(page, 'SignIn.png');
  }

  await page.getByRole('textbox', { name: 'Family password' }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'That password doesn’t match. 2 tries before a short wait.',
  );
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toHaveAttribute('type', 'text');

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'That password doesn’t match. 1 try before a short wait.',
  );
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const waitButton = page.getByRole('button', { name: 'Wait 30 s' });
  await expect(waitButton).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText(
    'Too many tries. Try again in 30 s.',
  );
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toHaveAttribute('type', 'password');
  await expect(waitButton).toHaveCSS('background-color', 'rgb(234, 232, 226)');
  await expect(waitButton).toHaveCSS('color', 'rgb(92, 97, 104)');
  if (testInfo.project.name === 'iphone') {
    await saveScreenshot(page, 'SignInLocked.png');
  }

  await page.clock.runFor(1_000);
  await expect(page.getByRole('button', { name: 'Wait 29 s' })).toBeDisabled();
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(
    page.getByText(
      'Anyone in the family who is still signed in can set a new one in Settings → Family password. If nobody is, reset it on the Mac mini as the README describes.',
    ),
  ).toBeVisible();
  await expectExternalRequests(page, testInfo);
});

test('sign-in without a remembered profile opens the picker and records the choice', async ({
  page,
}, testInfo) => {
  const deviceName =
    testInfo.project.name === 'iphone' ? 'this iPhone' : 'this iPad';
  await installApi(page, testInfo, { defaultMemberId: null });
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Family password' })
    .fill('family password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(
    page.getByRole('heading', { name: `Who’s using ${deviceName}?` }),
  ).toBeVisible();
  await expect(
    page.getByText('New expenses and check-ins are recorded under this name.'),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Remember on this device' }),
  ).toHaveAttribute('aria-checked', 'true');
  if (testInfo.project.name === 'iphone') {
    await saveScreenshot(page, 'SignInPick.png');
  }

  await page.getByRole('radio', { name: 'Blair' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Hi, Blair' })).toBeVisible();
  await expectExternalRequests(page, testInfo);
});

test('a remembered profile opens Home and switching in the sheet changes the greeting', async ({
  page,
}, testInfo) => {
  const deviceName =
    testInfo.project.name === 'iphone' ? 'this iPhone' : 'this iPad';
  await installApi(page, testInfo, {
    defaultMemberId: 1,
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page
    .getByRole('textbox', { name: 'Family password' })
    .fill('family password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Hi, Alex' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('button', { name: 'Alex — switch profile or sign out' }),
  ).toBeVisible();
  if (testInfo.project.name === 'iphone') {
    const home = page
      .getByRole('main')
      .filter({ has: page.getByRole('heading', { name: 'Hi, Alex' }) });
    await expect
      .poll(() =>
        home.evaluate((element) => getComputedStyle(element).animationName),
      )
      .toBe('none');
    await saveScreenshot(page, 'Main.png');
  }
  await page
    .getByRole('button', { name: 'Alex — switch profile or sign out' })
    .click();
  const profileSheet = page.getByRole('dialog', {
    name: 'Who’s using the app?',
  });
  await expect(profileSheet).toBeVisible();
  await expect(
    profileSheet.getByText(`Default on ${deviceName}`),
  ).toBeVisible();
  await expect(
    profileSheet.getByRole('switch', {
      name: `Open as Alex on ${deviceName}`,
    }),
  ).toBeVisible();
  await expect(
    profileSheet.getByRole('button', { name: 'Sign out' }),
  ).toBeVisible();
  if (testInfo.project.name === 'iphone') {
    await expect
      .poll(() =>
        profileSheet.evaluate((element) => getComputedStyle(element).transform),
      )
      .toBe('matrix(1, 0, 0, 1, 0, 0)');
    await saveScreenshot(page, 'Main-profile-sheet.png');
  }

  await profileSheet.getByRole('radio', { name: 'Blair' }).click();
  await expect(profileSheet).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hi, Blair' })).toBeVisible();
  await expectExternalRequests(page, testInfo);
});

test('profile radio arrow keys switch profiles and wrap at the list edge', async ({
  page,
}, testInfo) => {
  await installApi(page, testInfo, {
    currentMemberId: 1,
    defaultMemberId: 1,
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Alex — switch profile or sign out' })
    .click();

  const profileSheet = page.getByRole('dialog', {
    name: 'Who’s using the app?',
  });
  await profileSheet.getByRole('radio', { name: 'Alex' }).press('ArrowLeft');
  await expect(profileSheet).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Hi, Casey' })).toBeVisible();
  await expectExternalRequests(page, testInfo);
});

test('an unavailable session check does not open a protected screen', async ({
  page,
}, testInfo) => {
  await installApi(page, testInfo, { defaultMemberId: 1 });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }),
  );

  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hi, Alex' })).toHaveCount(0);
  await expectExternalRequests(page, testInfo);
});

test('sign out from the profile sheet returns to sign-in', async ({
  page,
}, testInfo) => {
  let signOutBody: unknown;
  await installApi(page, testInfo, {
    currentMemberId: 1,
    defaultMemberId: 1,
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/sign-out')) {
      signOutBody = request.postDataJSON();
    }
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Alex — switch profile or sign out' })
    .click();
  const profileSheet = page.getByRole('dialog', {
    name: 'Who’s using the app?',
  });
  await profileSheet.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole('textbox', { name: 'Family password' }),
  ).toBeVisible();
  await expect(profileSheet).toBeHidden();
  expect(signOutBody).toEqual({});
  await expectExternalRequests(page, testInfo);
});

test('a failed sign-out keeps the current session and reports the error', async ({
  page,
}, testInfo) => {
  await installApi(page, testInfo, {
    currentMemberId: 1,
    defaultMemberId: 1,
  });
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Alex — switch profile or sign out' })
    .click();
  const profileSheet = page.getByRole('dialog', {
    name: 'Who’s using the app?',
  });
  await profileSheet.getByRole('button', { name: 'Sign out' }).click();

  await expect(profileSheet.getByRole('alert')).toHaveText(
    'Could not sign out. Check your connection and try again.',
  );
  await expect(profileSheet).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hi, Alex' })).toBeVisible();
  await expectExternalRequests(page, testInfo);
});

async function installApi(
  page: Page,
  testInfo: TestInfo,
  options: {
    currentMemberId?: number | null;
    defaultMemberId: number | null;
    wrongPasswordOnly?: boolean;
  },
): Promise<void> {
  const deviceLabel = testInfo.project.name === 'iphone' ? 'iPhone' : 'iPad';
  const userAgent =
    deviceLabel === 'iPhone'
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
  Object.assign(page, { __externalRequests: externalRequests });

  let currentMember = profile(options.currentMemberId ?? null);
  let defaultMemberId = options.defaultMemberId;
  let signedIn = options.currentMemberId !== undefined;
  let failedAttempts = 0;

  await page.route('**/api/setup', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { needed: false } })
      : route.continue(),
  );
  await page.route('**/api/auth/device', (route) =>
    route.fulfill({
      json: {
        defaultMember: profile(defaultMemberId),
        hasPasskey: defaultMemberId !== null,
      },
    }),
  );
  await page.route('**/api/auth/me', (route) => {
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        json: { error: { code: 'unauthenticated' } },
      });
    }
    return route.fulfill({
      json: {
        member: currentMember,
        profiles,
        device: { defaultMemberId, hasPasskey: defaultMemberId !== null },
      },
    });
  });
  await page.route('**/api/auth/sign-in', async (route) => {
    failedAttempts += 1;
    if (failedAttempts === 3) {
      return route.fulfill({
        status: 423,
        json: {
          error: {
            code: 'locked',
            message: 'Too many tries. Try again in 30 s.',
            retryAfter: 30,
            triesLeft: 0,
          },
        },
      });
    }
    if (!options.wrongPasswordOnly) {
      signedIn = true;
      currentMember = profile(defaultMemberId);
      return route.fulfill({
        status: 200,
        json: { profileRequired: currentMember === null },
      });
    }
    return route.fulfill({
      status: 401,
      json: {
        error: {
          code: 'unauthenticated',
          message: `That password doesn’t match. ${3 - failedAttempts} ${failedAttempts === 2 ? 'try' : 'tries'} before a short wait.`,
          triesLeft: 3 - failedAttempts,
        },
      },
    });
  });
  await page.route('**/api/auth/profile', async (route) => {
    const body = route.request().postDataJSON() as {
      memberId: number;
      remember: boolean;
    };
    currentMember = profile(body.memberId);
    defaultMemberId = body.remember ? body.memberId : null;
    return route.fulfill({
      json: { member: currentMember, defaultMemberId },
    });
  });
  await page.route('**/api/auth/sign-out', (route) => {
    signedIn = false;
    currentMember = null;
    return route.fulfill({ json: { signedOut: true } });
  });

  await expectExternalRequests(page, testInfo, externalRequests);
}

function profile(id: number | null): (typeof profiles)[number] | null {
  return profiles.find((entry) => entry.id === id) ?? null;
}

async function expectExternalRequests(
  _page: Page,
  _testInfo: TestInfo,
  requests?: string[],
): Promise<void> {
  expect(
    requests ??
      (_page as Page & { __externalRequests: string[] }).__externalRequests,
  ).toEqual([]);
}

async function saveScreenshot(page: Page, filename: string): Promise<void> {
  const directory = 'test-results/screens';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${filename}`, scale: 'css' });
}
