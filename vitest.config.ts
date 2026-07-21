import { defineConfig } from 'vitest/config';

// Stable runner settings (restored to previous config)
export default defineConfig({
  test: {
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 1,
    isolate: true,
    testTimeout: 30000,
  },
});
