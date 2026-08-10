import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Integration tests for the D1 layer and cron jobs, run inside a real workerd
 * against a real (local) D1. Pure-function tests live in vitest.config.ts,
 * which is much faster to run.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      isolatedStorage: false,
      singleWorker: true,
      miniflare: {
        compatibilityDate: '2025-01-15',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
      },
    }),
  ],
  test: {
    include: ['test/integration/**/*.test.ts'],
    globals: true,
  },
});
