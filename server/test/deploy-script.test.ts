import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stat } from 'node:fs/promises';

const run = promisify(execFile);
const script = fileURLToPath(
  new URL('../../scripts/deploy.sh', import.meta.url),
);

/**
 * `deploy.sh` rebuilds and restarts the family's container after a merge. A
 * fake `docker` and `curl` on PATH record the calls and answer as a project
 * with or without a container, a failing build or an unhealthy start would,
 * so the rules of AGENTS.md (skip, leave the container alone, never `down`)
 * are checked without Docker. The real compose run is recorded in the spec
 * (task 30, "Run from the development checkout").
 */
describe('scripts/deploy.sh with a fake docker', () => {
  let directory: string;
  let calls: string;

  const deploy = async (env: Record<string, string> = {}) => {
    try {
      const { stdout } = await run(
        'bash',
        [join(directory, 'scripts', 'deploy.sh')],
        {
          cwd: directory,
          env: {
            PATH: `${join(directory, 'bin')}:${process.env.PATH ?? ''}`,
            HOME: directory,
            BB_DEPLOY_TIMEOUT: '1',
            FAKE_CONTAINER: '1',
            FAKE_VERSION: '2',
            ...env,
          },
        },
      );
      return { code: 0, out: stdout };
    } catch (error) {
      const failure = error as { code: number; stdout: string };
      return { code: failure.code, out: failure.stdout };
    }
  };
  const logged = async () =>
    (await readFile(calls, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean);
  const settings = (origin: string) =>
    writeFile(
      join(directory, '.env'),
      `APP_ORIGIN=http://127.0.0.1:5173\n${origin}\n`,
    );

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-deploy-'));
    calls = join(directory, 'calls.log');
    await mkdir(join(directory, 'bin'));
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'server', 'drizzle'), { recursive: true });
    await copyFile(script, join(directory, 'scripts', 'deploy.sh'));
    await writeFile(join(directory, 'server', 'drizzle', '0000_a.sql'), '');
    await writeFile(join(directory, 'server', 'drizzle', '0001_b.sql'), '');
    // FAKE_CONTAINER: a container exists; FAKE_FAIL: a compose subcommand
    // that fails (build, up).
    await writeFile(
      join(directory, 'bin', 'docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$*" in "compose build") printf '%s\\n' "$BB_APP_COMMIT" > "${directory}/commit.log" ;; esac
case "$*" in
  "info") exit 0 ;;
  "compose ps -a -q") [ -n "$FAKE_CONTAINER" ] && echo abc123; exit 0 ;;
  "compose port app 8080") echo 127.0.0.1:8091; exit 0 ;;
  "compose logs --tail 30 app") echo 'app-1 | the last log line'; exit 0 ;;
esac
if [ -n "$FAKE_FAIL" ]; then
  case "$*" in "compose $FAKE_FAIL"*) echo 'it broke'; exit 1 ;; esac
