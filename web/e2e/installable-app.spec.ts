import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

// The worker runs only here and in service-worker.spec.ts.
test.use({ serviceWorkers: 'allow' });

const password = 'correct horse battery staple';
const offlineText = 'You’re offline. Showing what was loaded last.';

let server: ChildProcess | undefined;
let dataDirectory: string | undefined;
let origin: string;
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-installable-e2e-'),
  );
  server = spawn(process.execPath, ['server/dist/index.js'], {
    env: {
      ...process.env,
      APP_ORIGIN: origin,
      BACKUP_DIR: path.join(dataDirectory, 'backups'),
      DATA_DIR: dataDirectory,
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      PORT: String(port),
      RATES_FEED: 'fixture',
    },
    stdio: 'ignore',
  });
  await waitForServer(`${origin}/api/health`, server);
  externalRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async () => {
  const requestsMadeOffOrigin = externalRequests;
  await stopServer();
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
  expect(requestsMadeOffOrigin).toEqual([]);
});

test('serves a manifest for a standalone app with 192 and 512 icons', async ({
  page,
}) => {
  await page.goto(`${origin}/sign-in`);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');

  const response = await page.request.get(`${origin}${href}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/json/u);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'Budget Buddy',
    short_name: 'Budget Buddy',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  });

  const sizes: string[] = [];
  for (const icon of manifest.icons as Array<{
    src: string;
    sizes: string;
    type: string;
  }>) {
    expect(icon.type).toBe('image/png');
    const image = await page.request.get(`${origin}${icon.src}`);
    expect(image.status(), icon.src).toBe(200);
    expect(image.headers()['content-type']).toBe('image/png');
    const size = pngSize(await image.body());
    expect(`${size.width}x${size.height}`, icon.src).toBe(icon.sizes);
    sizes.push(icon.sizes);
  }
  expect(sizes.sort()).toEqual(['192x192', '512x512']);

  // The Home Screen icon of iOS: 180 px, named in the page.
  const touch = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute('href');
  expect(touch).toBe('/apple-touch-icon.png');
  const touchImage = await page.request.get(`${origin}${touch}`);
  expect(touchImage.status()).toBe(200);
  expect(pngSize(await touchImage.body())).toEqual({ width: 180, height: 180 });
});

test('the page asks to be a full-screen app with the theme colours of the design', async ({
  page,
}) => {
  await page.goto(`${origin}/sign-in`);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover/u,
  );
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute('content', 'yes');

  const manifest = await (
    await page.request.get(`${origin}/manifest.webmanifest`)
  ).json();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // `--bg` of the design system is the colour behind the app.
    const background = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.bb')!)
        .getPropertyValue('--bg')
        .trim(),
    );
    const meta = await page
      .locator(
        `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
      )
      .getAttribute('content');
    expect(meta?.toLowerCase(), scheme).toBe(background.toLowerCase());
    if (scheme === 'light') {
      expect(manifest.theme_color.toLowerCase()).toBe(background.toLowerCase());
      expect(manifest.background_color.toLowerCase()).toBe(
        background.toLowerCase(),
      );
    }
  }
});

test('keeps the app shell and the fonts in one cache and never an API answer', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await waitForControl(page);
  // Data requests made while the worker is in charge.
  await page.evaluate(async () => {
    await fetch('/api/accounts');
    await fetch('/api/auth/me');
  });

  const saved = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(new URL(request.url).pathname);
      }
    }
    return { names, urls };
  });
  expect(saved.names).toHaveLength(1);
  expect(saved.urls).toContain('/index.html');
  expect(saved.urls).toContain('/manifest.webmanifest');
  expect(saved.urls).toContain('/icons/icon-192.png');
  expect(saved.urls).toContain('/icons/icon-512.png');
  expect(saved.urls).toContain('/apple-touch-icon.png');
  expect(saved.urls.filter((url) => url.endsWith('.woff2'))).toHaveLength(4);
  expect(
    saved.urls.filter((url) => url.endsWith('.js')).length,
  ).toBeGreaterThan(0);
  expect(saved.urls.filter((url) => url.startsWith('/api'))).toEqual([]);

  // Update path: the browser must always ask the server for a new worker and
  // a new page, so a stale shell cannot stay for ever.
  for (const file of ['/sw.js', '/index.html']) {
    const response = await page.request.get(`${origin}${file}`);
    expect(response.headers()['cache-control'], file).toMatch(/max-age=0/u);
  }
});

