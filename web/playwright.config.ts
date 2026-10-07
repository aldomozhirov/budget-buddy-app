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
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
});
