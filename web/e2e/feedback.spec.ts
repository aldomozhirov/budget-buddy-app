import { deflateSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { create, startFamily, type Family } from './support/family.js';

/**
 * Send feedback from Settings (spec 8 task 3; UI-SET-1, UI-SET-6, UI-NAV-4,
 * FBK-1, FBK-4). The pages talk to a real server; its feedback folder is
 * read to see what arrived. The app's origin is the only one reached.
 */

const PROBLEM_HINT = 'What happened, and what did you expect?';
const IDEA_HINT = 'What would make Budget Buddy better?';
const SENT = 'Thanks! Your feedback is sent.';
const SAVED = 'Saved. It sends itself when you’re back online.';
const DRAFT = 'The total on Home looks wrong after the last expense.';

/** A real PNG (a two-colour square) that the browser can decode. */
function pngFile(
  size: number,
  color: [number, number, number],
): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => color).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { name: 'picture.png', mimeType: 'image/png', buffer };
}

interface Posted {
  kind: string;
  text: string;
  clientId: string;
  device: { type: string; fromScreen: string | null };
  screenshot: { type: string; data: string } | null;
}

/** Makes the page a phone of the project's kind, and watches its requests. */
async function watch(
  page: Page,
  testInfo: TestInfo,
): Promise<{ external: string[]; posts: Posted[]; own: Set<string> }> {
  const agent =
    testInfo.project.name === 'iphone'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
      : 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)';
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => value });
  }, agent);
  const external: string[] = [];
  const posts: Posted[] = [];
  const own = new Set([new URL(testInfo.project.use.baseURL as string).origin]);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!own.has(url.origin)) external.push(request.url());
    if (url.pathname === '/api/feedback' && request.method() === 'POST') {
      posts.push(JSON.parse(request.postData() ?? '{}') as Posted);
    }
  });
  return { external, posts, own };
}

/** Seeds an account with an expense, so Home holds amounts and a name. */
async function seed(family: Family): Promise<void> {
  const visa = await create(family, '/api/accounts', {
    name: 'ING Visa',
    ownerMemberId: 1,
    type: 'bank',
    currency: 'EUR',
    openingBalance: '123456',
  });
  await create(family, '/api/transactions', {
    kind: 'expense',
    accountId: visa,
    amount: '6420',
    merchant: 'REWE',
  });
}

/** The report folders the server holds, parsed. */
async function reports(family: Family): Promise<
  {
    id: string;
    report: Record<string, unknown>;
    files: string[];
  }[]
> {
  const dir = path.join(family.dataDirectory, 'feedback');
  const names = (await readdir(dir).catch(() => [] as string[])).filter(
    (name) => !name.startsWith('.') && name !== 'archive',
  );
  return Promise.all(
    names.map(async (id) => ({
      id,
      report: JSON.parse(
        await readFile(path.join(dir, id, 'report.json'), 'utf8'),
      ) as Record<string, unknown>,
      files: await readdir(path.join(dir, id)),
    })),
  );
}

