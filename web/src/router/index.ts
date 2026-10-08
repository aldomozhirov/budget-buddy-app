import { shallowRef } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';

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
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'First start' },
  },
  {
    path: '/sign-in',
    name: 'SignIn',
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'Sign in' },
  },
  {
    path: '/check-in',
    name: 'CheckIn',
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'Check-in' },
  },
  {
    path: '/check-ins',
    name: 'CheckIns',
    component: () => import('../screens/PlaceholderScreen.vue'),
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
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'Accounts' },
  },
  {
    path: '/accounts/new',
    name: 'NewAccount',
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'New account' },
  },
  {
    path: '/accounts/:id',
    name: 'AccountDetail',
    component: () => import('../screens/PlaceholderScreen.vue'),
    meta: { title: 'Account' },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../screens/PlaceholderScreen.vue'),
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

/** Router for the app's screens and in-memory navigation. */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

let pendingNavigation: 'back' | 'fallback' | null = null;

router.afterEach((to, from, failure) => {
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
    void router.push(previous);
    return;
  }

  const parent = naturalParent(path);
  if (parent === path) return;

  pendingNavigation = 'fallback';
  void router.replace(parent);
}
