/**
 * Tipos y catálogos del dominio fiscal. Los valores numéricos de
 * CBTE_TIPO/DOC_TIPO/CONCEPTO/CONDICION_IVA_RECEPTOR son códigos fijos
 * definidos por la especificación de WSFE (no elegimos nosotros esos
 * números, los exige ARCA).
 */
import { z } from 'zod';
import type { CondicionFiscal } from '../../db/schema/index.js';

export const tipoDocumentoSchema = z.enum(['CF', 'DNI', 'CUIT', 'CUIL']);
export type TipoDocumento = z.infer<typeof tipoDocumentoSchema>;

export const clienteInputSchema = z.object({
  tipoDoc: tipoDocumentoSchema,
  nroDoc: z.string().nullable(),
});
export type ClienteInput = z.infer<typeof clienteInputSchema>;

export const itemInputSchema = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative(),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

export const ventaInputSchema = z.object({
  items: z.array(itemInputSchema).min(1),
  total: z.number().positive(),
});
export type VentaInput = z.infer<typeof ventaInputSchema>;

/** Subconjunto del tenant que necesita `resolverComprobante` (no todo el registro de DB). */
export interface TenantFiscal {
  cuit: string;
  condicionFiscal: CondicionFiscal;
  puntoVenta: number;
}

/** Comprobante ya resuelto, listo para completarse con numeración/fecha y enviarse a ARCA. */
export interface ComprobantePayload {
  cbteTipo: number;
  ptoVta: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  condicionIvaReceptorId: number;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impIVA: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
}

export const CBTE_TIPO = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
} as const;

export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CF: 99,
} as const;

export const CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

// RG 5616 - Condición frente al IVA del receptor
export const CONDICION_IVA_RECEPTOR = {
  CONSUMIDOR_FINAL: 5,
} as const;
