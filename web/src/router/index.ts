import { shallowRef } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import { installRouteGuards } from './guards.js';

export { completeFirstStart } from './guards.js';

/** CSS class used for the most recent screen navigation. */
export type ScreenTransitionClass = '' | 'enter-fwd' | 'enter-back';

/** In-memory locations visited before the current screen. */
export const navigationStack = shallowRef<string[]>([]);

/** Directional screen animation applied to the active route component. */
export const screenTransitionClass = shallowRef<ScreenTransitionClass>('');

const galleryEnabled =
  import.meta.env.DEV || import.meta.env.VITE_COMPONENT_GALLERY === 'true';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../screens/home/HomeScreen.vue'),
    meta: { title: 'Home' },
  },
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('../screens/setup/SetupScreen.vue'),
    meta: { title: 'First start' },
  },
  {
    path: '/sign-in',
    name: 'SignIn',
    component: () => import('../screens/sign-in/SignInScreen.vue'),
    meta: { title: 'Sign in' },
  },
  {
    path: '/check-in',
    name: 'CheckIn',
    component: () => import('../screens/checkin/CheckinScreen.vue'),
    meta: { title: 'Check-in' },
  },
  {
    path: '/check-ins',
    name: 'CheckIns',
    component: () => import('../screens/checkins/CheckInsScreen.vue'),
    meta: { title: 'Check-ins' },
  },
  {
    path: '/check-ins/:id',
    name: 'CheckInSummary',
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'Check-in summary' },
  },
  {
    path: '/accounts',
    name: 'Accounts',
    component: () => import('../screens/accounts/AccountsScreen.vue'),
    meta: { title: 'Accounts' },
  },
  {
    path: '/accounts/new',
    name: 'NewAccount',
    component: () => import('../screens/accounts/NewAccountScreen.vue'),
    meta: { title: 'New account' },
  },
  {
    path: '/accounts/:id',
    name: 'AccountDetail',
    component: () => import('../screens/accounts/AccountScreen.vue'),
    meta: { title: 'Account' },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../screens/settings/SettingsScreen.vue'),
    meta: { title: 'Settings' },
  },
];

if (galleryEnabled) {
  routes.push({
    path: '/dev/components',
    name: 'ComponentsGallery',
    component: () => import('../screens/dev/Components.vue'),
    meta: { title: 'Components' },
  });
}

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' });

const history = createWebHistory(import.meta.env.BASE_URL);
const pendingPopNavigations: {
  to: string;
  from: string;
  direction: 'back' | 'forward' | '';
}[] = [];

history.listen((to, from, information) => {
  if (information.type === 'pop') {
    pendingPopNavigations.push({ to, from, direction: information.direction });
  }
});

/** Router for the app's screens and in-memory navigation. */
export const router = createRouter({
  history,
  routes,
});
installRouteGuards(router);

let pendingNavigation: 'back' | 'fallback' | null = null;

router.afterEach((to, from, failure) => {
  const popIndex = pendingPopNavigations.findIndex(
    (navigation) =>
      navigation.to === to.fullPath && navigation.from === from.fullPath,
  );
  const popNavigation =
    popIndex >= 0 ? pendingPopNavigations.splice(popIndex, 1)[0] : undefined;

  if (failure) {
    pendingNavigation = null;
    return;
  }
  if (from.matched.length === 0) return;

  if (pendingNavigation === 'fallback') {
    pendingNavigation = null;
    screenTransitionClass.value = 'enter-back';
    return;
  }

  if (pendingNavigation === 'back') {
    pendingNavigation = null;
    navigationStack.value = navigationStack.value.slice(0, -1);
    screenTransitionClass.value = 'enter-back';
    return;
  }

  if (popNavigation?.direction === 'back') {
    const destinationIndex = navigationStack.value.lastIndexOf(to.fullPath);
    navigationStack.value =
      destinationIndex >= 0
        ? navigationStack.value.slice(0, destinationIndex)
        : [];
    screenTransitionClass.value = 'enter-back';
    return;
  }

  if (popNavigation?.direction === 'forward') {
    navigationStack.value = [...navigationStack.value, from.fullPath];
    screenTransitionClass.value = 'enter-fwd';
    return;
  }

  navigationStack.value = [...navigationStack.value, from.fullPath];
  screenTransitionClass.value = 'enter-fwd';
});

function naturalParent(path: string): string {
  if (path.startsWith('/accounts/')) return '/accounts';
  if (path.startsWith('/check-ins/')) return '/check-ins';
  return '/';
}

/** Returns the screen this route should return to when history is empty. */
export function fallbackLocation(path: string): string {
  return naturalParent(path);
}

/** Navigates to the previous in-app screen or the route's natural parent. */
export function navigateBack(path: string): void {
  const previous = navigationStack.value.at(-1);

  if (previous) {
    pendingNavigation = 'back';
    void router.back();
    return;
  }

  const parent = naturalParent(path);
  if (parent === path) return;

  pendingNavigation = 'fallback';
  void router.replace(parent);
}
