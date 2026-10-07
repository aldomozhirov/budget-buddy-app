import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'budget-buddy-e2e-'));
const port = await availablePort();
const env = {
  ...process.env,
  DATA_DIR: dataDir,
  E2E_PORT: String(port),
  HOST: '127.0.0.1',
  PORT: String(port),
  RATES_FEED: 'fixture',
};
const server = spawn(process.execPath, ['server/dist/index.js'], { env, stdio: 'inherit' });

try {
  await waitForServer(`http://127.0.0.1:${port}/api/health`, server);
  const result = spawn('pnpm', ['exec', 'playwright', 'test', '--config', 'web/playwright.config.ts'], {
    env,
    stdio: 'inherit',
  });
  const [code] = await once(result, 'exit');
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => undefined);
  }
  await rm(dataDir, { recursive: true, force: true });
}

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
  const { port: selectedPort } = address;
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  return selectedPort;
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}
