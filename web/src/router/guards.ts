import type { Router } from 'vue-router';
import { isOnline } from '../composables/useOnline.js';
import { refreshAuthState } from '../stores/auth.js';

let setupNeeded: boolean | undefined;

/** Records successful first start so later navigation can leave setup. */
export function completeFirstStart(): void {
  setupNeeded = false;
}

/**
 * Without a connection the server cannot confirm anything, so a failed check
 * must not send the device to sign-in: the screen opens, shows the offline
 * note and its own can't-load state, and a session that has really ended is
 * found when the connection returns and a request answers 401 (IOS-6).
 */
function openOffline(): boolean {
  return !isOnline.value;
}

/** Installs setup, session and profile guards for the app's routes. */
export function installRouteGuards(router: Router): void {
  router.beforeEach(async (to) => {
    if (to.name === 'ComponentsGallery') return;

    if (setupNeeded === undefined) {
      try {
        const response = await fetch('/api/setup');
        if (!response.ok) throw new Error('Could not read setup status.');
        const status = (await response.json()) as { needed: boolean };
        setupNeeded = status.needed;
      } catch {
        if (openOffline()) return;
        if (to.path === '/sign-in') return;
        return { name: 'SignIn' };
      }
    }

    if (setupNeeded) {
      if (to.path !== '/setup') return { name: 'Setup' };
      return;
    }

    let state;
    try {
      state = await refreshAuthState();
    } catch {
      if (openOffline()) return;
      if (to.path === '/sign-in') return;
      return { name: 'SignIn' };
    }

    if (!state || !state.member) {
      if (to.path !== '/sign-in') return { name: 'SignIn' };
      return;
    }

    if (to.path === '/setup' || to.path === '/sign-in') {
      return { path: '/' };
    }
  });
}
