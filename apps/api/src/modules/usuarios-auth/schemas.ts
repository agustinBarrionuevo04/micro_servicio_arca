/** Contratos Zod de `POST /v1/auth/login` y `POST /v1/auth/refresh` (ver `docs/api-contract.md`). */
import { z } from 'zod';

// Mismo formato que `modules/tenants/schemas.ts` usaba para `cuit`
// (`XX-XXXXXXXX-X`, 13 caracteres) — coincide con `usuarios.cuit`
// (`varchar(13)`, ver `db/schema/usuarios.ts`) y con `nextCuit()` en
// `tests/integration/helpers.ts`. `docs/api-contract.md` muestra ejemplos
// sin guiones (`"20345678901"`); ese documento es un borrador de
// planificación ("gana el código" ante cualquier discrepancia, ver su
// encabezado) — se prioriza acá el formato que ya persiste la columna real.
const cuitSchema = z.string().regex(/^\d{2}-\d{8}-\d$/, 'CUIT debe tener formato XX-XXXXXXXX-X');

export const loginSchema = z.object({
  cuit: cuitSchema,
  password: z.string().min(1),
});

export type LoginRequestBody = z.infer<typeof loginSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  usuario: z.object({
    id: z.string().uuid(),
    cuit: z.string(),
    razonSocial: z.string(),
    ambiente: z.enum(['homologacion', 'produccion']),
  }),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshRequestBody = z.infer<typeof refreshRequestSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
