/**
 * `POST /v1/auth/login` y `POST /v1/auth/refresh` — sin auth (son
 * justamente las rutas que la emiten). Ver `docs/api-contract.md` para el
 * contrato completo y `service.ts` para la lógica de negocio.
 */
import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { login, refresh } from './service.js';
import { loginSchema, loginResponseSchema, refreshRequestSchema, refreshResponseSchema } from './schemas.js';

export async function registerUsuariosAuthRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/v1/auth/login', {
    schema: {
      body: loginSchema,
      response: {
        200: loginResponseSchema,
      },
      tags: ['auth'],
      description: 'Login de usuario final con CUIT + contraseña',
    },
    handler: async (request, reply) => {
      const result = await login(request.body);

      return reply.status(200).send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        usuario: {
          id: result.usuario.id,
          cuit: result.usuario.cuit,
          razonSocial: result.usuario.razonSocial,
          ambiente: result.usuario.ambiente,
        },
      });
    },
  });

  typedApp.post('/v1/auth/refresh', {
    schema: {
      body: refreshRequestSchema,
      response: {
        200: refreshResponseSchema,
      },
      tags: ['auth'],
      description: 'Renueva el accessToken a partir de un refreshToken válido (rota el refresh token)',
    },
    handler: async (request, reply) => {
      const result = await refresh(request.body.refreshToken);
      return reply.status(200).send(result);
    },
  });
}
