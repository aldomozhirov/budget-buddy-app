import { fileURLToPath } from 'node:url';
import { parseConfig } from './config.js';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { systemClock } from './clock.js';
import { createJobRunner } from './jobs/runner.js';
import { createCheckinScheduleJob } from './jobs/checkinSchedule.js';
import { createRatesJob } from './jobs/rates.js';
import { createNotifier } from './notify/notifier.js';
import { createWebPushSender } from './modules/push/sender.js';
import { loadOrCreateVapidKeys } from './modules/push/vapid.js';
import { createCheckinEventBus } from './events.js';
import { createFixtureFeed } from './rates/fixtureFeed.js';
import { createLiveFeeds } from './rates/feeds/index.js';
import { createRateHttpClient } from './rates/http.js';
import { createRatesService } from './rates/service.js';
import { closeOnSignals } from './shutdown.js';

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
  const rates = createRatesService({
    database,
    clock: systemClock,
    feeds:
      config.ratesFeed === 'live'
        ? createLiveFeeds(
            createRateHttpClient({ allowedHosts: config.ratesAllowedHosts }),
          )
        : [createFixtureFeed()],
    logger: { error: (error, message) => app?.log.error(error, message) },
  });
  // Shared with the schedule job, which opens check-ins outside any request.
  const events = createCheckinEventBus((error) =>
    app?.log.error(error, 'Check-in event failed'),
  );
  const vapidKeys = await loadOrCreateVapidKeys(config.keysDir);
  const notifier = createNotifier({
    database,
    clock: systemClock,
    events,
    sender: createWebPushSender({
      keys: vapidKeys,
      subject: config.vapidSubject,
      allowedHosts: config.pushAllowedHosts,
    }),
  });
  app = await createApp({
    database,
    events,
    appOrigins: config.appOrigins,
    secureCookies: config.nodeEnv !== 'development',
    rates,
    push: {
      publicKey: vapidKeys.publicKey,
      allowedHosts: config.pushAllowedHosts,
    },
  });
  // Jobs are added here as they are built (schedule, reminders, backup).
  const jobRunner = createJobRunner({
    database,
    clock: systemClock,
    jobs: [
      createRatesJob(rates),
      createCheckinScheduleJob({ database, clock: systemClock, events }),
    ],
    logger: app.log,
  });
  app.addHook('onClose', async () => {
    await jobRunner.stop();
    await rates.idle();
    await notifier.close();
  });
  const server = app;
  closeOnSignals({
    close: () => server.close(),
    release: () => database?.close(),
    logger: server.log,
  });
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
