import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** A running server with one family; the page's session is signed in. */
export interface Family {
  origin: string;
  api: APIRequestContext;
  /** The server's data folder, for a test that moves the session's clock. */
  dataDirectory: string;
  /** Stops the server, as a phone without a connection to it would see. */
  stop(): Promise<void>;
}

/**
 * Runs `run` against a real server (the production build) with a fresh data
 * folder and one profile, and cleans up after it.
 */
export async function startFamily(
  page: Page,
  run: (family: Family) => Promise<void>,
): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'budget-buddy-sideways-e2e-'),
  );
  const server: ChildProcess = spawn(
    process.execPath,
    ['server/dist/index.js'],
    {
      env: {
        ...process.env,
        APP_ORIGIN: origin,
        BACKUP_DIR: path.join(dataDirectory, 'backups'),
        DATA_DIR: dataDirectory,
        HOST: '127.0.0.1',
        NODE_ENV: 'development',
        PORT: String(port),
        RATES_FEED: 'fixture',
      },
      stdio: 'ignore',
    },
  );
  try {
    await waitForServer(`${origin}/api/health`, server);
    const api = page.context().request;
    const setup = await api.post(`${origin}/api/setup`, {
      headers: { Origin: origin },
      data: {
        password: 'correct horse battery staple',
        passwordConfirmation: 'correct horse battery staple',
        profiles: ['Alena'],
      },
    });
    expect(setup.status()).toBe(201);
    const stop = async () => {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill('SIGTERM');
        await once(server, 'exit').catch(() => undefined);
      }
    };
    await run({ origin, api, dataDirectory, stop });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit').catch(() => undefined);
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

/** Posts to the API as the signed-in member; returns the new row's id. */
export async function create(
  family: Family,
  route: string,
  data: Record<string, unknown>,
): Promise<number> {
  const response = await family.api.post(`${family.origin}${route}`, {
    headers: { Origin: family.origin },
    data,
  });
  expect(response.status(), `${route} ${await response.text()}`).toBe(201);
  const body = (await response.json()) as Record<string, { id: number }>;
  return Object.values(body)[0]!.id;
}

async function availablePort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a port');
  }
  await new Promise<void>((resolvePromise, reject) =>
    listener.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}
