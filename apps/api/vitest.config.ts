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
      include: ['src/services/fiscal-rules/**', 'src/services/precios-base/**','src/modules/usuarios-auth/**'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
