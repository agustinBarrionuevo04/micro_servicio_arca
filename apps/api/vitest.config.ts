import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/integration/env-setup.ts'],
    fileParallelism: false,
    // `services/fiscal-rules` y `services/idempotency` (los módulos que
    // este coverage cubría) se eliminaron en `feature/db-schema-v2` — ver
    // routes/index.ts para el porqué. Las ramas que los reemplazan
    // (feature/fiscal-rules-v2, y la idempotencia por clave natural que
    // absorbe feature/facturas-service-v2) deben volver a apuntar `include`
    // a sus módulos nuevos y reinstalar el umbral de cobertura.
    coverage: {
      provider: 'v8',
      include: [],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
