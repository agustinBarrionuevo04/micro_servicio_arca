import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/integration/env-setup.ts'],
    fileParallelism: false,
    // `services/idempotency` (el otro módulo que este coverage cubría antes
    // de `feature/db-schema-v2`) todavía no tiene reemplazo — la idempotencia
    // por clave natural la absorbe `feature/facturas-service-v2`, que debe
    // sumar su propio path acá cuando aterrice. `services/fiscal-rules` ya
    // está de vuelta (esta rama) con cobertura casi total al ser funciones
    // puras, así que reinstala su threshold.
    coverage: {
      provider: 'v8',
      include: ['src/services/fiscal-rules/**'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
