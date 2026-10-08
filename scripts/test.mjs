import { spawnSync } from 'node:child_process';
import process from 'node:process';

// Drop the `--` from `pnpm test -- --reporter=verbose`; pass the rest on.
const extraArgs = process.argv.slice(2).filter((argument) => argument !== '--');
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...extraArgs],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
