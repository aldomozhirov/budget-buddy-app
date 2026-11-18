import { type WishesResponse } from '@budget-buddy/shared';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * Home's month carousel with the Envelopes and Wishes cards (TASK-53;
 * UI-HOME-1, UI-HOME-9, UI-HOME-10, UI-NAV-2). Data is seeded through the
 * API. A swipe cannot be made with touch in Playwright's WebKit, so the
 * tests move the scroll position of the carousel, which scroll-snap then
 * settles on one card, as it does after a swipe.
 */
const CARD_KEY = 'bb.home.card';

/** The carousel's group and the scrolling track inside it. */
function carousel(page: Page): Locator {
  return page.getByRole('group', { name: 'This month' });
}

function track(page: Page): Locator {
  return carousel(page).locator('xpath=./div[1]');
}

function envelopesCard(page: Page): Locator {
  return page.getByRole('group', { name: 'Envelopes, 1 of 2' });
}

function wishesCard(page: Page): Locator {
  return page.getByRole('group', { name: 'Wishes, 2 of 2' });
}

/** The dots under the carousel; they are an aria-hidden indicator. */
function dots(page: Page): Locator {
  return carousel(page).locator('xpath=./div[2]/span');
}

/** Which dot is lit, by index, read from the DOM class of the indicator. */
async function activeDot(page: Page): Promise<number> {
  await expect(dots(page)).toHaveCount(2);
  return dots(page).evaluateAll((all) =>
    all.findIndex((dot) => dot.className.includes('active')),
  );
}

/** Scrolls the carousel to a fraction of its distance (1 is the last card). */
async function scrollTo(page: Page, fraction: number): Promise<void> {
  await track(page).evaluate((element, share) => {
    element.scrollTo({
      left: (element.scrollWidth - element.clientWidth) * share,
      behavior: 'instant',
    });
  }, fraction);
}

/** Resolves with the scroll position once it stops changing. */
async function settledScroll(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(async () => {
      const now = await track(page).evaluate((element) => element.scrollLeft);
      const stable = now === last;
      last = now;
      return stable;
    })
    .toBe(true);
  return last;
}

async function swipeToWishes(page: Page): Promise<void> {
  await scrollTo(page, 1);
  await expect(wishesCard(page)).toBeInViewport({ ratio: 0.9 });
}

async function api<T>(family: Family, route: string): Promise<T> {
  const response = await family.api.get(`${family.origin}${route}`);
  expect(response.status(), route).toBe(200);
  return (await response.json()) as T;
}

interface Seeded {
  tyres: number;
  weekend: number;
  month: string;
}

/**
 * An account, an envelope, and two open wishes of this month: tyres
 * (350.00, 120.00 spent) and a weekend away (480.00, nothing spent), so
 * €830.00 is wished.
 */
async function seed(
  family: Family,
  options = { envelope: true },
): Promise<Seeded> {
  await create(family, '/api/accounts', {
    name: 'ING Visa',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '100000',
  });
  if (options.envelope) {
    await create(family, '/api/envelopes', {
      name: 'Groceries',
      currency: 'EUR',
      monthlyAmount: '50000',
      mode: 'reset',
    });
  }
  const { month } = await api<WishesResponse>(family, '/api/wishes');
  const tyres = await create(family, '/api/wishes', {
    month,
    name: 'Winter tyres',
    amount: '35000',
    currency: 'EUR',
    categoryId: null,
  });
  const weekend = await create(family, '/api/wishes', {
    month,
    name: 'Weekend away',
    amount: '48000',
    currency: 'EUR',
    categoryId: null,
  });
  await create(family, '/api/transactions', {
    kind: 'expense',
    date: new Date().toISOString().slice(0, 10),
    accountId: 1,
    amount: '12000',
    merchant: 'Tyre shop',
    wishId: tyres,
  });
  return { tyres, weekend, month };
}

