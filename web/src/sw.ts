/**
 * The app's service worker, built to `/sw.js`. Today it only handles Web Push.
 * Task 27 adds precaching of the app shell here, around the call below.
 */
import {
  installPushHandlers,
  type WorkerScope,
} from './push/serviceWorkerHandlers.js';

// The DOM typings of `self` describe a window; this file runs in a worker.
declare const self: WorkerScope;

installPushHandlers(self);
