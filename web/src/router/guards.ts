import type { Router } from 'vue-router';
import { refreshAuthState } from '../stores/auth.js';

let setupNeeded: boolean | undefined;

/** Records successful first start so later navigation can leave setup. */
export function completeFirstStart(): void {
  setupNeeded = false;
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