test.describe('Home’s month carousel', () => {
  test('holds two full-width cards, snaps to one and the dots follow', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);

      await expect(carousel(page)).toHaveAttribute(
        'aria-roledescription',
        'carousel',
      );
      await expect(envelopesCard(page)).toHaveAttribute(
        'aria-roledescription',
        'slide',
      );
      await expect(wishesCard(page)).toHaveAttribute(
        'aria-roledescription',
        'slide',
      );
      await expect(
        envelopesCard(page).getByRole('heading', { name: 'Envelopes' }),
      ).toBeVisible();
      await expect(
        wishesCard(page).getByRole('heading', { name: 'Wishes' }),
      ).toBeVisible();

      // Full width: each card is as wide as the carousel, side by side.
      const box = (await carousel(page).boundingBox())!;
      const first = (await envelopesCard(page).boundingBox())!;
      const second = (await wishesCard(page).boundingBox())!;
      expect(first.width).toBeCloseTo(box.width, 0);
      expect(second.width).toBeCloseTo(box.width, 0);
      expect(second.x).toBeGreaterThan(first.x + first.width - 1);
      expect(
        await track(page).evaluate(
          (element) => getComputedStyle(element).scrollSnapType,
        ),
      ).toMatch(/x\s+mandatory/u);

      // Two dots, an indicator that is not exposed or tappable.
      await expect(dots(page)).toHaveCount(2);
      // The only buttons are the wishes' ticks.
      await expect(
        carousel(page).getByRole('button', { name: /^(?!Tick off|Reopen)/u }),
      ).toHaveCount(0);
      expect(await activeDot(page)).toBe(0);
      await expect(envelopesCard(page)).toBeInViewport({ ratio: 0.9 });

      // A swipe that stops between the cards settles on one of them.
      await scrollTo(page, 0.6);
      const step = second.x - first.x;
      await expect
        .poll(async () => settledScroll(page), { timeout: 5000 })
        .toBeCloseTo(step, 0);
      await expect.poll(() => activeDot(page)).toBe(1);
      await expect(wishesCard(page)).toBeInViewport({ ratio: 0.9 });

      // And back, from a short flick that does not pass the middle.
      await scrollTo(page, 0.8);
      await expect
        .poll(async () => settledScroll(page), { timeout: 5000 })
        .toBeCloseTo(step, 0);
      await scrollTo(page, 0.3);
      await expect
        .poll(async () => settledScroll(page), { timeout: 5000 })
        .toBeCloseTo(0, 0);
      await expect.poll(() => activeDot(page)).toBe(0);
      await expect(envelopesCard(page)).toBeInViewport({ ratio: 0.9 });

      await page.screenshot({
        path:
          testInfo.project.name === 'iphone'
            ? 'test-results/screens/Main.png'
            : 'test-results/screens/Main-ipad.png',
        scale: 'css',
      });
    });
  });

  test('keeps both cards readable to a screen reader', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      // The card out of view still has its content in the page.
      await expect(wishesCard(page)).toContainText('Winter tyres');
      await expect(wishesCard(page)).toContainText('Weekend away');
      await expect(envelopesCard(page)).toContainText('Groceries');
      const tree = await page.getByRole('main').ariaSnapshot();
      expect(tree).toMatch(/group "This month"/u);
      expect(tree).toMatch(/group "Envelopes, 1 of 2"/u);
      expect(tree).toMatch(/group "Wishes, 2 of 2"/u);
    });
  });

  test('with no envelopes the Wishes card stands alone, with no dots', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family, { envelope: false });
      await page.goto(`${family.origin}/`);
      await expect(
        page.getByRole('group', { name: 'Wishes, 1 of 1' }),
      ).toBeVisible();
      await expect(
        page.getByRole('group', { name: /^Envelopes/u }),
      ).toHaveCount(0);
      await expect(dots(page)).toHaveCount(0);
    });
  });
});

