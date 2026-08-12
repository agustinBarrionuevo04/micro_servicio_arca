/** Endpoints de diagnóstico, sin autenticación: salud propia y salud de los servicios de ARCA. */
import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createArcaClient } from '../services/arca/index.js';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
});

const arcaStatusResponseSchema = z.object({
  wsfe: z.enum(['ok', 'error']),
  wsaa: z.enum(['ok', 'error']),
  message: z.string().optional(),
});

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/v1/health', {
    schema: {
      response: {
        200: healthResponseSchema,
      },
      tags: ['health'],
      description: 'Health check endpoint',
    },
    handler: async (_request, reply) => {
      return reply.send({
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
      });
    },
  });

  typedApp.get('/v1/arca/status', {
    schema: {
      response: {
        200: arcaStatusResponseSchema,
      },
      tags: ['health'],
      description: 'ARCA services status check',
    },
    handler: async (_request, reply) => {
      try {
        // No es un endpoint por-tenant: consulta el estado general de
        // WSAA/WSFE (FEDummy), que no requiere autenticación real — no
        // usamos `getArcaClientForTenant` porque no hay un tenant asociado
        // a esta request. Reusamos `createArcaClient`/`getStatus` de
        // `services/arca` (en vez de reimplementar acá la instanciación y
        // el mapeo ok/error) para que ambos lugares no se desincronicen.
        const arcaClient = await createArcaClient({ cuit: '0', cert: '', key: '' });
        const status = await arcaClient.getStatus();
        return reply.send(status);
      } catch (error) {
        return reply.send({
          wsfe: 'error',
          wsaa: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  });
}