fi
exit 0
`,
    );
    await chmod(join(directory, 'bin', 'docker'), 0o755);
    await writeFile(
      join(directory, 'bin', 'curl'),
      `#!/bin/sh\necho '{"status":"ok","migrationVersion":'"$FAKE_VERSION"',"appVersion":"0.1.0"}'\n`,
    );
    await chmod(join(directory, 'bin', 'curl'), 0o755);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('skips, touching nothing, when the container settings are absent', async () => {
    const result = await deploy();

    expect(result.code).toBe(10);
    expect(result.out).toMatch(/^deploy: SKIPPED\. BB_APP_ORIGIN is not set/mu);
    expect(await logged()).toEqual([]);
  });

  it('does not take the development origin for the container settings', async () => {
    await settings('# BB_APP_ORIGIN=https://example.ts.net');

    expect((await deploy()).code).toBe(10);
  });

  it('refuses an origin that is not https', async () => {
    await settings('BB_APP_ORIGIN=http://127.0.0.1:5173');

    const result = await deploy();

    expect(result.code).toBe(13);
    expect(await logged()).toEqual([]);
  });

  it('skips when no container of the project exists, never creating one', async () => {
    await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');

    const result = await deploy({ FAKE_CONTAINER: '' });

    expect(result.code).toBe(10);
    expect(result.out).toContain('No container of this compose project exists');
    expect(await logged()).toEqual(['info', 'compose ps -a -q']);
  });

  it('builds, replaces the container and waits for matching health', async () => {
    await settings('BB_APP_ORIGIN="https://mac.tailnet.ts.net" # the family');

    const result = await deploy();

    expect(result.code).toBe(0);
    expect(result.out).toMatch(
      /^deploy: DEPLOYED\. http:\/\/127\.0\.0\.1:8091\/api\/health answers ok, migrationVersion 2 equals the 2 migration files\.$/mu,
    );
    expect(await logged()).toEqual([
      'info',
      'compose ps -a -q',
      'compose build',
      'compose up -d',
      'compose port app 8080',
    ]);
  });

  describe('feedback folder and build commit', () => {
    // Without the GIT_* variables of a hook that runs the tests (GIT_DIR,
    // GIT_INDEX_FILE ...), which would point git at the checkout instead.
    const gitEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    );
    const git = (...args: string[]) =>
      run('git', args, { cwd: directory, env: gitEnv });
    const commitSeen = async () =>
      (await readFile(join(directory, 'commit.log'), 'utf8')).trim();
    const exists = (path: string) =>
      stat(join(directory, path)).then(
        () => true,
        () => false,
      );
    let head: string;

    beforeEach(async () => {
      await git('init', '-q');
      await git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'first',
      );
      head = (await git('rev-parse', 'HEAD')).stdout.trim();
    });

    it('makes feedback/ beside data/ and builds with the checked-out commit', async () => {
      await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');

      const result = await deploy();

      expect(result.code).toBe(0);
      expect(await exists('feedback')).toBe(true);
      expect(await commitSeen()).toMatch(/^[0-9a-f]{40}$/u);
      expect(await commitSeen()).toBe(head);
    });

    it('keeps a feedback/ folder that exists, with its files', async () => {
      await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');
      await mkdir(join(directory, 'feedback'));
      await writeFile(join(directory, 'feedback', 'keep.txt'), 'x');

      expect((await deploy()).code).toBe(0);
      expect(await exists('feedback/keep.txt')).toBe(true);
    });

    it('keeps BB_APP_COMMIT from the shell', async () => {
      await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');

      await deploy({ BB_APP_COMMIT: 'from-the-shell' });

      expect(await commitSeen()).toBe('from-the-shell');
    });

    it('leaves BB_APP_COMMIT from .env to compose', async () => {
      await settings(
        'BB_APP_ORIGIN=https://mac.tailnet.ts.net\nBB_APP_COMMIT=from-env-file',
      );

      await deploy();

      // Not exported by the script, so compose reads the .env value itself.
      expect(await commitSeen()).not.toBe(head);
    });

    it('uses unknown when the folder is not a git checkout', async () => {
      await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');
      await rm(join(directory, '.git'), { recursive: true, force: true });

      expect((await deploy()).code).toBe(0);
      expect(await commitSeen()).toBe('unknown');
    });

    it('makes no feedback/ when it skips', async () => {
      const noSettings = await deploy();
      expect(noSettings.code).toBe(10);
      await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');
      const noContainer = await deploy({ FAKE_CONTAINER: '' });
      expect(noContainer.code).toBe(10);

      expect(await exists('feedback')).toBe(false);
      expect(await exists('commit.log')).toBe(false);
    });
  });

  it('leaves the running container alone when the build fails', async () => {
    await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');

    const result = await deploy({ FAKE_FAIL: 'build' });

    expect(result.code).toBe(11);
    expect(result.out).toContain('it broke');
    expect(result.out).toContain('The running container was not touched');
    expect(await logged()).not.toContain('compose up -d');
  });

  it('reports the log lines, without rolling back, when health does not match', async () => {
    await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');

    const result = await deploy({ FAKE_VERSION: '1' });

    expect(result.code).toBe(12);
    expect(result.out).toContain('app-1 | the last log line');
    expect(result.out).toContain('nothing was rolled back');
    expect(
      (await logged()).filter((call) => /down|rm|restore/u.test(call)),
    ).toEqual([]);
  });

  it('reports an up that fails as unhealthy with the log lines', async () => {
    await settings('BB_APP_ORIGIN=https://mac.tailnet.ts.net');

    const result = await deploy({ FAKE_FAIL: 'up' });

    expect(result.code).toBe(12);
    expect(result.out).toContain('app-1 | the last log line');
  });
});
