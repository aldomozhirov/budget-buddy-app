import { fileURLToPath } from 'node:url';
import { parseConfig } from './config.js';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'ENOENT'
  )
    throw error;
}

let database: Awaited<ReturnType<typeof openDatabase>> | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  const config = parseConfig();
  database = await openDatabase(config);
  app = await createApp({ database });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (app) {
    app.log.error(error, 'Server startup failed');
    await app.close();
  } else {
    console.error('Server startup failed', error);
  }
  database?.close();
  process.exitCode = 1;
}
