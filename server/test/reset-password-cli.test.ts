import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { verify } from '@node-rs/argon2';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runCli } from '../src/cli.js';
import { CliError, resetFamilyPassword } from '../src/cli/resetPassword.js';
import { PromptCancelled, readSecret } from '../src/cli/secretPrompt.js';
import { parseConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://budget-buddy.test';
const jsonHeaders = { origin, 'content-type': 'application/json' };
const oldPassword = 'correct family password';
const newPassword = 'a brand new family password';

describe('reset-password command', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let database: Database.Database;
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-reset-'));
    const config = parseConfig({
      NODE_ENV: 'test',
      DATA_DIR: join(directory, 'data'),
      BACKUP_DIR: join(directory, 'backups'),
    });
    databasePath = config.databasePath;
    database = await openDatabase(config);
    app = await createApp({
      database,
      logger: false,
      appOrigins: [origin],
      secureCookies: false,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function createFamily(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: jsonHeaders,
      payload: {
        password: oldPassword,
        passwordConfirmation: oldPassword,
        profiles: ['Alex', 'Blair'],
      },
    });
    expect(response.statusCode).toBe(201);
    return cookiesOf(response);
  }

  async function signIn(password: string): Promise<string | undefined> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: jsonHeaders,
      payload: { password },
    });
    return response.statusCode === 200 ? cookiesOf(response) : undefined;
  }

  async function status(cookies: string): Promise<number> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookies },
    });
    return response.statusCode;
  }

  /** Gives each of two signed-in devices a passkey and a push subscription. */
  function addDeviceExtras(cookies: string[]): void {
    for (const [index, cookie] of cookies.entries()) {
      const deviceId = /bb_device=([^;]+)/u.exec(cookie)![1]!;
      database
        .prepare(
          'INSERT INTO passkey (device_id, credential_id, public_key, counter, created_at) VALUES (?, ?, ?, 0, 1)',
        )
        .run(deviceId, `credential-${index}`, 'key');
      database
        .prepare(
          'INSERT INTO push_subscription (device_id, member_id, endpoint, p256dh, auth, created_at) VALUES (?, 1, ?, ?, ?, 1)',
        )
        .run(deviceId, `https://web.push.apple.com/${index}`, 'p', 'a');
    }
  }

  function count(table: string): number {
    const row = database
      .prepare(`SELECT count(*) AS count FROM ${table}`)
      .get() as { count: number | bigint };
    return Number(row.count);
  }

  it('sets the new password, ends every session, and deletes all passkeys and push subscriptions', async () => {
    const first = await createFamily();
    const second = (await signIn(oldPassword))!;
    addDeviceExtras([first, second]);
    database
      .prepare('UPDATE family SET failed_signins = 3, locked_until = ?')
      .run(Date.now() + 60_000);
    const before = database
      .prepare('SELECT password_epoch FROM family')
      .get() as { password_epoch: bigint };
    const devices = count('device');

    const counts = await resetFamilyPassword(databasePath, newPassword);

    expect(counts).toEqual({ sessions: 2, passkeys: 2, pushSubscriptions: 2 });
    expect(count('session')).toBe(0);
    expect(count('passkey')).toBe(0);
    expect(count('push_subscription')).toBe(0);
    // Profiles and devices (with their default profile) are not touched.
    expect(count('member')).toBe(2);
    expect(count('device')).toBe(devices);
    const family = database
      .prepare(
        'SELECT password_hash, password_epoch, failed_signins, locked_until FROM family',
      )
      .get() as {
      password_hash: string;
      password_epoch: bigint;
      failed_signins: bigint;
      locked_until: bigint | null;
    };
    expect(family.password_epoch).toBe(before.password_epoch + 1n);
    expect(family.failed_signins).toBe(0n);
    expect(family.locked_until).toBeNull();
    expect(family.password_hash).toMatch(/^\$argon2id\$/u);
    expect(await verify(family.password_hash, newPassword)).toBe(true);

    expect(await status(first)).toBe(401);
    expect(await status(second)).toBe(401);
    expect(await signIn(oldPassword)).toBeUndefined();
    const again = await signIn(newPassword);
    expect(again).toBeDefined();
    expect(await status(again!)).toBe(200);
  });

  it('refuses a short password and leaves everything as it was', async () => {
    const cookies = await createFamily();
    addDeviceExtras([cookies]);

    await expect(
      resetFamilyPassword(databasePath, 'too short'),
    ).rejects.toThrow(new CliError('Use at least 10 characters.'));

    expect(count('session')).toBe(1);
    expect(count('passkey')).toBe(1);
    expect(await status(cookies)).toBe(200);
    expect(await signIn(oldPassword)).toBeDefined();
  });

  it('refuses before first start and for a missing database', async () => {
    await expect(
      resetFamilyPassword(databasePath, newPassword),
    ).rejects.toThrow(/finish first start/u);
    await expect(
      resetFamilyPassword(join(directory, 'nothing.sqlite'), newPassword),
    ).rejects.toThrow(/There is no database at/u);
  });

  it('changes nothing when a step fails halfway', async () => {
    const cookies = await createFamily();
    const hash = database.prepare('SELECT password_hash FROM family').get();
    database.exec('DROP TABLE push_subscription');

    await expect(
      resetFamilyPassword(databasePath, newPassword),
    ).rejects.toThrow(/from an older version/u);

    expect(database.prepare('SELECT password_hash FROM family').get()).toEqual(
      hash,
    );
    expect(await status(cookies)).toBe(200);
  });

  it('works through the command with the server running, from piped input', async () => {
    const cookies = await createFamily();
    addDeviceExtras([cookies]);
    const hash = (
      database.prepare('SELECT password_hash FROM family').get() as {
        password_hash: string;
      }
    ).password_hash;

    const result = await runCommand(['reset-password'], `${newPassword}\n`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('The family password was changed.');
    expect(result.stdout).toContain(
      '1 signed-in device(s) were signed out, 1 Face ID passkey(s) and 1 notification subscription(s)',
    );
    for (const secret of [newPassword, oldPassword, hash]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
    // The running app's own connection sees the change at once.
    expect(await status(cookies)).toBe(401);
    expect(await signIn(oldPassword)).toBeUndefined();
    expect(await signIn(newPassword)).toBeDefined();
  });

  it('does not take the password as an argument', async () => {
    const cookies = await createFamily();

    const result = await runCommand(['reset-password', newPassword], '');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('takes no arguments');
    expect(result.stderr).not.toContain(newPassword);
    expect(result.stdout).not.toContain(newPassword);
    expect(await status(cookies)).toBe(200);
    expect(await signIn(newPassword)).toBeUndefined();
  });

  it('refuses a short password and empty input from the command', async () => {
    const cookies = await createFamily();

    const short = await runCommand(['reset-password'], 'short\n');
    const empty = await runCommand(['reset-password'], '');

    expect(short.status).toBe(1);
    expect(short.stderr).toContain('Use at least 10 characters.');
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('Cancelled.');
    expect(await status(cookies)).toBe(200);
  });

  it('waits for the server’s write lock instead of failing', async () => {
    const cookies = await createFamily();
    // Another connection, as the server's own, holds a write for a while.
    const holder = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import Database from 'better-sqlite3';
        const db = new Database(process.env.TEST_DATABASE_PATH);
        db.pragma('journal_mode = WAL');
        db.exec('BEGIN IMMEDIATE');
        db.prepare("UPDATE family SET followup_days = 5").run();
        console.log('locked');
        setTimeout(() => { console.log('committed ' + Date.now()); db.exec('COMMIT'); db.close(); }, 3000);
        `,
      ],
      {
        cwd: serverDirectory,
        env: { ...process.env, TEST_DATABASE_PATH: databasePath },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    let held = '';
    const exited = new Promise((resolve) => holder.once('exit', resolve));
    await new Promise<void>((resolve) =>
      holder.stdout.on('data', (chunk: Buffer) => {
        held += chunk.toString();
        if (held.includes('locked')) resolve();
      }),
    );

    const result = await runCommand(['reset-password'], `${newPassword}\n`);

    expect(result.status).toBe(0);
    await exited;
    // The command could only write after the other write was committed.
    const committedAt = Number(/committed (\d+)/u.exec(held)![1]);
    expect(Date.now()).toBeGreaterThanOrEqual(committedAt);
    expect(result.finishedAt).toBeGreaterThanOrEqual(committedAt);
    expect(
      database.prepare('SELECT followup_days AS days FROM family').get(),
    ).toEqual({ days: 5n });
    expect(await status(cookies)).toBe(401);
    expect(await signIn(newPassword)).toBeDefined();
  }, 20_000);

  async function runCommand(
    args: string[],
    stdin: string,
  ): Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    finishedAt: number;
  }> {
    // spawn, not spawnSync: the app in this process must keep serving.
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', ...args],
      {
        cwd: serverDirectory,
        env: { ...process.env, DATA_DIR: join(directory, 'data') },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end(stdin);
    const status = await new Promise<number | null>((resolve) =>
      child.once('close', resolve),
    );
    return { status, stdout, stderr, finishedAt: Date.now() };
  }
});

describe('hidden prompt', () => {
  function terminal() {
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      rawModes: [] as boolean[],
      setRawMode(mode: boolean) {
        this.rawModes.push(mode);
      },
    });
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk: Buffer) => (written += chunk.toString()));
    return { input, output, written: () => written };
  }

  it('echoes nothing, handles backspace and restores the terminal', async () => {
    const { input, output, written } = terminal();
    const answer = readSecret('Password: ', input, output);
    input.write('abcx');
    input.write('\u007fdé\r');

    expect(await answer).toBe('abcdé');
    expect(written()).toBe('Password: \n');
    expect(input.rawModes).toEqual([true, false]);
  });

  it('is cancelled by Ctrl-C and by the end of input', async () => {
    const first = terminal();
    const cancelled = readSecret('Password: ', first.input, first.output);
    first.input.write('abc\u0003');
    await expect(cancelled).rejects.toThrow(PromptCancelled);
    expect(first.input.rawModes).toEqual([true, false]);

    const second = terminal();
    const ended = readSecret('Password: ', second.input, second.output);
    second.input.end();
    await expect(ended).rejects.toThrow(PromptCancelled);
  });

  it('asks twice on a terminal and refuses different answers', async () => {
    const { input, output, written } = terminal();
    const errors = new PassThrough();
    const result = runCli(['reset-password'], {
      input,
      output,
      errors,
      env: { DATA_DIR: '/nonexistent' },
    });
    input.write('first password here\r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.write('another password here\r');

    expect(await result).toBe(1);
    expect(written()).toContain('Repeat it: ');
    expect(written()).not.toContain('password here');
    expect(errors.read()?.toString()).toContain('The passwords do not match.');
  });
});

/** Cookie header made of the `Set-Cookie` values of a response. */
function cookiesOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : [header];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}
