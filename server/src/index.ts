import { fileURLToPath } from 'node:url';
import { parseConfig } from './config.js';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { systemClock } from './clock.js';
import { createJobRunner } from './jobs/runner.js';

// `.env` is optional: config may come from the real environment instead.
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
  app = await createApp({
    database,
    appOrigins: config.appOrigins,
    secureCookies: config.nodeEnv !== 'development',
  });
  // Jobs are added here as they are built (rates, schedule, reminders, backup).
  const jobRunner = createJobRunner({
    database,
    clock: systemClock,
    jobs: [],
    logger: app.log,
  });
  app.addHook('onClose', () => jobRunner.stop());
  await app.listen({ host: config.host, port: config.port });
  jobRunner.start();
} catch (error) {
  if (app) {
    app.log.error(error, 'Server startup failed');
    await app.close();
  } else {
    console.error('Server startup failed', error);
  }
  // Close it even if the app was never created, so the file isn't left open.
  database?.close();
  // Set exitCode instead of calling exit() so pending logs can flush.
  process.exitCode = 1;
}
