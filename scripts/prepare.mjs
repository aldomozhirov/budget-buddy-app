import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
} catch (error) {
  // Skip outside a git checkout (status 128) or when git isn't installed.
  if (error?.status !== 128 && error?.code !== 'ENOENT') throw error;
}