async function openSheet(page: Page) {
  await page.getByRole('button', { name: /^Send feedback/u }).click();
  const sheet = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function saveScreen(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.waitForTimeout(600);
  const suffix = testInfo.project.name === 'iphone' ? '' : '-ipad';
  await page.screenshot({ path: `test-results/screens/${name}${suffix}.png` });
}

test('Settings ends with the Help card and its row opens the sheet', async ({
  page,
}, testInfo) => {
  const seen = await watch(page, testInfo);
  await startFamily(page, async (family) => {
    seen.own.add(family.origin);
    await seed(family);
    await page.goto(`${family.origin}/settings`);
    await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
    const headings = await page.getByRole('heading').allTextContents();
    expect(headings.at(-1)?.trim()).toBe('Help');
    const row = page.getByRole('button', { name: /^Send feedback/u });
    await expect(row).toContainText('Report a problem or suggest an idea');
    await row.scrollIntoViewIfNeeded();
    await saveScreen(page, testInfo, 'Settings');

    const sheet = await openSheet(page);
    // The sheet is over Settings: the screen stays behind it.
    await expect(
      page.getByRole('heading', { name: 'Settings' }),
    ).toBeAttached();
    await expect(
      sheet.getByRole('radio', { name: 'Something’s wrong' }),
    ).toBeChecked();
    await expect(sheet.getByRole('radio', { name: 'An idea' })).toBeVisible();
    await expect(
      sheet.getByText(
        'App version, device and screen are sent with it. Never amounts or names.',
      ),
    ).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(page.url()).toBe(`${family.origin}/settings`);
  });
  expect(seen.external).toEqual([]);
});

test('the placeholder follows the kind and Send needs 3 characters', async ({
  page,
}, testInfo) => {
  const seen = await watch(page, testInfo);
  await startFamily(page, async (family) => {
    seen.own.add(family.origin);
    await page.goto(`${family.origin}/settings`);
    const sheet = await openSheet(page);
    const text = sheet.getByRole('textbox', { name: 'Your feedback' });
    const send = sheet.getByRole('button', { name: 'Send' });
    await expect(text).toHaveAttribute('placeholder', PROBLEM_HINT);
    await sheet.getByRole('radio', { name: 'An idea' }).click();
    await expect(text).toHaveAttribute('placeholder', IDEA_HINT);
    await sheet.getByRole('radio', { name: 'Something’s wrong' }).click();
    await expect(text).toHaveAttribute('placeholder', PROBLEM_HINT);

    await text.fill('  a b  ');
    await expect(send).toBeDisabled();
    await text.fill(' \n\t   ');
    await expect(send).toBeDisabled();
    await text.fill(' a b c ');
    await expect(send).toBeEnabled();
    await text.fill('ab');
    await expect(send).toBeDisabled();
    expect(seen.posts).toEqual([]);
  });
  expect(seen.external).toEqual([]);
});

test('a screenshot shows as a tag, goes when tapped and a new pick replaces it', async ({
  page,
}, testInfo) => {
  const seen = await watch(page, testInfo);
  await startFamily(page, async (family) => {
    seen.own.add(family.origin);
    await page.goto(`${family.origin}/settings`);
    const sheet = await openSheet(page);
    const picker = sheet.locator('input[type="file"]');
    const tag = sheet.getByRole('button', { name: 'Remove the screenshot' });
    const add = sheet.getByRole('button', { name: 'Add a screenshot' });
    await expect(tag).toHaveCount(0);

    await picker.setInputFiles(pngFile(8, [200, 30, 30]));
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('Screenshot');
    await expect(add).toHaveCount(0);

    await tag.click();
    await expect(tag).toHaveCount(0);
    await expect(add).toBeVisible();

    // A second pick replaces the first: one tag, and the second picture goes.
    await picker.setInputFiles(pngFile(8, [200, 30, 30]));
    await expect(tag).toBeVisible();
    await picker.setInputFiles(pngFile(16, [30, 30, 200]));
    await expect(tag).toHaveCount(1);

    await sheet
      .getByRole('textbox', { name: 'Your feedback' })
      .fill('Second picture check');
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => seen.posts.length).toBe(1);
    expect(seen.posts[0]?.screenshot?.type).toBe('image/jpeg');

    // A file that is no picture is refused, and the sheet stays usable.
    await openSheet(page);
    await picker.setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a picture'),
    });
    await expect(sheet.getByRole('alert')).toContainText(
      'Could not read that picture',
    );
    await expect(tag).toHaveCount(0);
  });
  expect(seen.external).toEqual([]);
});

test('closing keeps the draft, a tap on the dimmed page too, a reload clears it', async ({
  page,
}, testInfo) => {
  const seen = await watch(page, testInfo);
  await startFamily(page, async (family) => {
    seen.own.add(family.origin);
    await page.goto(`${family.origin}/settings`);
    let sheet = await openSheet(page);
    await sheet.getByRole('radio', { name: 'An idea' }).click();
    await sheet.getByRole('textbox', { name: 'Your feedback' }).fill(DRAFT);
    await sheet
      .locator('input[type="file"]')
      .setInputFiles(pngFile(8, [10, 120, 10]));
    await expect(
      sheet.getByRole('button', { name: 'Remove the screenshot' }),
    ).toBeVisible();

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    sheet = await openSheet(page);
    await expect(
      sheet.getByRole('textbox', { name: 'Your feedback' }),
    ).toHaveValue(DRAFT);
    await expect(sheet.getByRole('radio', { name: 'An idea' })).toBeChecked();
    await expect(
      sheet.getByRole('button', { name: 'Remove the screenshot' }),
    ).toBeVisible();

    // A tap on the dimmed page, above the sheet.
    // The sheet is at most 88% of the height, so the top is the dimmed page.
    const bounds = await sheet.boundingBox();
    await page.touchscreen.tap(12, Math.max(1, bounds!.y / 2));
    await expect(sheet).toHaveCount(0);
    sheet = await openSheet(page);
    await expect(
      sheet.getByRole('textbox', { name: 'Your feedback' }),
    ).toHaveValue(DRAFT);

    await page.reload();
    sheet = await openSheet(page);
    await expect(
      sheet.getByRole('textbox', { name: 'Your feedback' }),
    ).toHaveValue('');
    await expect(
      sheet.getByRole('radio', { name: 'Something’s wrong' }),
    ).toBeChecked();
    await expect(
      sheet.getByRole('button', { name: 'Add a screenshot' }),
    ).toBeVisible();
    expect(seen.posts).toEqual([]);
  });
  expect(seen.external).toEqual([]);
});

