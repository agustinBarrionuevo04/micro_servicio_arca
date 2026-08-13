import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './health.js';
import { registerFacturaRoutes } from './facturas.js';

// TODO(feature/usuarios-auth): reincorporar el login CUIT+contraseña
// (reemplazo de `modules/auth`, que era API-key B2B — no aplica a este
// producto, ver PLAN.md "Qué se reemplaza").
// TODO(feature/usuarios-onboarding): reincorporar el alta self-service de
// usuarios (reemplazo de `modules/tenants`, que era un endpoint admin de
// alta de tenants B2B).
// TODO(feature/facturas-service-v2): reincorporar `/v1/facturas`
// (preview/crear/listar/detalle) sobre el modelo nuevo
// (unidades × precio_base_vigente(periodo)), reemplazo de `modules/facturas`
// que modelaba ventas con items arbitrarios — incompatible con el dominio
// nuevo, no un rename mecánico. `registerFacturaRoutes` (de esta rama,
// `feature/pdf-generation`) solo trae `GET /v1/facturas/:id/pdf`, que no
// depende de esa orquestación — cuando `facturas-service-v2` aterrice, sus
// rutas deberían sumarse al mismo `facturas.ts` en vez de duplicar el
// archivo.
//
// `modules/auth`, `modules/tenants`, `modules/facturas`,
// `services/fiscal-rules` y `services/idempotency` se eliminaron en esta
// rama (`feature/db-schema-v2`) en vez de parchearse mecánicamente: su
// lógica de negocio completa (autenticación por API key, alta de tenants
// B2B, facturación por items, reglas fiscales multi-condición,
// idempotencia por header) queda reemplazada por un dominio distinto en las
// ramas de arriba, no por un rename de columnas. Mantenerlos compilando con
// shims habría significado fingir una lógica de negocio que ya no aplica.
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerHealthRoutes(app);
  await registerFacturaRoutes(app);
}
