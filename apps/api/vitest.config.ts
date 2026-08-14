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
    // routes/index.ts para el porqué. `include: []` NO desactiva el umbral:
    // v8 sigue instrumentando todo `src/` y los thresholds de abajo se
    // siguen evaluando contra eso, así que se sacan también (confirmado:
    // `pnpm test:coverage` fallaba ~20-35% contra un piso de 80% con
    // `include` vacío y los thresholds puestos). Las ramas que reemplazan
    // esos módulos (feature/fiscal-rules-v2, y la idempotencia por clave
    // natural que absorbe feature/facturas-service-v2) deben apuntar
    // `include` a sus módulos nuevos y reinstalar `thresholds` juntos —
    // uno sin el otro no tiene efecto real.
    coverage: {
      provider: 'v8',
      include: [],
    },
  },
});
