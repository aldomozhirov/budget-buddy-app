import { expect, test } from '@playwright/test';

// The one place the real worker runs; every other spec blocks it.
test.use({ serviceWorkers: 'allow' });

test('the production build registers a service worker that caches and answers nothing', async ({
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
  expect(worker.caches).toEqual([]);

  // No `fetch` handler in the file the browser runs: it never answers a
  // request, so it cannot serve app code from an old version.
  const response = await page.request.get('/sw.js');
  expect(response.headers()['content-type']).toMatch(/javascript/u);
  const source = await response.text();
  expect(source).not.toMatch(/["'`]fetch["'`]/u);
  expect(source).toMatch(/["'`]push["'`]/u);
  expect(source).toMatch(/["'`]notificationclick["'`]/u);
  expect(externalRequests).toEqual([]);
});
