/**
 * Middleware de auth para rutas protegidas: resuelve qué usuario está
 * haciendo la request a partir del header `Authorization: Bearer
 * <accessToken>` y lo deja en `request.usuario` para que las rutas
 * downstream (`feature/usuarios-onboarding`, `feature/facturas-service-v2`)
 * lo usen sin volver a verificar nada. Mismo patrón que el viejo
 * `modules/auth/index.ts` usaba para `request.tenant` (ver
 * `git show origin/feature/monorepo-restructure:apps/api/src/modules/auth/index.ts`),
 * adaptado a JWT en vez de API key hasheada.
 *
 * A diferencia del viejo middleware (que tenía que traer *todas* las API
 * keys activas y probar `argon2.verify` una por una, porque el hash salado
 * no permite un `WHERE` directo), acá la verificación del token es O(1)
 * (`jwt.verify`, ver `jwt.ts`) y el único acceso a DB es un
 * `SELECT ... WHERE id = ?` por PK — no hay el mismo problema de escala.
 *
 * Uso en una ruta protegida: `{ preHandler: authenticate, handler: ... }`
 * (o `app.addHook('preHandler', authenticate)` para protegerlas todas en un
 * grupo). Después de que corre sin lanzar, `request.usuario` está
 * garantizado — no hace falta un chequeo `if (!request.usuario)` en el
 * handler.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { usuarios } from '../../db/schema/index.js';
import { verifyAccessToken } from './jwt.js';
import { InvalidTokenError } from '../../errors/index.js';
import { toAuthenticatedUsuario, type AuthenticatedUsuario } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    usuario: AuthenticatedUsuario;
  }
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1] ?? null;
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    throw new InvalidTokenError('Missing access token');
  }

  // Lanza InvalidTokenError por su cuenta ante firma inválida, token
  // vencido o malformado — ver jwt.ts.
  const payload = verifyAccessToken(token);

  const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, payload.usuarioId)).limit(1);

  if (!usuario) {
    // El usuario fue borrado (o nunca existió, ej. un JWT falsificado con
    // un usuarioId inventado que igual pasa la verificación de firma si
    // alguna vez se filtra JWT_SECRET) después de emitirse un access token
    // que todavía no expiró. Mismo código genérico que el resto de los
    // casos de token inválido — no hay nada más que hacer server-side
    // hasta que ese token expire solo (no se persiste, no se puede
    // revocar).
    throw new InvalidTokenError();
  }

  request.usuario = toAuthenticatedUsuario(usuario);
}
