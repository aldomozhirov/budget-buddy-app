import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { registerServiceWorker } from './push/registerServiceWorker.js';
import { installSessionLock } from './session/lock.js';
// Global styles; order matters: design-system base before app styles.
import './styles/fonts/geist.css';
import './styles/bb.css';
import './styles.css';

createApp(App).use(router).mount('#app');
installSessionLock(router);
void registerServiceWorker((path) => void router.push(path));

// After an update, a page still running the old build can ask for a script
// that the new build no longer has. Loading the page again gets the new
// build; the flag stops a loop if the page is broken for another reason, and
// is cleared once a page has stayed up. A page that is being left cancels its
// own loads and raises the same event, so the reload waits to see whether the
// page is still there.
const reloadedKey = 'bb.reloadedForUpdate';
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem(reloadedKey)) return;
  window.setTimeout(() => {
    sessionStorage.setItem(reloadedKey, '1');
    window.location.reload();
  }, 500);
});
window.addEventListener('load', () => {
  window.setTimeout(() => sessionStorage.removeItem(reloadedKey), 10_000);
});
