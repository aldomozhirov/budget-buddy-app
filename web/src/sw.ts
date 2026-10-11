/**
 * The app's service worker, built to `/sw.js`. It handles Web Push and keeps
 * the app shell (the page, scripts, styles, fonts, manifest and icons) so the
 * installed app opens offline. It never touches `/api`.
 */
import {
  installPushHandlers,
  type WorkerScope,
} from './push/serviceWorkerHandlers.js';
import {
  installShellCache,
  type ShellEntry,
  type ShellScope,
} from './shell/shellCache.js';

// The DOM typings of `self` describe a window; this file runs in a worker.
// `__WB_MANIFEST` is replaced at build time with the list of built files.
declare const self: WorkerScope & ShellScope & { __WB_MANIFEST: ShellEntry[] };

installPushHandlers(self);
installShellCache(self, self.__WB_MANIFEST);
