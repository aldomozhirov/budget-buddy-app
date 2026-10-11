import { readonly, ref } from 'vue';

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
}

/**
 * Whether the device has a connection, as the browser reports it. An action
 * that needs the server is disabled while this is false (IOS-6); the browser
 * can say "online" while the server is out of reach, and then the action
 * fails with its own message as before.
 */
export const isOnline = readonly(online);
