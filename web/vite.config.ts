import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  return {
    envDir,
    plugins: [
      vue(),
      // Builds src/sw.ts to dist/sw.js. Registration is in
      // src/push/registerServiceWorker.ts and only happens in the production
      // build, so the dev server never has a worker. Task 27 adds the
      // manifest and sets `injectionPoint` to precache the app shell.
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest: false,
        injectManifest: { injectionPoint: undefined },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      // Lets the dev server answer on the Mac's Tailscale name
      // (`tailscale serve`); Vite rejects unknown hostnames otherwise.
      allowedHosts: ['.ts.net'],
      proxy: {
        '/api': env.API_TARGET ?? process.env.API_TARGET ?? 'http://127.0.0.1:3000',
      },
    },
  };
});
