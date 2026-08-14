import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/integration/env-setup.ts'],
    fileParallelism: false,
   
    // `services/arca` (`feature/arca-service-per-user`) se suma acá: el
    // test de regresión (`tests/unit/arca.test.ts`) cubre la resolución de
    // `ambiente` por usuario, el aislamiento entre dos usuarios en el mismo
    // proceso, el cacheo por `usuarioId`, la traducción de rechazo
    // silencioso de ARCA a `ArcaRejectionError`, y `getStatus()`. Ramas
    // hermanas (`feature/fiscal-rules-v2`, `feature/precios-base-service`)
    // suman su propio path a este mismo array por separado — un merge que
    // junte varias va a necesitar reconciliar este array a mano (esperado,
    // ver PLAN.md / FASE2.md sobre el diff inflado hasta que
    // `feature/db-schema-v2` mergee).
    coverage: {
      provider: 'v8',
      include: ['src/services/fiscal-rules/**', 'src/services/precios-base/**'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