test('a reload without a connection opens the app and says it is offline', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await page.goto(`${origin}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await waitForControl(page);

  // No server and a browser that reports "offline": only the saved shell
  // can answer.
  await goOffline(page);
  await page.reload();

  await expect(page.getByText(offlineText)).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: offlineText }),
  ).toHaveCount(1);
  // The app itself runs: the router, the screen and the design system.
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // The fonts come from the saved shell too.
  const fonts = await page.evaluate(async () => {
    const faces = await Promise.all(
      ['400', '500', '600', '700'].map((weight) =>
        document.fonts.load(`${weight} 16px Geist`),
      ),
    );
    return faces.map((list) => list.map((face) => face.status));
  });
  expect(fonts).toEqual([['loaded'], ['loaded'], ['loaded'], ['loaded']]);

  // The shell answers every address of the app, and /api is never answered
  // from a cache: it fails.
  await page.goto(`${origin}/check-ins`);
  await expect(page.getByText(offlineText)).toBeVisible();
  const api = await page.evaluate(async () => {
    try {
      await fetch('/api/accounts');
      return 'answered';
    } catch {
      return 'failed';
    }
  });
  expect(api).toBe('failed');
});

test('signing in is disabled when the app opens offline', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await context.clearCookies();
  await page.goto(`${origin}/sign-in`);
  await waitForControl(page);
  await goOffline(page);
  await page.goto(`${origin}/sign-in`);

  await expect(page.getByText(offlineText)).toBeVisible();
  await page.getByLabel('Family password').fill(password);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('disables the actions that need the server offline, and enables them online', async ({
  page,
  context,
}) => {
  const seed = await seedFamily(context);
  const checks: Array<{
    screen: string;
    prepare?: () => Promise<void>;
    targets: () => Locator[];
  }> = [
    {
      screen: '/settings',
      targets: () => [
        page.getByRole('switch', { name: 'Hide amounts on Home' }),
        page.getByRole('button', { name: 'Sign out' }),
      ],
    },
    {
      screen: '/settings',
      prepare: async () => {
        await page.getByRole('button', { name: /Add profile/u }).click();
        await page.getByLabel('Profile name').fill('Sam');
      },
      targets: () => [
        page.getByRole('dialog').getByRole('button', { name: 'Add profile' }),
      ],
    },
    {
      screen: '/settings',
      prepare: async () => {
        await page.getByRole('button', { name: /Family password/u }).click();
      },
      targets: () => [page.getByRole('button', { name: 'Change password' })],
    },
    {
      screen: '/settings',
      prepare: async () => {
        await page.getByRole('button', { name: /^Schedule/u }).click();
      },
      targets: () => [page.getByRole('button', { name: 'Done' })],
    },
    {
      screen: '/settings',
      prepare: async () => {
        await page.getByRole('button', { name: /^Time zone/u }).click();
      },
      targets: () => [
        page.getByRole('dialog').getByRole('button', { name: 'Europe/Berlin' }),
      ],
    },
    {
      screen: '/',
      prepare: async () => {
        await page
          .getByRole('button', { name: /switch profile or sign out/u })
          .click();
      },
      targets: () => [
        page.getByRole('radio', { name: 'Max' }),
        page.getByRole('button', { name: 'Sign out', exact: true }),
      ],
    },
    {
      screen: '/check-ins',
      targets: () => [
        page.getByRole('button', { name: 'Start a check-in now' }),
      ],
    },
    {
      screen: '/accounts/new',
      prepare: async () => {
        await page.getByLabel('Name', { exact: true }).fill('Savings');
      },
      targets: () => [page.getByRole('button', { name: 'Save', exact: true })],
    },
    {
      screen: `/accounts/${seed.account}`,
      prepare: async () => {
        await page.getByRole('button', { name: 'Account settings' }).click();
      },
      targets: () => [
        page.getByRole('button', { name: 'Save settings' }),
        page.getByRole('button', { name: 'Deactivate account' }),
      ],
    },
  ];

  for (const check of checks) {
    await page.goto(`${origin}${check.screen}`);
    await check.prepare?.();
    for (const target of check.targets()) {
      await expect(target, `${check.screen} online`).toBeEnabled();
    }
    // Going offline in the page, without a reload.
    await context.setOffline(true);
    await expect(page.getByText(offlineText)).toBeVisible();
    for (const target of check.targets()) {
      await expect(target, `${check.screen} offline`).toBeDisabled();
    }
    await context.setOffline(false);
    await expect(page.getByText(offlineText)).toHaveCount(0);
    for (const target of check.targets()) {
      await expect(target, `${check.screen} back online`).toBeEnabled();
    }
  }
});

test('an open check-in cannot be changed or closed offline', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await post(context, '/api/checkins', {});
  await page.goto(`${origin}/check-in`);
  const same = page.getByRole('button', { name: /unchanged$/u }).first();
  const close = page.getByRole('button', { name: 'Close now' });
  await expect(same).toBeEnabled();
  await expect(close).toBeEnabled();
  await context.setOffline(true);
  await expect(same).toBeDisabled();
  await expect(close).toBeDisabled();
  await context.setOffline(false);
  await expect(close).toBeEnabled();
});

test('what was loaded stays on screen offline, and the note goes when the connection returns', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
  await expect(page.getByText(offlineText)).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByText(offlineText)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(offlineText)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hi, Alena' })).toBeVisible();
});

test('content stays clear of the notch and the home indicator', async ({
  page,
  context,
}) => {
  const seed = await seedFamily(context);
  await post(context, '/api/checkins', {});
  const inset = { top: 59, bottom: 34 };
  const screens = [
    '/',
    '/accounts',
    '/accounts/new',
    '/check-ins',
    '/check-in',
    '/settings',
    `/accounts/${seed.account}`,
  ];
  for (const screen of screens) {
    await page.goto(`${origin}${screen}`);
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await simulateInset(page, inset);
    const edges = await contentEdges(page);
    expect(edges.top, `${screen}: top of the header`).toBeGreaterThanOrEqual(
      inset.top,
    );
    expect(
      edges.footerBottom,
      `${screen}: footer above the home indicator`,
    ).toBeLessThanOrEqual(edges.viewportHeight - inset.bottom);
  }

  // Sign-in is a full-screen page of its own.
  await context.clearCookies();
  await page.goto(`${origin}/sign-in`);
  await expect(page.locator('main').first()).toBeVisible();
  await simulateInset(page, inset);
  expect((await contentEdges(page)).top, 'sign-in').toBeGreaterThanOrEqual(
    inset.top,
  );
});

test('offline, the note takes the notch and the screen starts below it', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await page.goto(`${origin}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const inset = { top: 59, bottom: 34 };
  await simulateInset(page, inset);
  await context.setOffline(true);
  await expect(page.getByText(offlineText)).toBeVisible();

  const note = await page.getByText(offlineText).boundingBox();
  expect(note!.y).toBeGreaterThanOrEqual(inset.top);
  const heading = await page
    .getByRole('heading', { name: 'Settings' })
    .boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(note!.y + note!.height);
  // The screen below the note is no taller than what is left of the window,
  // so the page does not start to scroll because of the note.
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')!;
    return shell.scrollHeight - shell.clientHeight;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the offline note follows the design: warn colours, 13 px, 10 px corners, 16 px icon', async ({
  page,
  context,
}) => {
  await seedFamily(context);
  await page.goto(`${origin}/settings`);
  await context.setOffline(true);
  const note = page.getByRole('status').filter({ hasText: offlineText });
  await expect(note).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const style = await note.evaluate((element) => {
      const read = (name: string) =>
        getComputedStyle(document.querySelector('.bb')!)
          .getPropertyValue(name)
          .trim();
      const computed = getComputedStyle(element);
      const swatch = document.createElement('span');
      document.body.append(swatch);
      const colour = (value: string) => {
        swatch.style.color = value;
        return getComputedStyle(swatch).color;
      };
      const result = {
        background: computed.backgroundColor,
        expectedBackground: colour(read('--warn-soft')),
        color: computed.color,
        expectedColor: colour(read('--warn')),
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        radius: computed.borderTopLeftRadius,
        icon: element.querySelector('svg')?.getBoundingClientRect().width,
      };
      swatch.remove();
      return result;
    });
    expect(style.background, scheme).toBe(style.expectedBackground);
    expect(style.color, scheme).toBe(style.expectedColor);
    expect(style.fontSize).toBe('13px');
    expect(style.fontWeight).toBe('500');
    expect(style.radius).toBe('10px');
    expect(style.icon).toBe(16);
  }
});

