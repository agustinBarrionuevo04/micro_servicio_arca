import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import * as argon2 from 'argon2';
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

export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const prefix = 'ak_';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + result;
}
