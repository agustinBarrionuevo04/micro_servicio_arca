import { pgEnum } from 'drizzle-orm/pg-core';

export const condicionFiscalEnum = pgEnum('condicion_fiscal', [
  'monotributo',
  'resp_inscripto',
  'exento',
]);

export const estadoFacturaEnum = pgEnum('estado_factura', [
  'pendiente',
  'aprobada',
  'rechazada',
]);

export type CondicionFiscal = 'monotributo' | 'resp_inscripto' | 'exento';
export type EstadoFactura = 'pendiente' | 'aprobada' | 'rechazada';
