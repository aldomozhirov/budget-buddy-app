import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';

// The root user can write anywhere, so the refusal cannot be shown as root.
const asRoot = process.getuid?.() === 0 || process.platform === 'win32';

describe.skipIf(asRoot)('a data folder the app cannot write', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'budget-buddy-readonly-'));
  });

  afterEach(async () => {
    await chmod(join(directory, 'data'), 0o755).catch(() => undefined);
    await chmod(join(directory, 'backups'), 0o755).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it.each(['data', 'backups'])(
    'is refused with a reason that names the folder and BB_UID (%s)',
    async (readOnly) => {
      await mkdir(join(directory, 'data'));
      await mkdir(join(directory, 'backups'));
      await chmod(join(directory, readOnly), 0o555);

      await expect(
        openDatabase(
          parseConfig({
            NODE_ENV: 'test',
            DATA_DIR: join(directory, 'data'),
            BACKUP_DIR: join(directory, 'backups'),
          }),
        ),
      ).rejects.toThrow(
        new RegExp(`${readOnly} folder .* cannot be written .* BB_UID`, 'u'),
      );
    },
  );
});
