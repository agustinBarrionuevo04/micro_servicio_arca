import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Ambiente de ARCA (homologación/producción) resuelto por usuario, nunca
 * desde una variable de entorno global. Con el modelo B2B anterior había un
 * solo `env.ARCA_MODE` para todo el proceso; acá conviven en la misma tabla
 * `usuarios` cuentas de prueba (homologación) y repartidores reales
 * (producción), así que un valor global sería, en el mejor caso, inútil y
 * en el peor, un usuario de prueba emitiendo comprobantes reales o
 * viceversa. Ver PLAN.md "Seguridad (no negociable)".
 */
export const arcaAmbienteEnum = pgEnum('arca_ambiente', ['homologacion', 'produccion']);

/**
 * Reemplaza al enum anterior (`pendiente|aprobada|rechazada`, pensado para
 * el flujo B2B genérico) por los tres estados reales de este producto:
 * - `pendiente`: reservado el número, todavía no se confirmó con ARCA.
 * - `emitida`: ARCA devolvió CAE, la factura es válida.
 * - `error`: ARCA rechazó el comprobante o falló la emisión; el período
 *   queda libre para reintentar (ver el índice único parcial en facturas.ts).
 */
export const estadoFacturaEnum = pgEnum('estado_factura', ['pendiente', 'emitida', 'error']);

export type ArcaAmbiente = 'homologacion' | 'produccion';
export type EstadoFactura = 'pendiente' | 'emitida' | 'error';
