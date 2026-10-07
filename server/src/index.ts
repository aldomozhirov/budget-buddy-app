import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const dataDir = process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/data' : '../.data');

await mkdir(dataDir, { recursive: true });
const app = await createApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
