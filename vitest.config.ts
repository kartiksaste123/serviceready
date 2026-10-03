import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts'],
    testTimeout: process.env.LIVE === '1' ? 120_000 : 10_000
  }
});
