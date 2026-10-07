import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

const webDistPath = fileURLToPath(new URL('../../web/dist', import.meta.url));

export async function createApp() {
  const app = Fastify({ logger: true });

  app.get('/api/health', async () => ({
    status: 'ok',
    migrationVersion: 0,
    appVersion: '0.1.0',
  }));

  try {
    await access(webDistPath);
    await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }
      if (request.method === 'GET') return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send();
    });
  } catch {
    // During development the Vite server serves the web app.
  }

  return app;
}

export function webAssetsPath(): string {
  return path.resolve(webDistPath);
}
