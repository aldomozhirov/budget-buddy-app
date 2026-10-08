import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('the Home screen shows its placeholder navigation and fits the viewport', async ({
  page,
}, testInfo) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).origin !==
      new URL(testInfo.project.use.baseURL as string).origin
    ) {
      externalRequests.push(request.url());
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Everything', level: 2 }),
  ).toBeVisible();
  const everything = page.getByRole('navigation', { name: 'Everything' });
  await expect(everything.getByRole('link')).toHaveCount(4);
  expect(
    await everything.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
    ),
  ).toBe(2);
  await expect(page.getByRole('link', { name: 'Accounts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Check-ins' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Wealth history' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const screen = await page.getByRole('main').boundingBox();
  expect(screen).not.toBeNull();
  expect(screen?.width).toBeLessThanOrEqual(640);
  expect(
    Math.abs(
      (screen?.x ?? 0) + (screen?.width ?? 0) / 2 - (viewport?.width ?? 0) / 2,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(externalRequests).toEqual([]);

  const screenshotDirectory = 'test-results/screens';
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: `${screenshotDirectory}/Home-${testInfo.project.name}.png`,
    scale: 'css',
  });
  if (testInfo.project.name === 'iphone') {
    await page.screenshot({
      path: `${screenshotDirectory}/Main.png`,
      scale: 'css',
    });
  }
});

test('Home remains usable in a desktop-width browser', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    const everything = page.getByRole('navigation', { name: 'Everything' });
    await expect(everything.getByRole('link')).toHaveCount(4);
    const content = await page.getByRole('main').boundingBox();
    expect(content?.width).toBeLessThanOrEqual(640);
    expect(
      Math.abs((content?.x ?? 0) + (content?.width ?? 0) / 2 - 720),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1440);
  } finally {
    await context.close();
  }
});

test('all Design section 8 routes load their placeholder screen', async ({
  page,
}) => {
  const routes = [
    ['/setup', 'First start'],
    ['/sign-in', 'Sign in'],
    ['/check-in', 'Check-in'],
    ['/check-ins', 'Check-ins'],
    ['/check-ins/1', 'Check-in summary'],
    ['/accounts', 'Accounts'],
    ['/accounts/1', 'Account'],
    ['/accounts/new', 'New account'],
    ['/settings', 'Settings'],
  ] as const;

  for (const [route, title] of routes) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
});

test('Home to Accounts and Back returns Home with the destination label', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  const back = page.getByRole('button', { name: 'Back to home' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('reloading a summary preserves Home as the next Wealth history Back target', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Wealth history' }).click();
  await expect(page).toHaveURL(/\/check-ins\/1$/);
  await expect(
    page.getByRole('heading', { name: 'Check-in summary' }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Check-in summary' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.getByRole('link', { name: 'Wealth history' }).click();
  await expect(page).toHaveURL(/\/check-ins\/1$/);
  const back = page.getByRole('button', { name: 'Back to home' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('browser Back from Accounts returns Home with a back transition', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const animations: string[] = [];
    Object.assign(window, { __screenAnimations: animations });
    document.addEventListener(
      'animationstart',
      (event) => animations.push((event as AnimationEvent).animationName),
      true,
    );
    document.addEventListener(
      'animationend',
      (event) =>
        animations.push(`ended:${(event as AnimationEvent).animationName}`),
      true,
    );
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __screenAnimations: string[] }
        ).__screenAnimations.includes('ended:bb-in-fwd'),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (
      window as unknown as { __screenAnimations: string[] }
    ).__screenAnimations.length = 0;
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __screenAnimations: string[] })
            .__screenAnimations,
      ),
    )
    .toContain('bb-in-back');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __screenAnimations: string[] })
          .__screenAnimations,
    ),
  ).not.toContain('bb-in-fwd');
});

test('an interrupted push cannot cancel the Back screen transition', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  const accounts = page
    .getByRole('main')
    .filter({ has: page.getByRole('heading', { name: 'Accounts' }) });
  await expect(
    accounts.getByRole('heading', { name: 'Accounts' }),
  ).toBeVisible();

  await page.clock.runFor(250);
  await expect(accounts).toHaveClass(/enter-fwd/);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(/\/$/);
  const home = page
    .getByRole('main')
    .filter({ has: page.getByRole('heading', { name: 'Home' }) });
  await expect(home).toHaveClass(/enter-back/);

  await page.clock.runFor(220);
  await expect(home).toHaveClass(/enter-back/);
});

