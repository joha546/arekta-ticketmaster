import { defineConfig } from 'vitest/config';

const sharedAlias = {
  '@repo/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
};

export default defineConfig({
  resolve: {
    alias: sharedAlias,
  },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        resolve: { alias: sharedAlias },
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/integration/**'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        resolve: { alias: sharedAlias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/integration/setup.ts'],
        },
      },
    ],
  },
});
