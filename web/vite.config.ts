import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The web app manifest (IOS-1). The colours are `--bg` of the light theme in
 * `src/styles/bb.css`; the dark colour is in the `theme-color` tags of
 * `index.html`, because a manifest has only one.
 */
const webManifest = {
  id: '/',
  name: 'Budget Buddy',
  short_name: 'Budget Buddy',
  description: 'A family budget and net worth tracker.',
  start_url: '/',
  scope: '/',
  display: 'standalone' as const,
  background_color: '#F4F3EF',
  theme_color: '#F4F3EF',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};

const envDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  return {
    envDir,
    plugins: [
      vue(),
      // Builds src/sw.ts to dist/sw.js and fills its `__WB_MANIFEST` with the
      // built files that make up the app shell (src/shell/shellCache.ts).
      // Registration is in src/push/registerServiceWorker.ts and only happens
      // in the production build, so the dev server never has a worker.
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest: webManifest,
        includeManifestIcons: false,
        injectManifest: {
          globPatterns: [
            'index.html',
            'assets/**/*.{js,css,woff2}',
            'manifest.webmanifest',
            'icons/*.png',
            'apple-touch-icon.png',
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      // Lets the dev server answer on the Mac's Tailscale name
      // (`tailscale serve`); Vite rejects unknown hostnames otherwise.
      allowedHosts: ['.ts.net'],
      proxy: {
        '/api':
          env.API_TARGET ?? process.env.API_TARGET ?? 'http://127.0.0.1:3000',
      },
    },
  };
});
