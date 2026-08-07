/** Endpoints de diagnóstico, sin autenticación: salud propia y salud de los servicios de ARCA. */
import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

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
        // No es un endpoint por-tenant: consulta el estado general de WSAA/WSFE
        // (FEDummy), que no requiere autenticación real — no usamos
        // `getArcaClientForTenant` porque no hay un tenant asociado a esta request.
        const { Arca } = await import('@arcasdk/core');
        const arca = new Arca({
          cuit: 0,
          cert: '',
          key: '',
          production: false,
        });
        const status = await arca.electronicBillingService.getServerStatus();
        return reply.send({
          wsfe: status.appServer === 'OK' ? 'ok' : 'error',
          wsaa: status.authServer === 'OK' ? 'ok' : 'error',
        });
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