test('a directly opened summary keeps its title and content during fallback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const starts: {
      name: string;
      headings: string[];
      content: string[];
    }[] = [];
    Object.assign(window, { __screenAnimationStarts: starts });
    document.addEventListener(
      'animationstart',
      (event) => {
        const mains = Array.from(document.querySelectorAll('main'));
        starts.push({
          name: (event as AnimationEvent).animationName,
          headings: mains.map(
            (main) => main.querySelector('h1')?.textContent?.trim() ?? '',
          ),
          content: mains.map(
            (main) => main.querySelector('p')?.textContent?.trim() ?? '',
          ),
        });
      },
      true,
    );
  });

  await page.goto('/check-ins/1');
  const back = page.getByRole('button', { name: 'Back to check-ins' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/check-ins$/);
  await expect(page.getByRole('heading', { name: 'Check-ins' })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __screenAnimationStarts: {
              name: string;
              headings: string[];
              content: string[];
            }[];
          }
        ).__screenAnimationStarts.find((event) => event.name === 'bb-in-back'),
      ),
    )
    .toMatchObject({
      headings: expect.arrayContaining(['Check-in summary', 'Check-ins']),
      content: expect.arrayContaining([
        'Check-in summary is not available yet.',
        'Check-ins is not available yet.',
      ]),
    });
});

test('a directly opened account also uses its natural parent', async ({
  page,
}) => {
  await page.goto('/accounts/42');
  const back = page.getByRole('button', { name: 'Back to accounts' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/accounts$/);
});

test('the Home sheet closes with Close and remains open when its content is tapped', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example sheet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Example sheet' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByText('This placeholder sheet can be dismissed without leaving Home.')
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});

test('the Home sheet closes when the dimmed area is tapped', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open example sheet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Example sheet' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(10, Math.max(1, (box?.y ?? 1) / 2));
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('reduced motion prevents screen animations and transitions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const events: string[] = [];
    Object.assign(window, { __motionEvents: events });
    document.addEventListener(
      'animationstart',
      (event) =>
        events.push(`animation:${(event as AnimationEvent).animationName}`),
      true,
    );
    document.addEventListener(
      'transitionrun',
      () => events.push('transition'),
      true,
    );
  });
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { __motionEvents: string[] }).__motionEvents.length =
      0;
  });
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __motionEvents: string[] }).__motionEvents,
    ),
  ).toEqual([]);
  const animation = await page.getByRole('main').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.animationDuration, style.transitionDuration];
  });
  expect(animation).toEqual(['0s', '0s']);

  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __motionEvents: string[] }).__motionEvents,
    ),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Open example sheet' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Example sheet' }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __motionEvents: string[] }).__motionEvents,
    ),
  ).toEqual([]);
});

test('normal push and Back animate with opaque screens coexisting', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const events: {
      name: string;
      headings: string[];
      backgroundColor: string;
    }[] = [];
    Object.assign(window, { __motionEvents: events });
    document.addEventListener(
      'animationstart',
      (event) => {
        const target = event.target as Element;
        events.push({
          name: (event as AnimationEvent).animationName,
          headings: Array.from(document.querySelectorAll('main h1')).map(
            (heading) => heading.textContent?.trim() ?? '',
          ),
          backgroundColor: getComputedStyle(target).backgroundColor,
        });
      },
      true,
    );
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __motionEvents: {
              name: string;
              headings: string[];
              backgroundColor: string;
            }[];
          }
        ).__motionEvents.some((event) => event.name === 'bb-in-fwd'),
      ),
    )
    .toBe(true);
  const forward = await page.evaluate(() =>
    (
      window as unknown as {
        __motionEvents: {
          name: string;
          headings: string[];
          backgroundColor: string;
        }[];
      }
    ).__motionEvents.find((event) => event.name === 'bb-in-fwd'),
  );
  expect(forward?.headings).toEqual(
    expect.arrayContaining(['Home', 'Accounts']),
  );
  expect(
    isOpaqueComputedColor(forward?.backgroundColor),
    `push background: ${forward?.backgroundColor}`,
  ).toBe(true);
  await expect(page.getByRole('heading', { name: 'Home' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __motionEvents: {
              name: string;
              headings: string[];
              backgroundColor: string;
            }[];
          }
        ).__motionEvents.some((event) => event.name === 'bb-in-back'),
      ),
    )
    .toBe(true);
  const back = await page.evaluate(() =>
    (
      window as unknown as {
        __motionEvents: {
          name: string;
          headings: string[];
          backgroundColor: string;
        }[];
      }
    ).__motionEvents.find((event) => event.name === 'bb-in-back'),
  );
  expect(back?.headings).toEqual(expect.arrayContaining(['Accounts', 'Home']));
  expect(
    isOpaqueComputedColor(back?.backgroundColor),
    `Back background: ${back?.backgroundColor}`,
  ).toBe(true);
});

function isOpaqueComputedColor(color: string | undefined): boolean {
  const channelText = color?.match(/^rgba?\((.*)\)$/)?.[1];
  if (!channelText) return false;
  const channels = channelText.split(',');
  if (channels.length < 3) return false;
  const alpha = channels.length === 4 ? Number(channels[3]) : 1;
  return alpha === 1;
}
