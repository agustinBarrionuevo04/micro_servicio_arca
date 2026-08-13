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
    // esos módulos deben apuntar `include` a sus módulos nuevos y
    // reinstalar `thresholds` juntos — uno sin el otro no tiene efecto real.
    //
    // `modules/usuarios-auth` (`feature/usuarios-auth`) se suma acá: login,
    // refresh (con rotación) y el middleware de autenticación, cubiertos
    // por tests unitarios (passwords/jwt/tokens en aislamiento) e
    // integración (flujo HTTP completo contra Postgres real, ver
    // `tests/integration/usuarios-auth.test.ts`). El resto de los módulos
    // de Etapa 3 (`services/precios-base`, `services/fiscal-rules`,
    // `services/arca`, `services/pdf`) deben sumar el suyo cuando aterricen.
    coverage: {
      provider: 'v8',
      include: ['src/modules/usuarios-auth/**'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
