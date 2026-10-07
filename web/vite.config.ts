import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  return {
    envDir,
    plugins: [vue()],
    server: {
      proxy: {
        '/api': env.API_TARGET ?? process.env.API_TARGET ?? 'http://127.0.0.1:3000',
      },
    },
  };
});
