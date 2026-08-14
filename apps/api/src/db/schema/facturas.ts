import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  date,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { usuarios } from './usuarios.js';
import { estadoFacturaEnum } from './enums.js';

/**
 * Una factura mensual de un usuario a Envío Postal SA.
 *
 * `periodo` es el primer día del mes facturado (ej. `2026-08-01` para
 * agosto 2026), no un string `"YYYY-MM"`: como `date`, tanto la búsqueda de
 * rango de vigencia en `precios_base` como la unicidad `(usuarioId, periodo)`
 * de esta tabla son comparaciones/índices triviales de Postgres, sin
 * parsing de strings ni bugs de formato (ver PLAN.md, "Decisiones de diseño
 * nuevas").
 *
 * `precioBaseUsado` congela el precio efectivamente aplicado al momento de
 * emitir, independiente de que `precios_base` cambie después — una factura
 * ya emitida no se recalcula retroactivamente si sube el precio base.
 *
 * Idempotencia: este producto es una acción mensual desde el celular de un
 * repartidor (no una integración servidor-a-servidor), así que se reemplaza
 * el header `Idempotency-Key` por la clave natural `(usuarioId, periodo)`.
 * El índice único de abajo es parcial (`WHERE estado <> 'error'`) para que
 * un rechazo de ARCA no bloquee ese período para siempre: tras un `error`
 * el usuario puede reintentar y generar una fila nueva para el mismo
 * período, pero nunca puede haber dos filas no-error para el mismo
 * `(usuarioId, periodo)` a la vez.
 */
export const facturas = pgTable(
  'facturas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id, { onDelete: 'cascade' }),
    periodo: date('periodo').notNull(),
    unidades: numeric('unidades', { precision: 10, scale: 2 }).notNull(),
    precioBaseUsado: numeric('precio_base_usado', { precision: 12, scale: 2 }).notNull(),
    importeTotal: numeric('importe_total', { precision: 12, scale: 2 }).notNull(),
    // 11 = Factura C — el único tipo que emite este producto (monotributo,
    // receptor fijo). feature/fiscal-rules-v2 recrea la constante
    // CBTE_TIPO.FACTURA_C = 11 en su módulo nuevo; el valor hardcodeado acá
    // debe seguir siendo 11 aunque ese módulo todavía no exista.
    cbteTipo: integer('cbte_tipo').notNull().default(11),
    ptoVta: integer('pto_vta').notNull(),
    // Null mientras la factura está 'pendiente' (número aún no confirmado
    // por ARCA) o si terminó en 'error'.
    cbteNro: integer('cbte_nro'),
    cae: varchar('cae', { length: 20 }),
    caeFchVto: varchar('cae_fch_vto', { length: 10 }),
    estado: estadoFacturaEnum('estado').notNull().default('pendiente'),
    // Reservado para forward-compat: el plan actual es generar el PDF
    // on-demand (`GET /v1/facturas/:id/pdf` con `@arcasdk/pdf`, sin storage
    // persistente, reconstruible siempre desde los datos de la factura +
    // CAE — ver PLAN.md, "Decisiones de diseño nuevas"), pero se deja la
    // columna por si en el futuro se decide cachear/persistir el PDF.
    pdfUrl: text('pdf_url'),
    // Se mantiene (a diferencia de `idempotencyKey`) porque sigue siendo
    // útil para auditoría/debug de qué se mandó/recibió realmente de ARCA,
    // independientemente de cómo se resuelva la idempotencia.
    payloadEnviado: jsonb('payload_enviado').notNull(),
    respuestaArca: jsonb('respuesta_arca'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    usuarioPeriodoIdx: uniqueIndex('usuario_periodo_idx')
      .on(table.usuarioId, table.periodo)
      .where(sql`${table.estado} <> 'error'`),
  })
);

export type Factura = typeof facturas.$inferSelect;
export type NewFactura = typeof facturas.$inferInsert;
