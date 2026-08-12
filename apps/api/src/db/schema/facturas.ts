import { pgTable, uuid, varchar, text, timestamp, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { estadoFacturaEnum } from './enums.js';

/**
 * `cae`/`vencimientoCae`/`numero` quedan null mientras `estado` es
 * 'pendiente' o si terminó 'rechazada'. El índice único
 * `(tenantId, idempotencyKey)` es la garantía real de "una sola vez" del
 * `Idempotency-Key` — `services/idempotency` solo hace el lookup previo.
 */
export const facturas = pgTable('facturas', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
  cae: varchar('cae', { length: 20 }),
  vencimientoCae: varchar('vencimiento_cae', { length: 10 }),
  numero: varchar('numero', { length: 20 }),
  cbteTipo: integer('cbte_tipo').notNull(),
  estado: estadoFacturaEnum('estado').notNull().default('pendiente'),
  payloadEnviado: jsonb('payload_enviado').notNull(),
  respuestaArca: jsonb('respuesta_arca'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdempotencyIdx: uniqueIndex('tenant_idempotency_idx').on(table.tenantId, table.idempotencyKey),
}));

export type Factura = typeof facturas.$inferSelect;
export type NewFactura = typeof facturas.$inferInsert;
