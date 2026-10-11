import { isAppPath } from './payload.js';

/** Where the build puts the service worker (`src/sw.ts`). */
export const serviceWorkerUrl = '/sw.js';

/**
 * Registers the service worker in the production build, checks for a new
 * build whenever the app returns to the front, and passes on the taps on
 * notifications that its handlers post to the page. Development and
 * tests (Vite's dev server) run without a service worker so that they can
 * never be served stale code.
 * @param navigate Moves the router to an in-app path.
 */
export async function registerServiceWorker(
  navigate: (path: string) => void,
): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as Partial<{ type: string; url: string }> | null;
    if (data?.type === 'navigate' && isAppPath(data.url)) navigate(data.url);
  });
  try {
    const registration = await navigator.serviceWorker.register(
      serviceWorkerUrl,
      { scope: '/' },
    );
    // A Home Screen app is resumed, not reloaded, so the browser would not
    // look for a new build; ask when the app comes back to the front.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => undefined);
      }
    });
  } catch {
    // Without a worker the app works the same; only push is unavailable.
  }
}
