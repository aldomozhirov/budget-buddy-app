import { expect, test } from '@playwright/test';

// The worker runs only in this spec and in installable-app.spec.ts; every
// other spec blocks it.
test.use({ serviceWorkers: 'allow' });

test('the production build registers one worker that keeps the shell and handles push', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin)
      externalRequests.push(request.url());
  });

  await page.goto('/setup');
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      script: registration.active?.scriptURL,
      scope: registration.scope,
      caches: await caches.keys(),
    };
  });
  expect(worker.script).toBe(`${origin}/sw.js`);
  expect(worker.scope).toBe(`${origin}/`);
  // One cache for this build, and nothing that is not part of the app shell.
  expect(worker.caches).toHaveLength(1);
  expect(worker.caches[0]).toMatch(/^bb-shell-[0-9a-f]{8}$/u);

  const response = await page.request.get('/sw.js');
  expect(response.headers()['content-type']).toMatch(/javascript/u);
  const source = await response.text();
  expect(source).toMatch(/["'`]push["'`]/u);
  expect(source).toMatch(/["'`]notificationclick["'`]/u);
  expect(externalRequests).toEqual([]);
});
