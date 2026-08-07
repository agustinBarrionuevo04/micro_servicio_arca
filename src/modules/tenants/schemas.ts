/** Contratos Zod del endpoint interno `POST /admin/tenants`. */
import { z } from 'zod';

export const createTenantSchema = z.object({
  razonSocial: z.string().min(1).max(255),
  cuit: z.string().regex(/^\d{2}-\d{8}-\d$/, 'CUIT debe tener formato XX-XXXXXXXX-X'),
  condicionFiscal: z.enum(['monotributo', 'resp_inscripto', 'exento']),
  puntoVenta: z.number().int().min(1).max(99999),
  cert: z.string().min(1),
  key: z.string().min(1),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const tenantResponseSchema = z.object({
  id: z.string().uuid(),
  razonSocial: z.string(),
  cuit: z.string(),
  condicionFiscal: z.enum(['monotributo', 'resp_inscripto', 'exento']),
  puntoVenta: z.number(),
  createdAt: z.string(),
});

export const createTenantResponseSchema = z.object({
  tenant: tenantResponseSchema,
  apiKey: z.string(),
});
