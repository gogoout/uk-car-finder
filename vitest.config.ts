import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-function tests only. Anything needing D1 or workerd lives in
    // test/integration and runs under vitest.workers.config.ts.
    include: ['test/*.test.ts'],
    globals: true,
    environment: 'node',
  },
});
