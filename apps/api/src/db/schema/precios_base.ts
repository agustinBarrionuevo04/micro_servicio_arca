import { pgTable, uuid, numeric, date } from 'drizzle-orm/pg-core';

/**
 * Historial de precio base por unidad (~$95.000 hoy, ajustado por
 * inflación de tanto en tanto). `importe_total = unidades × precio_base_vigente(periodo)`
 * (ver PLAN.md, "Regla de negocio central") — el precio a usar se busca por
 * el rango de vigencia que contiene el período facturado, nunca "el precio
 * actual a secas", para que una factura de un mes viejo no se recalcule mal
 * si el precio ya cambió para hoy.
 *
 * `vigenteHasta = null` significa "vigente hasta nuevo aviso" (la fila
 * actual); al cargar un precio nuevo, la fila anterior debería cerrarse
 * (setear su `vigenteHasta`) en la misma operación que abre la nueva.
 *
 * Decisión: la no-superposición de rangos de vigencia se valida a nivel
 * aplicación, no con un `EXCLUDE` constraint de Postgres (que requeriría
 * la extensión `btree_gist` solo para esta tabla). Esta tabla cambia rara
 * vez —ajustes por inflación, sembrados a mano, sin UI de administración en
 * el MVP (ver PLAN.md)— así que el costo de instalar/mantener `btree_gist`
 * no se justifica frente al de que quien inserte (una función de servicio
 * en `feature/precios-base-service`) valide el rango antes de insertar.
 */
export const preciosBase = pgTable('precios_base', {
  id: uuid('id').primaryKey().defaultRandom(),
  precio: numeric('precio', { precision: 12, scale: 2 }).notNull(),
  vigenteDesde: date('vigente_desde').notNull(),
  vigenteHasta: date('vigente_hasta'),
});

export type PrecioBase = typeof preciosBase.$inferSelect;
export type NewPrecioBase = typeof preciosBase.$inferInsert;
