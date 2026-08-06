import { pgTable, uuid, integer, primaryKey } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const contadores = pgTable('contadores', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ptoVta: integer('pto_vta').notNull(),
  cbteTipo: integer('cbte_tipo').notNull(),
  ultimoNumero: integer('ultimo_numero').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.tenantId, table.ptoVta, table.cbteTipo] }),
}));

export type Contador = typeof contadores.$inferSelect;
export type NewContador = typeof contadores.$inferInsert;