/**
 * The highest edge of anything a member reads or taps on the screen, and the
 * lowest edge of its footer, if it has one.
 */
async function contentEdges(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('main') ?? document.body;
    // Anything that shows text or can be tapped; backgrounds do not count.
    const items = root.querySelectorAll(
      'h1, h2, p, label, button, a, input, select, textarea, [role="status"]',
    );
    let top = Infinity;
    let footerBottom = 0;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      if (rect.width === 0 || rect.height === 0) continue;
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      top = Math.min(top, rect.top);
      if (item.closest('footer')) {
        footerBottom = Math.max(footerBottom, rect.bottom);
      }
    }
    return { top, footerBottom, viewportHeight: window.innerHeight };
  });
}

/** Stands in for a notch and a home indicator, which a browser cannot have. */
async function simulateInset(
  page: Page,
  inset: { top: number; bottom: number },
) {
  await page.addStyleTag({
    content: `:root { --inset-top: ${inset.top}px; --inset-bottom: ${inset.bottom}px; }`,
  });
  // Layout settles (screens measure themselves after a frame).
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
  );
}

/** Waits until the page is controlled by a worker that has saved the shell. */
async function waitForControl(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        return (
          navigator.serviceWorker.controller !== null &&
          (await caches.keys()).length > 0
        );
      }),
    )
    .toBe(true);
}

/** Reads the size from a PNG's header. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Takes the server away and makes the browser report "offline" from the next
 * page load on. Playwright's own `setOffline` fails a navigation before the
 * service worker can answer it in WebKit, so it is used only for changes
 * inside a loaded page.
 */
async function goOffline(page: Page): Promise<void> {
  await stopServer();
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
  });
}

async function stopServer(): Promise<void> {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => undefined);
  }
  server = undefined;
}

/** A family with one signed-in profile and one account. */
async function seedFamily(
  context: BrowserContext,
): Promise<{ account: number }> {
  await post(context, '/api/setup', {
    password,
    passwordConfirmation: password,
    profiles: ['Alena', 'Max'],
  });
  await post(context, '/api/auth/profile', { memberId: 1, remember: true });
  const created = await post(context, '/api/accounts', {
    name: 'ING Extra-Konto',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '50000',
  });
  return { account: created.account.id as number };
}

async function post(
  context: BrowserContext,
  url: string,
  data: unknown,
): Promise<{ account: { id: number }; checkin: { id: number } }> {
  const response = await context.request.post(`${origin}${url}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.status(), `POST ${url}`).toBeLessThan(300);
  return response.json();
}

async function availablePort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a port');
  }
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}
