/**
 * Punto de entrada del módulo. `feature/usuarios-onboarding` y
 * `feature/facturas-service-v2` (Etapa 4, ver PLAN.md) importan
 * `authenticate` desde acá para proteger sus propias rutas:
 *
 *   import { authenticate } from '../usuarios-auth/index.js';
 *   typedApp.get('/v1/facturas', { preHandler: authenticate, handler: ... });
 *
 * y dentro del handler acceden a `request.usuario` (tipo `AuthenticatedUsuario`,
 * ya resuelto y garantizado no-null por `authenticate` — ver middleware.ts).
 */
export { registerUsuariosAuthRoutes } from './routes.js';
export { authenticate } from './middleware.js';
export { login, refresh } from './service.js';
export { hashPassword, verifyPassword } from './passwords.js';
export type { AuthenticatedUsuario, LoginInput, LoginResult, RefreshResult } from './types.js';
