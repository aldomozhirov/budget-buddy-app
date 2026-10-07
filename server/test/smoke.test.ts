import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('health route', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports the service status', async () => {
    app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', migrationVersion: 0 });
  });
});
