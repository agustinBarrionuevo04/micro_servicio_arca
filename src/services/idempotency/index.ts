/**
 * Soporte para el header `Idempotency-Key`: permite que un consumidor
 * reintente `POST /v1/facturas` sin riesgo de duplicar una factura ante
 * ARCA. La garantía real de "solo una vez" la da el índice único
 * `(tenant_id, idempotency_key)` en la tabla `facturas` (ver
 * `db/schema/facturas.ts`); este módulo es solo el lookup previo al insert.
 */
import { eq, and } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { facturas, type Factura } from '../../db/schema/index.js';

export interface IdempotencyService {
  findExisting(tenantId: string, idempotencyKey: string): Promise<Factura | null>;
}

/** Recibe `db` inyectado para poder testearse con un mock sin levantar Postgres. */
export function createIdempotencyService(db: Database): IdempotencyService {
  return {
    async findExisting(tenantId: string, idempotencyKey: string): Promise<Factura | null> {
      const result = await db
        .select()
        .from(facturas)
        .where(
          and(
            eq(facturas.tenantId, tenantId),
            eq(facturas.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);

      return result[0] ?? null;
    },
  };
}

/** 255 = límite de `idempotency_key` en el schema; validar antes de tocar la DB. */
export function isIdempotencyKeyValid(key: string | undefined): key is string {
  if (!key) return false;
  if (key.length < 1 || key.length > 255) return false;
  return true;
}
