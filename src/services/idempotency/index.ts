import { eq, and } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { facturas, type Factura } from '../../db/schema/index.js';

export interface IdempotencyService {
  findExisting(tenantId: string, idempotencyKey: string): Promise<Factura | null>;
}

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

export function isIdempotencyKeyValid(key: string | undefined): key is string {
  if (!key) return false;
  if (key.length < 1 || key.length > 255) return false;
  return true;
}
