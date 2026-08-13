/**
 * Flujo HTTP completo de `POST /v1/auth/login`, `POST /v1/auth/refresh` y
 * el middleware `authenticate` (ver `src/modules/usuarios-auth/`).
 *
 * No hay todavía ninguna ruta protegida real en esta rama (la primera la
 * suma `feature/usuarios-onboarding`/`feature/facturas-service-v2`, ver
 * `src/routes/index.ts`), así que para probar `authenticate` end-to-end se
 * registra una ruta de prueba mínima (`/__test/protected`) sobre la misma
 * instancia de `buildApp()` — mismo patrón que usaría cualquier ruta
 * protegida real (`preHandler: authenticate`, lee `request.usuario`).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { refreshTokens } from '../../src/db/schema/index.js';
import { authenticate } from '../../src/modules/usuarios-auth/middleware.js';
import { hashPassword } from '../../src/modules/usuarios-auth/passwords.js';
import { runMigrations, truncateAll, createTestUsuario, nextCuit } from './helpers.js';

let app: FastifyInstance;

const PASSWORD = 'una-password-bien-larga-123';

beforeAll(async () => {
  await runMigrations();

  app = await buildApp();

  app.get('/__test/protected', {
    preHandler: authenticate,
    handler: async (request, reply) => {
      return reply.send({ usuarioId: request.usuario.id, cuit: request.usuario.cuit });
    },
  });

  await app.ready();
});

beforeEach(async () => {
  await truncateAll();
});

async function crearUsuarioConPassword(overrides: { cuit?: string; password?: string } = {}) {
  const password = overrides.password ?? PASSWORD;
  const passwordHash = await hashPassword(password);
  const usuario = await createTestUsuario({ cuit: overrides.cuit, passwordHash });
  return { ...usuario, password };
}

describe('POST /v1/auth/login', () => {
  it('con credenciales correctas devuelve accessToken, refreshToken y el usuario (sin datos sensibles)', async () => {
    const usuario = await crearUsuarioConPassword();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit, password: usuario.password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.usuario).toEqual({
      id: usuario.usuarioId,
      cuit: usuario.cuit,
      razonSocial: 'Juan Repartidor',
      ambiente: 'homologacion',
    });
    expect(body.usuario.passwordHash).toBeUndefined();
    expect(body.usuario.cert).toBeUndefined();
    expect(body.usuario.key).toBeUndefined();
  });

  it('persiste el refresh token hasheado (nunca en texto plano) en la tabla refresh_tokens', async () => {
    const usuario = await crearUsuarioConPassword();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit, password: usuario.password },
    });

    const { refreshToken } = response.json();

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.usuarioId, usuario.usuarioId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(refreshToken);
    expect(rows[0]?.revokedAt).toBeNull();
  });

  it('con contraseña incorrecta devuelve 401 INVALID_CREDENTIALS', async () => {
    const usuario = await crearUsuarioConPassword();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit, password: 'password-incorrecta' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('con CUIT inexistente devuelve el mismo 401 INVALID_CREDENTIALS (no filtra si el CUIT existe)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: nextCuit(), password: 'cualquier-cosa' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rechaza un body con CUIT en formato inválido (422/400 de validación, no 401)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: 'no-es-un-cuit', password: 'algo' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rechaza un body sin password', async () => {
    const usuario = await crearUsuarioConPassword();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /v1/auth/refresh', () => {
  async function login(cuit: string, password: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit, password },
    });
    return response.json() as { accessToken: string; refreshToken: string };
  }

  it('con un refreshToken válido devuelve un accessToken y refreshToken nuevos', async () => {
    const usuario = await crearUsuarioConPassword();
    const { refreshToken } = await login(usuario.cuit, usuario.password);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it('rota: el refresh token usado queda revocado y no se puede volver a usar', async () => {
    const usuario = await crearUsuarioConPassword();
    const { refreshToken: primero } = await login(usuario.cuit, usuario.password);

    const primeraRotacion = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: primero },
    });
    expect(primeraRotacion.statusCode).toBe(200);

    const reintentoConElViejo = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: primero },
    });

    expect(reintentoConElViejo.statusCode).toBe(401);
    expect(reintentoConElViejo.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('el nuevo refresh token emitido por la rotación sí funciona', async () => {
    const usuario = await crearUsuarioConPassword();
    const { refreshToken: primero } = await login(usuario.cuit, usuario.password);

    const { refreshToken: segundo } = (await app
      .inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: primero } })
      .then((r) => r.json())) as { refreshToken: string };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: segundo },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rechaza un refreshToken inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'un-token-que-nunca-se-emitio' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rechaza un refreshToken vencido', async () => {
    const usuario = await crearUsuarioConPassword();
    const { refreshToken } = await login(usuario.cuit, usuario.password);

    // Forzamos expiresAt al pasado directo en DB — más simple y explícito
    // que esperar 30 días reales o mockear el reloj del proceso.
    const tokenHash = (await import('../../src/modules/usuarios-auth/tokens.js')).hashRefreshToken(refreshToken);
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, tokenHash));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rechaza un body sin refreshToken', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('authenticate (middleware, vía ruta protegida de prueba)', () => {
  it('con un accessToken válido resuelve request.usuario y deja pasar', async () => {
    const usuario = await crearUsuarioConPassword();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit, password: usuario.password },
    });
    const { accessToken } = login.json();

    const response = await app.inject({
      method: 'GET',
      url: '/__test/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ usuarioId: usuario.usuarioId, cuit: usuario.cuit });
  });

  it('sin header Authorization devuelve 401 INVALID_TOKEN', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/protected' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('con un token malformado (no JWT) devuelve 401 INVALID_TOKEN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/protected',
      headers: { authorization: 'Bearer esto-no-es-un-jwt' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('con un token tamperado (firma inválida) devuelve 401 INVALID_TOKEN', async () => {
    const usuario = await crearUsuarioConPassword();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit, password: usuario.password },
    });
    const { accessToken } = login.json();
    const tamperado = accessToken.slice(0, -1) + (accessToken.endsWith('a') ? 'b' : 'a');

    const response = await app.inject({
      method: 'GET',
      url: '/__test/protected',
      headers: { authorization: `Bearer ${tamperado}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('con el usuario borrado después de emitido el token devuelve 401 INVALID_TOKEN', async () => {
    const usuario = await crearUsuarioConPassword();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { cuit: usuario.cuit, password: usuario.password },
    });
    const { accessToken } = login.json();

    const { usuarios } = await import('../../src/db/schema/index.js');
    await db.delete(usuarios).where(eq(usuarios.id, usuario.usuarioId));

    const response = await app.inject({
      method: 'GET',
      url: '/__test/protected',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('con un header Authorization sin esquema Bearer devuelve 401 INVALID_TOKEN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });
});
