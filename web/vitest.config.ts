import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Compiles .vue files so component tests can render them.
  plugins: [vue()],
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