test.describe('Home’s Wishes card', () => {
  test('lists the open wishes with amounts hidden, then revealed', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const { month } = await seed(family);
      await page.goto(`${family.origin}/`);
      const card = wishesCard(page);
      const monthName = new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        timeZone: 'UTC',
      }).format(new Date(`${month}-15T12:00:00Z`));
      await expect(card.getByRole('heading', { name: 'Wishes' })).toBeVisible();
      await expect(card).toContainText(monthName);

      // Hidden: dots, shares, and nothing that looks like an amount.
      await expect(card).toContainText('€ • • • •');
      await expect(card).toContainText('spent on wishes');
      await expect(card.getByRole('link')).toHaveText([
        /Winter tyres\s*34% spent/u,
        /Weekend away\s*Nothing spent yet/u,
        /2 open this month · see all wishes/u,
      ]);
      expect(await card.innerText()).not.toMatch(/[€$]\s?\d/u);
      const html = await page.content();
      for (const figure of ['120.00', '350.00', '830.00', '12000', '83000']) {
        expect(html).not.toContain(figure);
      }

      await page
        .getByRole('button', { name: 'Show amounts for 30 seconds' })
        .click();
      await expect(card).toContainText('€120.00');
      await expect(card).toContainText('spent of €830.00 wished');
      await expect(card.getByRole('link')).toHaveText([
        /Winter tyres\s*€120\.00 of €350\.00/u,
        /Weekend away\s*Nothing spent yet/u,
        /2 open this month · see all wishes/u,
      ]);
      await expect(card).not.toContainText('% spent');
      await expect(card).not.toContainText('€ • • • •');
    });
  });

  test('a row opens the wish, and Back returns to Home on the Wishes card', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const { tyres } = await seed(family);
      await page.goto(`${family.origin}/`);
      await swipeToWishes(page);
      await expect.poll(() => activeDot(page)).toBe(1);

      await wishesCard(page)
        .getByRole('link', { name: /^Winter tyres/u })
        .click();
      await expect(page).toHaveURL(`${family.origin}/wishes/${tyres}`);
      await expect(
        page.getByRole('heading', { name: 'Winter tyres', level: 1 }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Back to home' }).click();
      await expect(page).toHaveURL(`${family.origin}/`);
      await expect(carousel(page)).toBeVisible();
    });
  });

  test('the last row opens Wishes, and a wish opened there goes Back to Wishes', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const { weekend } = await seed(family);
      await page.goto(`${family.origin}/`);
      await wishesCard(page)
        .getByRole('link', { name: /2 open this month/u })
        .click();
      await expect(page).toHaveURL(`${family.origin}/wishes`);
      await expect(
        page.getByRole('heading', { name: 'Wishes', level: 1 }),
      ).toBeVisible();

      await page
        .getByRole('link', { name: /^Weekend away.*to spend/u })
        .click();
      await expect(page).toHaveURL(`${family.origin}/wishes/${weekend}`);
      await page.getByRole('button', { name: 'Back to wishes' }).click();
      await expect(page).toHaveURL(`${family.origin}/wishes`);
      await page.getByRole('button', { name: 'Back to home' }).click();
      await expect(page).toHaveURL(`${family.origin}/`);
    });
  });

  test('lists a done wish with none open, and “Plan a wish” opens Wishes', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await create(family, '/api/accounts', {
        name: 'ING Visa',
        ownerMemberId: 1,
        type: 'bank',
        currency: 'EUR',
        openingBalance: '100000',
      });
      await create(family, '/api/envelopes', {
        name: 'Groceries',
        currency: 'EUR',
        monthlyAmount: '50000',
        mode: 'reset',
      });
      // A done wish is listed but is not open this month.
      const { month } = await api<WishesResponse>(family, '/api/wishes');
      const done = await create(family, '/api/wishes', {
        month,
        name: 'Sofia’s birthday',
        amount: '15000',
        currency: 'EUR',
        categoryId: null,
      });
      const patch = await family.api.patch(
        `${family.origin}/api/wishes/${done}`,
        {
          headers: { Origin: family.origin },
          data: { state: 'done' },
        },
      );
      expect(patch.status()).toBe(200);

      await page.goto(`${family.origin}/`);
      const card = wishesCard(page);
      await expect(card).toContainText('Sofia’s birthday');
      await expect(card).toContainText('Done');
      await expect(card).not.toContainText('open this month');
      await expect(card.getByRole('link')).toHaveText([
        /Sofia’s birthday\s*Done/u,
        /Plan a wish/u,
      ]);

      await card.getByRole('link', { name: 'Plan a wish' }).click();
      await expect(page).toHaveURL(`${family.origin}/wishes`);
    });
  });
});

