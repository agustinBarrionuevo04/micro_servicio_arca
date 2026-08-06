import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/integration/env-setup.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/services/fiscal-rules/**', 'src/services/idempotency/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