test('online, Send closes and clears the sheet, thanks for 4 s, one report arrives', async ({
  page,
}, testInfo) => {
  const seen = await watch(page, testInfo);
  await page.clock.install({ time: new Date('2026-11-05T10:00:00.000Z') });
  await startFamily(page, async (family) => {
    seen.own.add(family.origin);
    await seed(family);
    await page.goto(`${family.origin}/settings`);
    let sheet = await openSheet(page);
    await sheet
      .getByRole('textbox', { name: 'Your feedback' })
      .fill(`  ${DRAFT}  `);
    await sheet
      .locator('input[type="file"]')
      .setInputFiles(pngFile(12, [180, 60, 20]));
    await expect(
      sheet.getByRole('button', { name: 'Remove the screenshot' }),
    ).toBeVisible();
    await saveScreen(page, testInfo, 'SettingsFeedback');
    // From here the page's time stands still until the test moves it.
    await page.clock.pauseAt(new Date('2026-11-05T10:05:00.000Z'));
    await sheet.getByRole('button', { name: 'Send' }).click();

    const toast = page.getByRole('status').filter({ hasText: SENT });
    await expect(toast).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await saveScreen(page, testInfo, 'SettingsFeedbackSent');
    await page.clock.runFor(3500);
    await expect(toast).toBeVisible();
    await page.clock.runFor(1000);
    await expect(toast).toHaveCount(0);

    // The sheet opens empty.
    sheet = await openSheet(page);
    await expect(
      sheet.getByRole('textbox', { name: 'Your feedback' }),
    ).toHaveValue('');
    await expect(
      sheet.getByRole('button', { name: 'Add a screenshot' }),
    ).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();

    expect(seen.posts).toHaveLength(1);
    const post = seen.posts[0]!;
    expect(post.kind).toBe('problem');
    expect(post.text).toBe(DRAFT);
    expect(post.device.type).toBe(
      testInfo.project.name === 'iphone' ? 'iPhone' : 'iPad',
    );
    expect(post.screenshot?.type).toBe('image/jpeg');
    expect(post.screenshot?.data.startsWith('/9j/')).toBe(true);
    const body = JSON.stringify(post);
    for (const secret of ['REWE', 'ING Visa', 'Alena', '1234', '64.20']) {
      expect(body).not.toContain(secret);
    }

    await expect.poll(async () => (await reports(family)).length).toBe(1);
    const [stored] = await reports(family);
    expect(stored?.id).toBe(post.clientId);
    expect(stored?.files.some((name) => name.startsWith('screenshot'))).toBe(
      true,
    );
  });
  expect(seen.external).toEqual([]);
});

test('offline, Send stays enabled and saves; online again, the report arrives once', async ({
  page,
}, testInfo) => {
  const seen = await watch(page, testInfo);
  await startFamily(page, async (family) => {
    seen.own.add(family.origin);
    await page.goto(`${family.origin}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    const sheet = await openSheet(page);
    await sheet.getByRole('radio', { name: 'An idea' }).click();
    await sheet
      .getByRole('textbox', { name: 'Your feedback' })
      .fill('Please add dark mode');
    await page.context().setOffline(true);
    const send = sheet.getByRole('button', { name: 'Send' });
    await expect(send).toBeEnabled();
    await send.click();

    await expect(
      page.getByRole('status').filter({ hasText: SAVED }),
    ).toBeVisible();
    await expect(sheet).toHaveCount(0);
    expect(await reports(family)).toHaveLength(0);

    await page.context().setOffline(false);
    await expect.poll(async () => (await reports(family)).length).toBe(1);
    // Give the periodic and event-driven resends time to show a duplicate.
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(500);
    const stored = await reports(family);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.report).toMatchObject({
      kind: 'idea',
      text: 'Please add dark mode',
    });
    expect(stored[0]?.files.some((name) => name.startsWith('screenshot'))).toBe(
      false,
    );
  });
  expect(seen.external).toEqual([]);
});