test.describe('Home remembers the card', () => {
  test('opens on Envelopes the first time, then on the card last in view', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      await expect(envelopesCard(page)).toBeInViewport({ ratio: 0.9 });
      expect(await activeDot(page)).toBe(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), CARD_KEY),
      ).toBe(null);

      await swipeToWishes(page);
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), CARD_KEY))
        .toBe('wishes');

      await page.reload();
      await expect(wishesCard(page)).toBeInViewport({ ratio: 0.9 });
      await expect.poll(() => activeDot(page)).toBe(1);

      await scrollTo(page, 0);
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), CARD_KEY))
        .toBe('envelopes');
      await page.reload();
      await expect(envelopesCard(page)).toBeInViewport({ ratio: 0.9 });
      expect(await activeDot(page)).toBe(0);
    });
  });

  test('an unknown remembered card falls back to Envelopes', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      await expect(envelopesCard(page)).toBeVisible();
      await page.evaluate((key) => localStorage.setItem(key, 'plan'), CARD_KEY);
      await page.reload();
      await expect(envelopesCard(page)).toBeInViewport({ ratio: 0.9 });
      expect(await activeDot(page)).toBe(0);
    });
  });

  test('a remembered Wishes card with no envelopes shows the only card', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family, { envelope: false });
      await page.goto(`${family.origin}/`);
      await page.evaluate(
        (key) => localStorage.setItem(key, 'envelopes'),
        CARD_KEY,
      );
      await page.reload();
      await expect(
        page.getByRole('group', { name: 'Wishes, 1 of 1' }),
      ).toBeInViewport({ ratio: 0.9 });
    });
  });
});

test.describe('Home’s Everything grid', () => {
  test('has no Wishes row, and a Wishes tile after Envelopes, eight in all', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      // The old row ("Wishes · 2 open this month") is gone.
      await expect(
        page.getByRole('link', { name: /^Wishes\s+\d+ open this month/u }),
      ).toHaveCount(0);

      const everything = page.getByRole('navigation', { name: 'Everything' });
      await expect(everything.getByRole('link')).toHaveText([
        'Transactions',
        'Envelopes',
        'Wishes',
        'Accounts',
        'Check-ins',
        'Wealth history',
        'Categories',
        'Settings',
      ]);
      await expect(
        everything.getByRole('link', { name: 'Wishes' }),
      ).toHaveAttribute('href', '/wishes');
      await everything.getByRole('link', { name: 'Wishes' }).click();
      await expect(page).toHaveURL(`${family.origin}/wishes`);
      await expect(
        page.getByRole('heading', { name: 'Wishes', level: 1 }),
      ).toBeVisible();
    });
  });

  test('the grid sits under the carousel and “Needs a category”', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await create(family, '/api/transactions', {
        kind: 'expense',
        date: new Date().toISOString().slice(0, 10),
        accountId: 1,
        amount: '3250',
        merchant: 'Edeka',
      });
      await page.goto(`${family.origin}/`);
      const needs = page.getByRole('link', { name: /^Needs a category/u });
      await expect(needs).toBeVisible();
      const tiles = (await page
        .getByRole('navigation', { name: 'Quick actions' })
        .boundingBox())!;
      const group = (await carousel(page).boundingBox())!;
      const needsBox = (await needs.boundingBox())!;
      const grid = (await page
        .getByRole('heading', { name: 'Everything' })
        .boundingBox())!;
      expect(group.y).toBeGreaterThanOrEqual(tiles.y + tiles.height);
      expect(needsBox.y).toBeGreaterThanOrEqual(group.y + group.height);
      expect(grid.y).toBeGreaterThanOrEqual(needsBox.y + needsBox.height);
    });
  });
});

