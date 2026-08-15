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
      // Sin esto, el default global de app.ts (`security: [{ bearerAuth: [] }]`)
      // documenta esta ruta pública como si necesitara un token — pero es
      // justamente la ruta que lo emite, todavía no existe ningún token
      // cuando se la llama. Un cliente generado desde el spec OpenAPI podría
      // intentar mandar un Authorization inexistente o negarse a llamarla
      // sin uno (hallazgo de code review).
      security: [],
    },
    handler: async (request, reply) => {
      const result = await login(request.body);
      // El serializador Zod de Fastify ya descarta cualquier campo de
      // `result.usuario` que no esté en `loginResponseSchema` — no hace
      // falta repetir a mano la lista de campos que ya define ese schema.
      return reply.status(200).send(result);
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
      // Ver el comentario equivalente en /v1/auth/login.
      security: [],
    },
    handler: async (request, reply) => {
      const result = await refresh(request.body.refreshToken);
      return reply.status(200).send(result);
    },
  });
}
