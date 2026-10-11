import { defineConfig } from '@playwright/test';

const port = Number.parseInt(process.env.E2E_PORT ?? '4173', 10);

export default defineConfig({
  testDir: './e2e',
  reporter: 'dot',
  fullyParallel: true,
  projects: [
    {
      name: 'iphone',
      use: {
        browserName: 'webkit',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'ipad',
      use: {
        browserName: 'webkit',
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    // The app registers a service worker in the production build. Tests block
    // it so that a worker can never answer from a cache and show old code;
    // a test that needs the worker allows it with `test.use`.
    serviceWorkers: 'block',
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @budget-buddy/web exec vite --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/e2e/fixtures/amount-input.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