test.describe('Home’s carousel with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('still snaps, with no sliding animation', async ({ page }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      await expect(carousel(page)).toBeVisible();
      const style = await track(page).evaluate((element) => {
        const css = getComputedStyle(element);
        return { snap: css.scrollSnapType, behavior: css.scrollBehavior };
      });
      expect(style.snap).toMatch(/x\s+mandatory/u);
      expect(style.behavior).toBe('auto');
      // No transition runs on the dots or on the cards.
      const durations = await carousel(page).evaluate((element) =>
        Array.from(element.querySelectorAll('*')).map(
          (child) => getComputedStyle(child).transitionDuration,
        ),
      );
      for (const duration of durations) {
        expect(duration.split(',').every((part) => part.trim() === '0s')).toBe(
          true,
        );
      }

      // The remembered card is in view at once, with no slide to it.
      await swipeToWishes(page);
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), CARD_KEY))
        .toBe('wishes');
      await page.reload();
      await expect(wishesCard(page)).toBeInViewport({ ratio: 0.9 });
      await expect.poll(() => activeDot(page)).toBe(1);
    });
  });
});

test.describe('Home’s Wishes card ticks', () => {
  /** The tick of the wish called `name`, open or done. */
  function tick(page: Page, name: string): Locator {
    return wishesCard(page).getByRole('button', {
      name: new RegExp(`^(Tick off ${name} as done|Reopen ${name})$`, 'u'),
    });
  }

  /** The names of the card's rows, in order. */
  async function rowNames(page: Page): Promise<string[]> {
    await expect(wishesCard(page).getByRole('button').first()).toBeVisible();
    return wishesCard(page)
      .getByRole('button', { name: /^(Tick off .* as done|Reopen .*)$/u })
      .evaluateAll((all) =>
        all.map((button) =>
          (button.getAttribute('aria-label') ?? '')
            .replace(/^Tick off /u, '')
            .replace(/ as done$/u, '')
            .replace(/^Reopen /u, ''),
        ),
      );
  }

  const toast = (page: Page): Locator => page.getByRole('status');

  test('ticks a wish off, undoes it and reopens it', async ({
    page,
  }, testInfo) => {
    await startFamily(page, async (family) => {
      const { tyres } = await seed(family);
      await page.goto(`${family.origin}/`);
      await swipeToWishes(page);
      const button = tick(page, 'Winter tyres');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);

      // Reveal the amounts, so the done line shows what was spent.
      await page
        .getByRole('button', { name: 'Show amounts for 30 seconds' })
        .click();
      await button.click();
      await expect(
        wishesCard(page).getByRole('button', {
          name: 'Reopen Winter tyres',
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(wishesCard(page)).toContainText('Done · €120.00');
      await expect(toast(page)).toContainText('Winter tyres ticked off.');
      await expect(
        wishesCard(page).getByText('Winter tyres', { exact: true }),
      ).toHaveCSS('text-decoration-line', 'line-through');
      const done = await family.api.get(`${family.origin}/api/wishes/${tyres}`);
      expect((await done.json()).wish.state).toBe('done');

      await toast(page).getByRole('button', { name: 'Undo' }).click();
      await expect(toast(page)).toContainText('Undone.');
      await expect(tick(page, 'Winter tyres')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(wishesCard(page)).not.toContainText('Done');

      // Done once more, then reopened from the card.
      await tick(page, 'Winter tyres').click();
      await expect(toast(page)).toContainText('Winter tyres ticked off.');
      await tick(page, 'Winter tyres').click();
      await expect(toast(page)).toContainText('Winter tyres reopened.');
      await expect(tick(page, 'Winter tyres')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      // The toast sits above Add expense, in the bottom bar.
      const bar = (await page
        .getByRole('link', { name: 'Add expense' })
        .boundingBox())!;
      const message = (await toast(page).boundingBox())!;
      expect(message.y + message.height).toBeLessThanOrEqual(bar.y);

      if (testInfo.project.name === 'iphone') {
        await tick(page, 'Winter tyres').click();
        await expect(toast(page)).toContainText('Winter tyres ticked off.');
        await page.reload();
        await swipeToWishes(page);
        await page.waitForTimeout(500);
        await page.screenshot({
          path: 'test-results/screens/HomeWishes.png',
          scale: 'css',
        });
      }
    });
  });

  test('a ticked wish keeps its place, then comes after the open ones', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      expect(await rowNames(page)).toEqual(['Winter tyres', 'Weekend away']);
      await tick(page, 'Winter tyres').click();
      await expect(toast(page)).toContainText('ticked off.');
      expect(await rowNames(page)).toEqual(['Winter tyres', 'Weekend away']);

      await page.goto(`${family.origin}/settings`);
      await page.goto(`${family.origin}/`);
      await expect(tick(page, 'Weekend away')).toBeVisible();
      expect(await rowNames(page)).toEqual(['Weekend away', 'Winter tyres']);
    });
  });

  test('the toast ends after 8 seconds, even when the amounts hide meanwhile', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.clock.install();
      await page.goto(`${family.origin}/`);
      await page
        .getByRole('button', { name: 'Show amounts for 30 seconds' })
        .click();
      await tick(page, 'Winter tyres').click();
      await expect(toast(page)).toContainText('ticked off.');
      // The eye hides the amounts; the toast keeps its own time.
      await page
        .getByRole('button', { name: /amounts/u })
        .first()
        .click();
      await page.clock.fastForward(8100);
      await expect(toast(page)).toHaveCount(0);
    });
  });

  test('says when someone changed the wish meanwhile', async ({ page }) => {
    await startFamily(page, async (family) => {
      const { tyres } = await seed(family);
      await page.goto(`${family.origin}/`);
      await expect(tick(page, 'Winter tyres')).toBeVisible();
      const changed = await family.api.patch(
        `${family.origin}/api/wishes/${tyres}`,
        { headers: { Origin: family.origin }, data: { state: 'done' } },
      );
      expect(changed.status()).toBe(200);
      await tick(page, 'Winter tyres').click();
      await expect(toast(page)).toContainText('Someone changed it meanwhile.');
      await expect(tick(page, 'Winter tyres')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  test('Undo after someone changed the wish says so, and the toast ends', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      const { tyres } = await seed(family);
      await page.goto(`${family.origin}/`);
      await tick(page, 'Winter tyres').click();
      await expect(toast(page)).toContainText('Winter tyres ticked off.');
      const changed = await family.api.patch(
        `${family.origin}/api/wishes/${tyres}`,
        {
          headers: { Origin: family.origin },
          data: { state: 'open', expect: { state: 'done' } },
        },
      );
      expect(changed.status()).toBe(200);
      await toast(page).getByRole('button', { name: 'Undo' }).click();
      await expect(toast(page)).toContainText('Someone changed it meanwhile.');
      await expect(toast(page).getByRole('button')).toHaveCount(0);
      await expect(tick(page, 'Winter tyres')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  test('offline the ticks are off, and a row still opens the wish', async ({
    page,
    context,
  }) => {
    await startFamily(page, async (family) => {
      const { tyres } = await seed(family);
      await page.goto(`${family.origin}/`);
      await expect(tick(page, 'Winter tyres')).toBeEnabled();
      // Open the wish once online, so its code is loaded.
      await wishesCard(page)
        .getByRole('link', { name: /^Winter tyres/u })
        .click();
      await expect(page).toHaveURL(`${family.origin}/wishes/${tyres}`);
      await page.getByRole('button', { name: 'Back to home' }).click();
      await expect(tick(page, 'Winter tyres')).toBeEnabled();
      await context.setOffline(true);
      await expect(tick(page, 'Winter tyres')).toBeDisabled();
      await expect(tick(page, 'Weekend away')).toBeDisabled();
      await wishesCard(page)
        .getByRole('link', { name: /^Winter tyres/u })
        .click();
      await expect(page).toHaveURL(`${family.origin}/wishes/${tyres}`);
      await context.setOffline(false);
    });
  });
});

test.describe('Home’s carousel with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the dots animate, so the reduced-motion test above is not vacuous', async ({
    page,
  }) => {
    await startFamily(page, async (family) => {
      await seed(family);
      await page.goto(`${family.origin}/`);
      await expect(dots(page)).toHaveCount(2);
      const durations = await dots(page).evaluateAll((all) =>
        all.map((dot) => getComputedStyle(dot).transitionDuration),
      );
      expect(durations.some((duration) => duration !== '0s')).toBe(true);
    });
  });
});
