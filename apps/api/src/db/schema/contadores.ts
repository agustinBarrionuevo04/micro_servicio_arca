import { pgTable, uuid, integer, primaryKey } from 'drizzle-orm/pg-core';
import { usuarios } from './usuarios.js';

/**
 * Numeración de comprobantes por (usuario, punto de venta, tipo de
 * comprobante). Se actualiza siempre dentro de una transacción con
 * `INSERT ... ON CONFLICT DO UPDATE` (ver `getNextNumero`, patrón que se
 * mantiene sin cambios de comportamiento en esta rama — solo se renombra
 * `tenantId` a `usuarioId`) para que dos requests concurrentes del mismo
 * usuario no reciban el mismo número.
 */
export const contadores = pgTable('contadores', {
  usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id, { onDelete: 'cascade' }),
  ptoVta: integer('pto_vta').notNull(),
  cbteTipo: integer('cbte_tipo').notNull(),
  ultimoNumero: integer('ultimo_numero').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.usuarioId, table.ptoVta, table.cbteTipo] }),
}));

export type Contador = typeof contadores.$inferSelect;
export type NewContador = typeof contadores.$inferInsert;
