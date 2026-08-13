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
    //
    // `feature/pdf-generation` suma `src/services/pdf/**` y
    // `src/routes/facturas.ts`: tanto `buildInvoiceData`/`generateFacturaPdf`
    // (mapeo de datos + guarda de `estado`) como la ruta HTTP tienen
    // cobertura de test real (ver `tests/integration/services/pdf.test.ts` y
    // `tests/integration/routes/facturas-pdf.test.ts`), así que se suman
    // ambos paths al `include` con el mismo umbral que ya usan las demás
    // ramas de Etapa 3 (ver `origin/feature/precios-base-service`).
    coverage: {
      provider: 'v8',
      include: ['src/services/pdf/**', 'src/routes/facturas.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
