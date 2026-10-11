import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  BackupError,
  isIntact,
  runNightlyBackup,
} from '../src/backup/nightly.js';
import { dailyLimit, monthlyLimit } from '../src/backup/files.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createBackupJob } from '../src/jobs/backup.js';
import { createJobRunner } from '../src/jobs/runner.js';
import type { JobSettings } from '../src/jobs/types.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };

/** Settings as the runner reads them, in the given time zone. */
const settings = (timeZone: string): JobSettings => ({
  timeZone,
  commonCurrency: 'EUR',
  cadenceKind: 'off',
  cadenceDayOfMonth: null,
  cadenceEveryWeeks: null,
  cadenceWeekday: null,
  cadenceTime: null,
  cadenceAnchorDate: null,
  followupDays: 2,
});

describe('nightly backup', () => {
  let database: Database.Database;
  let directory: string;
  let dataDir: string;
  let backupDir: string;
  let now: number;
  const clock = { now: () => new Date(now) };
  const at = (iso: string) => {
    now = Date.parse(iso);
  };
  const options = () => ({ database, clock, dataDir, backupDir });
  const job = () => createBackupJob(options());
  const names = async (folder: string) =>
    (await readdir(join(backupDir, folder))).sort();
  const dailyRows = () =>
    database
      .prepare(
        "SELECT status, bytes, error, path FROM backup WHERE kind = 'daily'",
      )
      .all() as Array<{
      status: string;
      bytes: bigint | null;
      error: string | null;
      path: string;
    }>;
  /** A fresh runner, as after a server restart. */
  const tick = () => createJobRunner({ database, clock, jobs: [job()] }).tick();
  const remember = (text: string) =>
    database
      .prepare('INSERT INTO member (name, active, created_at) VALUES (?, 1, 1)')
      .run(text);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-backup-'));
    dataDir = join(directory, 'data');
    backupDir = join(directory, 'backups');
    await mkdir(dataDir);
    database = new Database(join(dataDir, 'budget-buddy.sqlite'));
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    await migrateDatabase(database, { backupDir, migrationsFolder });
    database
      .prepare(
        "INSERT INTO family (id, password_hash, time_zone, created_at) VALUES (1, 'x', 'Europe/Berlin', 1)",
      )
      .run();
    remember('Alena');
    at('2026-10-11T10:00:00Z');
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  describe('slots', () => {
    const due = (
      iso: string,
      zone = 'Europe/Berlin',
      last: string | null = null,
    ) => job().dueSlots(new Date(iso), settings(zone), last);

    it('opens a slot at 03:30 of the family clock, not before', () => {
      expect(due('2026-10-11T01:29:00Z')).toEqual(['2026-10-10T03:30']);
      expect(due('2026-10-11T01:30:00Z')).toEqual([
        '2026-10-10T03:30',
        '2026-10-11T03:30',
      ]);
      expect(
        due('2026-10-11T01:30:00Z', 'Europe/Berlin', '2026-10-11T03:30'),
      ).toEqual([]);
    });

    it('offers only the latest slot after any downtime', () => {
      const slots = due(
        '2026-10-11T20:00:00Z',
        'Europe/Berlin',
        '2026-10-01T03:30',
      );
      expect(slots.at(-1)).toBe('2026-10-11T03:30');
      expect(slots.length).toBeLessThanOrEqual(2);
    });

    it('stays at 03:30 on the night the clocks go forward', () => {
      // Berlin skips 02:00-03:00 on 29 March 2026; 03:30 is 01:30 UTC.
      expect(due('2026-03-29T01:29:00Z')).toEqual(['2026-03-28T03:30']);
      expect(due('2026-03-29T01:30:00Z')).toContain('2026-03-29T03:30');
    });

    it('makes one slot on the night the clocks go back', () => {
      // Berlin repeats 02:00-03:00 on 25 October 2026; 03:30 is 02:30 UTC.
      for (const iso of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
        expect(due(iso)).not.toContain('2026-10-25T03:30');
      }
      expect(due('2026-10-25T02:29:00Z')).not.toContain('2026-10-25T03:30');
      expect(due('2026-10-25T02:30:00Z')).toContain('2026-10-25T03:30');
    });

    it('follows a zone whose offset is not whole hours', () => {
      // 03:30 in Kolkata (UTC+5:30) is 22:00 UTC the evening before.
      expect(due('2026-10-10T21:59:00Z', 'Asia/Kolkata')).toEqual([
        '2026-10-10T03:30',
      ]);
      expect(due('2026-10-10T22:00:00Z', 'Asia/Kolkata')).toContain(
        '2026-10-11T03:30',
      );
    });
  });

  describe('the daily copy', () => {
    it('writes one verified file per night and a second run writes nothing', async () => {
      await tick();
      await tick();
      expect(await names('daily')).toEqual(['budget-buddy-2026-10-11.sqlite']);
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      expect(isIntact(file, 'read')).toBe(true);
      const copy = new Database(file, { readonly: true });
      expect(copy.prepare('SELECT name FROM member').all()).toEqual([
        { name: 'Alena' },
      ]);
      copy.close();
      const runs = database
        .prepare("SELECT slot, status FROM job_run WHERE job = 'backup'")
        .all();
      expect(runs).toEqual([{ slot: '2026-10-11T03:30', status: 'done' }]);
      expect(dailyRows()).toHaveLength(1);
    });

    it('does not rewrite a copy that is already in place and intact', async () => {
      const first = await runNightlyBackup(options(), '2026-10-11');
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      const before = await readFile(file);
      remember('Max');
      const second = await runNightlyBackup(options(), '2026-10-11');
      expect(first.reused).toBe(false);
      expect(second.reused).toBe(true);
      expect(Buffer.compare(before, await readFile(file))).toBe(0);
      expect(dailyRows()).toHaveLength(1);
    });

    it('leaves a plain single file with no side files', async () => {
      await runNightlyBackup(options(), '2026-10-11');
      expect(await names('daily')).toEqual(['budget-buddy-2026-10-11.sqlite']);
    });

    it('records its size and time for the status (BKP-4)', async () => {
      await runNightlyBackup(options(), '2026-10-11');
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      const [row] = dailyRows();
      expect(row?.status).toBe('done');
      expect(row?.bytes).toBe(BigInt((await stat(file)).size));
    });

    it('passes the integrity check while writes happen through the same connection', async () => {
      const total = growScratchTable(database);
      let written = 0;
      let writing = true;
      const writer = (async () => {
        while (writing) {
          database.prepare('INSERT INTO scratch (filler) VALUES (?)').run('w');
          written += 1;
          await new Promise((resolve) => setImmediate(resolve));
        }
      })();
      const pending = runNightlyBackup(options(), '2026-10-11');
      await pending;
      writing = false;
      await writer;
      expect(written).toBeGreaterThan(0);
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      expect(isIntact(file, 'read')).toBe(true);
      const copy = new Database(file, { readonly: true });
      const count = (
        copy.prepare('SELECT COUNT(*) AS n FROM scratch').get() as { n: number }
      ).n;
      copy.close();
      expect(count).toBeGreaterThanOrEqual(total);
      expect(count).toBeLessThanOrEqual(total + written);
    });

    it('passes the integrity check while another connection writes', async () => {
      const total = growScratchTable(database);
      const other = new Database(join(dataDir, 'budget-buddy.sqlite'));
      other.pragma('busy_timeout = 5000');
      let written = 0;
      const writer = (async () => {
        // Few enough writes that SQLite's restarts of the copy do finish.
        while (written < 5) {
          other.prepare('INSERT INTO scratch (filler) VALUES (?)').run('w');
          written += 1;
          await new Promise((resolve) => setImmediate(resolve));
        }
      })();
      await runNightlyBackup(options(), '2026-10-11');
      await writer;
      other.close();
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      expect(isIntact(file, 'read')).toBe(true);
      const copy = new Database(file, { readonly: true });
      const count = (
        copy.prepare('SELECT COUNT(*) AS n FROM scratch').get() as { n: number }
      ).n;
      copy.close();
      expect(count).toBeGreaterThanOrEqual(total);
      expect(count).toBeLessThanOrEqual(total + written);
    });
  });

  describe('a night that fails', () => {
    /** A database whose online backup writes something that is not a database. */
    const garbageBackup = () =>
      new Proxy(database, {
        get(target, property) {
          if (property === 'backup') {
            return async (path: string) =>
              writeFile(path, 'not a database'.repeat(500));
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

    it('never leaves a file that looks like a good backup', async () => {
      await expect(
        runNightlyBackup(
          { ...options(), database: garbageBackup() },
          '2026-10-11',
        ),
      ).rejects.toThrow(
        new BackupError('The new copy failed its integrity check.'),
      );
      expect(await names('daily')).toEqual([]);
      const [row] = dailyRows();
      expect(row).toMatchObject({
        status: 'failed',
        error: 'The new copy failed its integrity check.',
      });
    });

    it('never replaces a good copy of the night with a bad one', async () => {
      await runNightlyBackup(options(), '2026-10-11');
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      const before = await readFile(file);
      await runNightlyBackup(
        { ...options(), database: garbageBackup() },
        '2026-10-11',
      );
      expect(Buffer.compare(before, await readFile(file))).toBe(0);
    });

    it('replaces a damaged copy of the night with a good one', async () => {
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      await mkdir(join(backupDir, 'daily'), { recursive: true });
      await writeFile(file, 'damaged'.repeat(1000));
      const result = await runNightlyBackup(options(), '2026-10-11');
      expect(result.reused).toBe(false);
      expect(isIntact(file, 'read')).toBe(true);
    });

    it('keeps every older copy when the night fails, pruning nothing', async () => {
      for (let day = 1; day <= 20; day += 1) {
        await writeCopy('daily', `2026-09-${String(day).padStart(2, '0')}`);
      }
      await expect(
        runNightlyBackup(
          { ...options(), database: garbageBackup() },
          '2026-10-11',
        ),
      ).rejects.toThrow(BackupError);
      expect(await names('daily')).toHaveLength(20);
    });

    it('fails with a reason that has no path in it and the runner retries it', async () => {
      // A file where the backup folder should be: the folders cannot be made.
      await rm(backupDir, { recursive: true, force: true });
      await writeFile(backupDir, 'in the way');
      const runner = createJobRunner({ database, clock, jobs: [job()] });
      await runner.tick();
      const [run] = database
        .prepare(
          "SELECT status, attempts, error FROM job_run WHERE job = 'backup'",
        )
        .all() as Array<{ status: string; attempts: bigint; error: string }>;
      expect(run?.status).toBe('failed');
      expect(run?.error).toMatch(
        /^The backup could not be written \(E[A-Z]+\)\.$/u,
      );
      expect(run?.error).not.toContain(directory);
      await runner.tick();
      const [again] = database
        .prepare("SELECT attempts FROM job_run WHERE job = 'backup'")
        .all() as Array<{ attempts: bigint }>;
      expect(again?.attempts).toBe(2n);
    });

    it('clears what a run cut off by a restart left behind', async () => {
      await mkdir(join(backupDir, 'daily'), { recursive: true });
      const leftover = join(
        backupDir,
        'daily',
        '.budget-buddy-2026-10-10.sqlite.tmp-abc123',
      );
      await writeFile(leftover, 'half a copy');
      database
        .prepare(
          "INSERT INTO backup (kind, path, started_at, status) VALUES ('daily', 'x', 1, 'running')",
        )
        .run();
      await runNightlyBackup(options(), '2026-10-11');
      expect(await names('daily')).toEqual(['budget-buddy-2026-10-11.sqlite']);
      const rows = dailyRows();
      expect(rows.find((row) => row.path === 'x')).toMatchObject({
        status: 'failed',
        error: 'Interrupted by a restart',
      });
    });
  });

  describe('monthly copies and pruning', () => {
    it('copies the first backup of a month to monthly/', async () => {
      await runNightlyBackup(options(), '2026-10-01');
      await runNightlyBackup(options(), '2026-10-02');
      await runNightlyBackup(options(), '2026-11-01');
      expect(await names('monthly')).toEqual([
        'budget-buddy-2026-10-01.sqlite',
        'budget-buddy-2026-11-01.sqlite',
      ]);
      expect(
        isIntact(
          join(backupDir, 'monthly', 'budget-buddy-2026-10-01.sqlite'),
          'read',
        ),
      ).toBe(true);
    });

    it('still makes the month’s copy when the 1st was missed', async () => {
      const result = await runNightlyBackup(options(), '2026-10-02');
      expect(result.monthly).toBe('budget-buddy-2026-10-02.sqlite');
    });

    it('keeps exactly 14 daily and 12 monthly copies and touches nothing else', async () => {
      for (let day = 1; day <= 20; day += 1) {
        await writeCopy('daily', `2026-09-${String(day).padStart(2, '0')}`);
      }
      for (let month = 1; month <= 12; month += 1) {
        await writeCopy('monthly', `2025-${String(month).padStart(2, '0')}-01`);
      }
      for (const month of ['2026-01-01', '2026-02-01', '2026-03-01']) {
        await writeCopy('monthly', month);
      }
      await writeFile(
        join(backupDir, 'pre_migration-2026-09-01T00-00-00.000Z.sqlite'),
        'x',
      );
      await writeFile(join(backupDir, 'daily', 'notes.txt'), 'keep me');

      await runNightlyBackup(options(), '2026-10-11');

      const daily = (await names('daily')).filter((name) =>
        name.endsWith('.sqlite'),
      );
      expect(daily).toHaveLength(dailyLimit);
      expect(daily.at(-1)).toBe('budget-buddy-2026-10-11.sqlite');
      expect(daily[0]).toBe('budget-buddy-2026-09-08.sqlite');
      const monthly = await names('monthly');
      expect(monthly).toHaveLength(monthlyLimit);
      expect(monthly.at(-1)).toBe('budget-buddy-2026-10-11.sqlite');
      expect(monthly[0]).toBe('budget-buddy-2025-05-01.sqlite');
      expect(await names('daily')).toContain('notes.txt');
      expect(await names('.')).toContain(
        'pre_migration-2026-09-01T00-00-00.000Z.sqlite',
      );
    });
  });

  describe('images', () => {
    it('copies new image files and nothing again', async () => {
      await mkdir(join(dataDir, 'images', 'receipts'), { recursive: true });
      await writeFile(join(dataDir, 'images', 'a.jpg'), 'aaa');
      await writeFile(join(dataDir, 'images', 'receipts', 'b.jpg'), 'bbbb');

      expect((await runNightlyBackup(options(), '2026-10-11')).images).toBe(2);
      expect((await runNightlyBackup(options(), '2026-10-12')).images).toBe(0);
      expect(await readFile(join(backupDir, 'images', 'a.jpg'), 'utf8')).toBe(
        'aaa',
      );
      expect(
        await readFile(join(backupDir, 'images', 'receipts', 'b.jpg'), 'utf8'),
      ).toBe('bbbb');

      await writeFile(join(dataDir, 'images', 'c.jpg'), 'cc');
      expect((await runNightlyBackup(options(), '2026-10-13')).images).toBe(1);
    });

    it('keeps in the backup an image that was removed from the data folder', async () => {
      await mkdir(join(dataDir, 'images'), { recursive: true });
      await writeFile(join(dataDir, 'images', 'a.jpg'), 'aaa');
      await runNightlyBackup(options(), '2026-10-11');
      await rm(join(dataDir, 'images', 'a.jpg'));
      await runNightlyBackup(options(), '2026-10-12');
      expect(await names('images')).toEqual(['a.jpg']);
    });

    it('copes with no images folder at all', async () => {
      expect((await runNightlyBackup(options(), '2026-10-11')).images).toBe(0);
    });
  });

  describe('backup status route', () => {
    let app: Awaited<ReturnType<typeof createApp>>;
    let cookies: string;

    beforeEach(async () => {
      // The family row made above is replaced by a real set-up.
      database.prepare('DELETE FROM member').run();
      database.prepare('DELETE FROM family').run();
      app = await createApp({
        database,
        logger: false,
        appOrigins: [origin],
        secureCookies: false,
        clock,
        backupDir,
      });
      const setup = await app.inject({
        method: 'POST',
        url: '/api/setup',
        headers: jsonHeaders,
        payload: {
          password: 'correct horse battery staple',
          passwordConfirmation: 'correct horse battery staple',
          profiles: ['Alex', 'Blair'],
        },
      });
      expect(setup.statusCode).toBe(201);
      const header = setup.headers['set-cookie'];
      cookies = (Array.isArray(header) ? header : [header])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    });

    afterEach(async () => {
      await app.close();
    });

    const status = async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/backup/status',
        headers: { cookie: cookies },
      });
      expect(response.statusCode).toBe(200);
      return response.json();
    };

    it('needs a signed-in member', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/backup/status',
      });
      expect(response.statusCode).toBe(401);
    });

    it('reports no backup before the first night', async () => {
      expect(await status()).toEqual({
        today: '2026-10-11',
        timeZone: 'Europe/Berlin',
        time: '03:30',
        last: null,
        failure: null,
        daily: { kept: 0, limit: 14 },
        monthly: { kept: 0, limit: 12 },
      });
    });

    it('reports the last good backup with its time, size and copies kept', async () => {
      at('2026-10-11T01:31:00Z');
      await tick();
      const file = join(backupDir, 'daily', 'budget-buddy-2026-10-11.sqlite');
      expect(await status()).toMatchObject({
        last: { finishedAt: now, bytes: (await stat(file)).size },
        failure: null,
        daily: { kept: 1, limit: 14 },
        monthly: { kept: 1, limit: 12 },
      });
    });

    it('reports a failed night, with the last good backup beside it', async () => {
      at('2026-10-10T01:31:00Z');
      await tick();
      const good = now;
      await rm(join(backupDir, 'daily'), { recursive: true });
      await writeFile(join(backupDir, 'daily'), 'in the way');
      at('2026-10-11T01:31:00Z');
      await tick();
      const body = await status();
      expect(body.last.finishedAt).toBe(good);
      expect(body.failure).toEqual({
        at: now,
        message: expect.stringMatching(
          /^The backup could not be written \(E[A-Z]+\)\.$/u,
        ),
      });
      // The next good night clears it.
      await rm(join(backupDir, 'daily'));
      at('2026-10-12T01:31:00Z');
      await tick();
      expect((await status()).failure).toBeNull();
    });
  });

  /** Writes a finished copy file for `date` into `folder`. */
  async function writeCopy(folder: 'daily' | 'monthly', date: string) {
    await mkdir(join(backupDir, folder), { recursive: true });
    const path = join(backupDir, folder, `budget-buddy-${date}.sqlite`);
    await writeFile(path, `copy ${date}`);
    await utimes(path, new Date(date), new Date(date));
  }
});

/** Fills a scratch table with a few thousand pages so a copy takes steps. */
function growScratchTable(database: Database.Database): number {
  database.exec('CREATE TABLE scratch (id INTEGER PRIMARY KEY, filler TEXT)');
  const insert = database.prepare('INSERT INTO scratch (filler) VALUES (?)');
  const filler = 'x'.repeat(2000);
  database.transaction(() => {
    for (let index = 0; index < 4000; index += 1) insert.run(filler);
  })();
  return 4000;
}
