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
