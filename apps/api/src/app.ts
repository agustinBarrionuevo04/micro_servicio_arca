/**
 * Construye la instancia de Fastify: plugins (rate limit, OpenAPI),
 * proveedor de validación Zod y el error handler global. Separado de
 * `index.ts` (que solo hace `listen`) para poder importar `buildApp` desde
 * los tests de integración sin levantar un socket TCP real (usan
 * `app.inject`).
 */
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { registerRoutes } from './routes/index.js';
import { AppError } from './errors/index.js';

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            // El serializer de request por default de Fastify no incluye
            // `req.body` ni `req.headers` (solo method/url/hostname/ip, ver
            // `fastify/lib/logger.js`), así que ninguno de estos paths se
            // loguea hoy en el flujo normal de request/response. Se
            // redactan igual, por dos motivos: (1) defensa en profundidad —
            // si alguna ruta o hook futuro llega a loguear `request.body` o
            // `request.headers` explícitamente (ej. `request.log.info({
            // body: request.body })` para debug), password/tokens no
            // terminan en texto plano en los logs sin que nadie lo note; (2)
            // ya había un precedente para `req.headers.authorization` (API
            // key del viejo `modules/auth`) — `password` (`POST
            // /v1/auth/login`) y `refreshToken` (`POST /v1/auth/refresh`,
            // body y también viaja en la respuesta) son credenciales
            // equivalentes y merecen la misma cobertura.
            redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken'],
          },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Nota: el rate limit corre como plugin global, antes de que
  // `authMiddleware` (hook por-ruta) resuelva el tenant — a esta altura
  // todavía no sabemos qué tenant es. Cae a IP como key. Si se necesita
  // limitar estrictamente por tenant, hay que resolver la API key acá
  // también (duplicando el lookup de auth) o mover el rate limit a un hook
  // que corra después de la autenticación.
  await app.register(fastifyRateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    keyGenerator: (request) => {
      return (request.headers['x-tenant-id'] as string) || request.ip;
    },
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'ARCA Billing API',
        description: 'Multi-tenant electronic billing API for ARCA (Argentina)',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}`, description: 'Development' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUI, {
    routePrefix: '/docs',
  });

  // Handler global: todo error de dominio (`AppError`) y de validación
  // (Zod o el validador nativo de Fastify) se traduce acá al formato único
  // `{ error: { code, message, details } }`; nunca se filtra un stack trace
  // ni un mensaje interno al cliente.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.flatten(),
        },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation,
        },
      });
    }

    app.log.error(error);

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: {},
      },
    });
  });

  await registerRoutes(app);

  return app;
}
