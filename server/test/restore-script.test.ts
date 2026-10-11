import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const script = fileURLToPath(
  new URL('../../scripts/restore.sh', import.meta.url),
);

/**
 * `restore.sh` is written for the compose service `app`. Here a fake `docker`
 * on PATH records each call, so the order of the steps and what they do to
 * the files can be checked without Docker. The compose part is not run end
 * to end by this test; `scripts/restore-test.sh` runs the same script against
 * real containers with its own stop and start commands.
 */
describe('scripts/restore.sh with a fake docker', () => {
  let directory: string;
  let data: string;
  let backups: string;
  let calls: string;
  let backup: string;

  const restore = async (env: Record<string, string> = {}, file = backup) => {
    try {
      const { stdout } = await run('bash', [script, file], {
        cwd: directory,
        env: {
          PATH: `${join(directory, 'bin')}:${process.env.PATH ?? ''}`,
          HOME: directory,
          BB_DATA_DIR: data,
          BB_BACKUP_DIR: backups,
          BB_HEALTH_URL: 'http://127.0.0.1:9/never',
          ...env,
        },
      });
      return { code: 0, out: stdout, err: '' };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      return { code: failure.code, out: failure.stdout, err: failure.stderr };
    }
  };
  const logged = async () =>
    (await readFile(calls, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-restore-'));
    data = join(directory, 'data');
    backups = join(directory, 'backups');
    calls = join(directory, 'calls.log');
    backup = join(directory, 'budget-buddy-2026-10-10.sqlite');
    await mkdir(join(directory, 'bin'));
    await mkdir(data);
    await mkdir(join(backups, 'images'), { recursive: true });
    await writeFile(backup, 'BACKUP CONTENT');
    // The fake records its arguments; FAKE_FAIL names a subcommand to fail.
    const docker = join(directory, 'bin', 'docker');
    await writeFile(
      docker,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\n[ -n "$FAKE_QUIET" ] || case "$*" in *verifyBackup*) echo 'ok (migration version 3)';; esac\ncase " $* " in *" $FAKE_FAIL "*) exit 1;; esac\nexit 0\n`,
    );
    await chmod(docker, 0o755);
    // curl answers at once, so the health wait ends.
    const curl = join(directory, 'bin', 'curl');
    await writeFile(curl, `#!/bin/sh\necho '{"status":"ok"}'\n`);
    await chmod(curl, 0o755);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('checks, stops, keeps the old database aside, copies in, starts', async () => {
    await writeFile(join(data, 'budget-buddy.sqlite'), 'OLD DB');
    await writeFile(join(data, 'budget-buddy.sqlite-wal'), 'OLD WAL');
    await writeFile(join(data, 'budget-buddy.sqlite-shm'), 'OLD SHM');

    const result = await restore();

    expect(result.code).toBe(0);
    const calls = await logged();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(
      /^compose run --rm --no-deps -T -v .*budget-buddy-2026-10-10\.sqlite:\/restore\/in\.sqlite:ro app node server\/dist\/verifyBackup\.js \/restore\/in\.sqlite$/u,
    );
    expect(calls[1]).toBe('compose stop app');
    expect(calls[2]).toBe('compose up -d app');
    expect(await readFile(join(data, 'budget-buddy.sqlite'), 'utf8')).toBe(
      'BACKUP CONTENT',
    );
    const left = await readdir(data);
    expect(left).not.toContain('budget-buddy.sqlite-wal');
    expect(left).not.toContain('budget-buddy.sqlite-shm');
    const aside = left.find((name) => name.startsWith('before-restore-'));
    expect(aside).toBeDefined();
    const kept = join(data, aside ?? '');
    expect(await readFile(join(kept, 'budget-buddy.sqlite'), 'utf8')).toBe(
      'OLD DB',
    );
    expect(await readFile(join(kept, 'budget-buddy.sqlite-wal'), 'utf8')).toBe(
      'OLD WAL',
    );
    expect(await readFile(join(kept, 'budget-buddy.sqlite-shm'), 'utf8')).toBe(
      'OLD SHM',
    );
    // Nothing is left half-copied.
    expect(left.filter((name) => name.startsWith('.restore'))).toEqual([]);
  });

  it('restores into a data folder that has no database yet', async () => {
    const result = await restore();
    expect(result.code).toBe(0);
    expect(await readFile(join(data, 'budget-buddy.sqlite'), 'utf8')).toBe(
      'BACKUP CONTENT',
    );
  });

  it('refuses a file that fails the check and changes nothing, not even the app', async () => {
    await writeFile(join(data, 'budget-buddy.sqlite'), 'OLD DB');
    const result = await restore({ FAKE_FAIL: 'run' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('did not pass the check');
    expect(await readdir(data)).toEqual(['budget-buddy.sqlite']);
    expect(await readFile(join(data, 'budget-buddy.sqlite'), 'utf8')).toBe(
      'OLD DB',
    );
    expect((await logged()).some((line) => line.includes('stop'))).toBe(false);
  });

  it('refuses when the check does not say the file is good, whatever its exit status', async () => {
    await writeFile(join(data, 'budget-buddy.sqlite'), 'OLD DB');
    const result = await restore({ FAKE_QUIET: '1' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('did not report that the file is good');
    expect(await readdir(data)).toEqual(['budget-buddy.sqlite']);
    expect((await logged()).some((line) => line.includes('stop'))).toBe(false);
  });

  it('refuses a file that does not exist', async () => {
    const result = await restore({}, join(directory, 'missing.sqlite'));
    expect(result.code).toBe(1);
    expect(result.err).toContain('is not a file');
    expect(await logged()).toEqual([]);
  });

  it('puts the old database back, and restarts the app, when the start fails', async () => {
    await writeFile(join(data, 'budget-buddy.sqlite'), 'OLD DB');
    await writeFile(join(data, 'budget-buddy.sqlite-wal'), 'OLD WAL');
    const result = await restore({ FAKE_FAIL: 'up' });
    expect(result.code).toBe(1);
    expect(await readFile(join(data, 'budget-buddy.sqlite'), 'utf8')).toBe(
      'OLD DB',
    );
    expect(await readFile(join(data, 'budget-buddy.sqlite-wal'), 'utf8')).toBe(
      'OLD WAL',
    );
    expect(
      (await readdir(data)).filter((name) => name.startsWith('before-')),
    ).toEqual([]);
  });

  it('copies back only the images the data folder is missing', async () => {
    await writeFile(join(backups, 'images', 'a.jpg'), 'FROM BACKUP');
    await writeFile(join(backups, 'images', 'b.jpg'), 'FROM BACKUP');
    await mkdir(join(data, 'images'));
    await writeFile(join(data, 'images', 'a.jpg'), 'NEWER IN DATA');
    const result = await restore();
    expect(result.code).toBe(0);
    expect(await readFile(join(data, 'images', 'a.jpg'), 'utf8')).toBe(
      'NEWER IN DATA',
    );
    expect(await readFile(join(data, 'images', 'b.jpg'), 'utf8')).toBe(
      'FROM BACKUP',
    );
  });

  it('uses the commands it is given in place of compose', async () => {
    const result = await restore({
      BB_VERIFY:
        'echo verify "$BB_FILE" >> steps.log; echo "ok (migration version 3)"',
      BB_STOP: 'echo stop >> steps.log',
      BB_START: 'echo start >> steps.log',
    });
    expect(result.code).toBe(0);
    const steps = (await readFile(join(directory, 'steps.log'), 'utf8'))
      .trim()
      .split('\n');
    expect(steps).toEqual([`verify ${backup}`, 'stop', 'start']);
    expect(await logged()).toEqual([]);
  });
});
