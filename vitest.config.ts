import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          include: ['shared/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          include: ['server/test/**/*.test.ts'],
        },
      },
      // Web tests use web's own config, which compiles .vue files.
      'web/vitest.config.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporter: 'dot',
  },
});
