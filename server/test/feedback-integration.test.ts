import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reopenLockAfterMs } from '@budget-buddy/shared';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { writeReportFolder } from '../src/modules/feedback/folder.js';

/**
 * Feedback on the server (spec 8, Design 1 to 3): `POST /api/feedback` writes
 * each report as a folder of files, once per `clientId`, never half written.
 */
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const password = 'correct horse battery staple';
const asRoot = process.getuid?.() === 0 || process.platform === 'win32';

const id = '3f0c1a2b-4d5e-4f60-8a71-92b3c4d5e6f7';
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('made-up picture bytes'),
]);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('made-up picture bytes'),
]);

const device = {
  type: 'iPhone',
  os: 'iOS 26.1',
  display: 'standalone',
  fromScreen: '/transactions/412',
  userAgent: 'Mozilla/5.0 (iPhone; made up)',
};
const body = (extra: Record<string, unknown> = {}) => ({
  clientId: id,
  kind: 'problem',
  text: '  The chart looks odd  ',
  writtenAt: '2026-11-04T18:12:03.120Z',
  device,
  screenshot: null,
  ...extra,
});
const picture = (type: string, bytes: Buffer) => ({
  type,
  data: bytes.toString('base64'),
});

describe('POST /api/feedback', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let feedbackDir: string;
  let now: number;
  let logs: string[];
  let cookie: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-feedback-'));
    feedbackDir = join(directory, 'feedback');
    database = new Database(join(directory, 'family.sqlite'));
    database.pragma('foreign_keys = ON');
    now = Date.parse('2026-11-04T18:20:41.002Z');
    logs = [];
    await migrateDatabase(database, {
      backupDir: directory,
      migrationsFolder,
    });
    app = await makeApp({ feedbackDir });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: jsonHeaders,
      payload: {
        password,
        passwordConfirmation: password,
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(setup.statusCode).toBe(201);
    cookie = cookieHeader(setup);
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await chmod(feedbackDir, 0o755).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  function makeApp(options: { feedbackDir?: string; appCommit?: string }) {
    return createApp({
      database,
      loggerStream: { write: (line) => logs.push(line) },
      appOrigins: [origin],
      secureCookies: false,
      clock: { now: () => new Date(now) },
      ...options,
    });
  }

  function send(
    payload: unknown,
    headers: Record<string, string> = { ...jsonHeaders, cookie },
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers,
      payload: payload as object,
    });
  }

  const folders = async () =>
    (await readdir(feedbackDir).catch(() => [])).sort();

  describe('a new report', () => {
    it('answers 201 and writes report.json from the server and the session', async () => {
      await app.close();
      app = await makeApp({ feedbackDir, appCommit: '4bc9837abc' });
      const response = await send(body());

      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toEqual({ id });
      expect(await readdir(join(feedbackDir, id))).toEqual(['report.json']);
      const report = JSON.parse(
        await readFile(join(feedbackDir, id, 'report.json'), 'utf8'),
      );
      expect(report).toEqual({
        version: 1,
        id,
        kind: 'problem',
        text: 'The chart looks odd',
        writtenAt: '2026-11-04T18:12:03.120Z',
        receivedAt: '2026-11-04T18:20:41.002Z',
        profile: { id: expect.any(Number), name: expect.any(String) },
        app: { version: '0.1.0', commit: '4bc9837abc' },
        device,
        screenshot: null,
      });
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(report.profile).toEqual(me.json().member);
    });

    it('writes app.commit as unknown by default and ignores an app field in the request', async () => {
      const response = await send(
        body({ app: { version: '9.9.9', commit: 'forged' } }),
      );
      expect(response.statusCode).toBe(201);
      const report = JSON.parse(
        await readFile(join(feedbackDir, id, 'report.json'), 'utf8'),
      );
      expect(report.app).toEqual({ version: '0.1.0', commit: 'unknown' });
    });

    it.each([
      ['image/jpeg', jpeg, 'screenshot.jpg'],
      ['image/png', png, 'screenshot.png'],
    ])('keeps a %s screenshot beside it', async (type, bytes, name) => {
      const response = await send(
        body({ kind: 'idea', screenshot: picture(type, bytes) }),
      );
      expect(response.statusCode, response.body).toBe(201);
      expect((await readdir(join(feedbackDir, id))).sort()).toEqual(
        ['report.json', name].sort(),
      );
      expect(await readFile(join(feedbackDir, id, name))).toEqual(bytes);
      const report = JSON.parse(
        await readFile(join(feedbackDir, id, 'report.json'), 'utf8'),
      );
      expect(report).toMatchObject({ kind: 'idea', screenshot: name });
    });

    it('leaves .tmp empty and only the report folder beside it', async () => {
      await send(body());
      expect(await folders()).toEqual(['.tmp', id]);
      expect(await readdir(join(feedbackDir, '.tmp'))).toEqual([]);
    });

    it('creates the feedback folder on the first report, not at start', async () => {
      expect(await folders()).toEqual([]);
      await send(body());
      expect(await folders()).toContain(id);
    });
  });

  describe('the same clientId again', () => {
    it('answers 200 and writes nothing', async () => {
      await send(body());
      const before = await readFile(join(feedbackDir, id, 'report.json'));
      now += 60_000;
      const again = await send(body({ text: 'A different text now' }));

      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ id });
      expect(await readFile(join(feedbackDir, id, 'report.json'))).toEqual(
        before,
      );
      expect(await folders()).toEqual(['.tmp', id]);
      expect(await readdir(join(feedbackDir, '.tmp'))).toEqual([]);
    });

    it('answers 200 when the folder was moved to archive/', async () => {
      await send(body());
      await mkdir(join(feedbackDir, 'archive'));
      await rename(join(feedbackDir, id), join(feedbackDir, 'archive', id));

      const again = await send(body());

      expect(again.statusCode).toBe(200);
      expect(await folders()).toEqual(['.tmp', 'archive']);
      expect(await readdir(join(feedbackDir, 'archive'))).toEqual([id]);
    });

    it('leaves one folder when two sends of one clientId run at once', async () => {
      const responses = await Promise.all([
        send(body({ screenshot: picture('image/jpeg', jpeg) })),
        send(body({ screenshot: picture('image/jpeg', jpeg) })),
        send(body({ screenshot: picture('image/jpeg', jpeg) })),
      ]);

      const codes = responses.map((response) => response.statusCode).sort();
      expect(codes).toEqual([200, 200, 201]);
      expect(await folders()).toEqual(['.tmp', id]);
      expect((await readdir(join(feedbackDir, id))).sort()).toEqual([
        'report.json',
        'screenshot.jpg',
      ]);
      expect(await readdir(join(feedbackDir, '.tmp'))).toEqual([]);
    });
  });

  describe('writeReportFolder', () => {
    it('leaves no .tmp folder behind and no <id> folder when a write fails', async () => {
      await expect(
        writeReportFolder(feedbackDir, {
          id,
          report: { version: 1 },
          // A name with a folder that does not exist makes the write fail.
          screenshot: { name: 'missing/screenshot.jpg', data: jpeg },
        }),
      ).rejects.toThrow();

      expect(await folders()).toEqual(['.tmp']);
      expect(await readdir(join(feedbackDir, '.tmp'))).toEqual([]);
    });

    it('reports created, then duplicate, and never leaves a partial <id> folder', async () => {
      const files = { id, report: { version: 1 }, screenshot: null };
      expect(await writeReportFolder(feedbackDir, files)).toBe('created');
      expect(await writeReportFolder(feedbackDir, files)).toBe('duplicate');
      expect(await readdir(join(feedbackDir, id))).toEqual(['report.json']);
      expect(await readdir(join(feedbackDir, '.tmp'))).toEqual([]);
    });
  });

  describe('a body the server refuses with 400 invalid', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['text of two characters', { text: 'ok' }],
      ['text of two characters among spaces', { text: ' a   b  ' }],
      ['text of only white space', { text: ' \n\t   ' }],
      ['text over 4000 characters', { text: 'x'.repeat(4001) }],
      ['an unknown kind', { kind: 'praise' }],
      [
        'a JPEG whose bytes are a PNG',
        { screenshot: picture('image/jpeg', png) },
      ],
      [
        'a PNG whose bytes are a JPEG',
        { screenshot: picture('image/png', jpeg) },
      ],
      [
        'a screenshot of text',
        { screenshot: picture('image/jpeg', Buffer.from('not a picture')) },
      ],
      [
        'a screenshot of one byte',
        { screenshot: picture('image/jpeg', Buffer.from([0xff])) },
      ],
      [
        'a screenshot over 3 MB',
        {
          screenshot: picture(
            'image/jpeg',
            Buffer.concat([jpeg, Buffer.alloc(3 * 1024 * 1024)]),
          ),
        },
      ],
      ['a clientId that is not a UUID', { clientId: 'not-a-uuid' }],
    ];

    it.each(cases)('%s', async (_name, extra) => {
      const response = await send(body(extra));

      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('invalid');
      expect(await folders()).toEqual([]);
    });

    it('accepts text of exactly 3 characters and of exactly 4000', async () => {
      expect((await send(body({ text: ' a b c ' }))).statusCode).toBe(201);
      const other = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
      const long = await send(
        body({ clientId: other, text: 'x'.repeat(4000) }),
      );
      expect(long.statusCode, long.body).toBe(201);
    });

    it('accepts a screenshot of exactly 3 MB', async () => {
      const exact = Buffer.concat([
        jpeg,
        Buffer.alloc(3 * 1024 * 1024 - jpeg.length),
      ]);
      const response = await send(
        body({ screenshot: picture('image/jpeg', exact) }),
      );
      expect(response.statusCode, response.body).toBe(201);
    });
  });

  describe('when the folder cannot be written', () => {
    it('answers 503 unavailable with no feedbackDir', async () => {
      await app.close();
      app = await makeApp({});
      const response = await send(body());

      expect(response.statusCode).toBe(503);
      expect(response.json().error).toEqual({
        code: 'unavailable',
        message: 'Could not save your feedback.',
      });
    });

    it('answers 503 when .tmp is a file, and leaves no <id> folder', async () => {
      await mkdir(feedbackDir);
      await writeFile(join(feedbackDir, '.tmp'), 'in the way');

      const response = await send(body());

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('unavailable');
      expect(await folders()).toEqual(['.tmp']);
    });

    it.skipIf(asRoot)(
      'answers 503 for a read-only folder, while the server still starts and answers health',
      async () => {
        await mkdir(feedbackDir);
        await chmod(feedbackDir, 0o555);
        await app.close();
        app = await makeApp({ feedbackDir });

        const health = await app.inject({ method: 'GET', url: '/api/health' });
        expect(health.statusCode).toBe(200);
        const response = await send(body());
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe('unavailable');
      },
    );
  });

  describe('the route table', () => {
    it('answers 401 unauthenticated without a session', async () => {
      const response = await send(body(), jsonHeaders);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('unauthenticated');
      expect(await folders()).toEqual([]);
    });

    it('answers 401 session_locked from a locked session', async () => {
      now += reopenLockAfterMs + 1;
      const response = await send(body());
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('session_locked');
      expect(await folders()).toEqual([]);
    });

    it('refuses a request without Origin, with a foreign Origin or without JSON', async () => {
      const refused: Array<[string, Record<string, string>]> = [
        ['no Origin', { 'content-type': 'application/json', cookie }],
        [
          'a foreign Origin',
          {
            origin: 'https://attacker.example',
            'content-type': 'application/json',
            cookie,
          },
        ],
        [
          'a form content-type',
          {
            origin,
            'content-type': 'application/x-www-form-urlencoded',
            cookie,
          },
        ],
        ['text/plain', { origin, 'content-type': 'text/plain', cookie }],
      ];
      for (const [name, headers] of refused) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/feedback',
          headers,
          payload: JSON.stringify(body()),
        });
        expect(response.statusCode, name).toBe(403);
      }
      expect(await folders()).toEqual([]);
    });
  });

  describe('logs', () => {
    it('hold the id, kind and screenshot flag, but neither the text nor the image', async () => {
      const text = 'unique-private-sentence-for-the-log-test';
      const bytes = Buffer.concat([jpeg, Buffer.from('unique-image-marker')]);
      const data = bytes.toString('base64');

      const response = await send(
        body({ text, screenshot: { type: 'image/jpeg', data } }),
      );
      // A refused report and a repeat are logged too.
      await send(body({ text, screenshot: { type: 'image/jpeg', data } }));
      await send(
        body({
          clientId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
          text,
          screenshot: { type: 'image/png', data },
        }),
      );
      const all = logs.join('\n');

      expect(response.statusCode).toBe(201);
      expect(all).toContain(id);
      expect(all).toContain('Feedback received');
      expect(all).not.toContain(text);
      expect(all).not.toContain(data);
      expect(all).not.toContain('unique-image-marker');
      expect(all).not.toContain(data.slice(0, 40));
    });

    it('hold neither the text nor the image when the write fails', async () => {
      await app.close();
      app = await makeApp({});
      const text = 'unique-private-sentence-for-the-failed-log-test';
      const data = png.toString('base64');
      const response = await send(
        body({ text, screenshot: { type: 'image/png', data } }),
      );
      const all = logs.join('\n');

      expect(response.statusCode).toBe(503);
      expect(all).toContain('Feedback could not be written');
      expect(all).not.toContain(text);
      expect(all).not.toContain(data);
    });
  });

  describe('/api/health', () => {
    it('answers the commit the copy was built from, unknown by default', async () => {
      const plain = await app.inject({ method: 'GET', url: '/api/health' });
      expect(plain.json()).toMatchObject({
        appVersion: '0.1.0',
        commit: 'unknown',
      });
      await app.close();
      app = await makeApp({ feedbackDir, appCommit: '4bc9837abc' });
      const built = await app.inject({ method: 'GET', url: '/api/health' });
      expect(built.json().commit).toBe('4bc9837abc');
    });
  });
});

describe('feedback settings', () => {
  it('defaults FEEDBACK_DIR to <DATA_DIR>/feedback and APP_COMMIT to unknown', () => {
    expect(parseConfig({ DATA_DIR: '/somewhere/data' })).toMatchObject({
      feedbackDir: '/somewhere/data/feedback',
      appCommit: 'unknown',
    });
    expect(parseConfig({})).toMatchObject({ feedbackDir: '/data/feedback' });
  });

  it('reads FEEDBACK_DIR and APP_COMMIT', () => {
    expect(
      parseConfig({
        DATA_DIR: '/somewhere/data',
        FEEDBACK_DIR: '/feedback',
        APP_COMMIT: '4bc9837abc',
      }),
    ).toMatchObject({ feedbackDir: '/feedback', appCommit: '4bc9837abc' });
  });

  it('counts an empty APP_COMMIT as unknown', () => {
    expect(parseConfig({ APP_COMMIT: '' }).appCommit).toBe('unknown');
  });
});

function cookieHeader(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? header : [header])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
