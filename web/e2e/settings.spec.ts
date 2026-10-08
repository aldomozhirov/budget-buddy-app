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
  await expect(page.getByText('—', { exact: true })).toHaveCount(11);
  await expect(page.getByRole('heading', { name: 'Spending' })).toHaveCount(0);

  const screenshotPath =
    testInfo.project.name === 'iphone'
      ? 'test-results/screens/Settings.png'
      : 'test-results/screens/Settings-ipad.png';
  await mkdir('test-results/screens', { recursive: true });
  await page.screenshot({ path: screenshotPath, scale: 'css' });
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
  await expect(refreshError.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Casey' })).toHaveCount(0);

  await refreshError.getByRole('button', { name: 'Try again' }).click();
  await expect(refreshError).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Casey' })).toBeVisible();
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
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      if (failNextAuthRefresh) {
        failNextAuthRefresh = false;
        return route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
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
  };
}
