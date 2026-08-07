/** Contratos Zod de `/v1/facturas` (request/response en snake_case, el contrato público). Alimentan tanto la validación en runtime como el OpenAPI generado en `/docs`. */
import { z } from 'zod';
import { tipoDocumentoSchema } from '../../services/fiscal-rules/types.js';

export const createFacturaBodySchema = z.object({
  cliente: z.object({
    tipo_doc: tipoDocumentoSchema,
    nro_doc: z.string().nullable(),
  }),
  items: z.array(z.object({
    descripcion: z.string().min(1),
    cantidad: z.number().positive(),
    precio_unitario: z.number().nonnegative(),
  })).min(1),
  total: z.number().positive(),
});

export type CreateFacturaBody = z.infer<typeof createFacturaBodySchema>;

export const facturaResponseSchema = z.object({
  id: z.string(),
  cae: z.string().nullable(),
  vencimiento_cae: z.string().nullable(),
  numero: z.string().nullable(),
  estado: z.enum(['pendiente', 'aprobada', 'rechazada']),
});

export const facturaListQuerySchema = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  estado: z.enum(['pendiente', 'aprobada', 'rechazada']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const facturaListResponseSchema = z.object({
  data: z.array(facturaResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
  }),
});

export const facturaIdParamSchema = z.object({
  id: z.string().uuid(),
});
