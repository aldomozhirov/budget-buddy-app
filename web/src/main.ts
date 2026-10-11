import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { registerServiceWorker } from './push/registerServiceWorker.js';
// Global styles; order matters: design-system base before app styles.
import './styles/fonts/geist.css';
import './styles/bb.css';
import './styles.css';

createApp(App).use(router).mount('#app');
void registerServiceWorker((path) => void router.push(path));

// After an update, a page still running the old build can ask for a script
// that the new build no longer has. Loading the page again gets the new
// build; the flag stops a loop if the page is broken for another reason, and
// is cleared once a page has stayed up.
const reloadedKey = 'bb.reloadedForUpdate';
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem(reloadedKey)) return;
  sessionStorage.setItem(reloadedKey, '1');
  window.location.reload();
});
window.addEventListener('load', () => {
  window.setTimeout(() => sessionStorage.removeItem(reloadedKey), 10_000);
});
