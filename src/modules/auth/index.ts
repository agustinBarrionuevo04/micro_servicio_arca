/**
 * Middleware de auth: resuelve qué tenant está haciendo la request a partir
 * del header `Authorization: Bearer <api_key>` y lo deja en
 * `request.tenant` para que las rutas downstream (`modules/facturas`) lo
 * usen sin volver a tocar la DB.
 *
 * Como las api keys se guardan hasheadas con argon2 (hash salado, no
 * determinístico), no se puede hacer `WHERE key_hash = hash(token)` — hay
 * que traer todas las keys activas y probar `argon2.verify` una por una.
 * Es O(cantidad de tenants activos) por request; aceptable mientras el
 * volumen de tenants sea chico, pero el primer lugar a optimizar si crece
 * mucho (ej. cachear el mapping key→tenant en memoria con invalidación).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { db } from '../../db/index.js';
import { apiKeys, tenants, type Tenant } from '../../db/schema/index.js';
import { UnauthorizedError } from '../../errors/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: Tenant;
  }
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1] ?? null;
}

export async function authMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    throw new UnauthorizedError('Missing API key');
  }

  const activeKeys = await db
    .select({
      keyHash: apiKeys.keyHash,
      tenantId: apiKeys.tenantId,
    })
    .from(apiKeys)
    .where(eq(apiKeys.activa, true));

  let matchedTenantId: string | null = null;

  for (const key of activeKeys) {
    try {
      if (await argon2.verify(key.keyHash, token)) {
        matchedTenantId = key.tenantId;
        break;
      }
    } catch {
      // Hash corrupto/con formato inesperado: lo tratamos como "no matchea"
      // en vez de tumbar el login de todos los demás tenants.
      continue;
    }
  }

  if (!matchedTenantId) {
    throw new UnauthorizedError('Invalid API key');
  }

  const tenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, matchedTenantId))
    .limit(1);

  if (!tenant[0]) {
    throw new UnauthorizedError('Tenant not found');
  }

  request.tenant = tenant[0];
}

export async function hashApiKey(key: string): Promise<string> {
  return argon2.hash(key);
}

/**
 * Se devuelve una única vez al crear el tenant (ver modules/tenants); nunca
 * se persiste en texto plano, solo su hash. Usa `randomBytes` (CSPRNG) y no
 * `Math.random()` porque esto es un secreto, no un id decorativo.
 */
export function generateApiKey(): string {
  return `ak_${randomBytes(24).toString('base64url')}`;
}
