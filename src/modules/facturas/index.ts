import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authMiddleware } from '../auth/index.js';
import { ValidationError } from '../../errors/index.js';
import { isIdempotencyKeyValid } from '../../services/idempotency/index.js';
import {
  createFacturaBodySchema,
  facturaResponseSchema,
  facturaListQuerySchema,
  facturaListResponseSchema,
  facturaIdParamSchema,
} from './schemas.js';
import { createFactura, getFacturaById, listFacturas } from './service.js';

export * from './schemas.js';

function formatFacturaResponse(factura: {
  id: string;
  cae: string | null;
  vencimientoCae: string | null;
  numero: string | null;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
}) {
  return {
    id: factura.id,
    cae: factura.cae,
    vencimiento_cae: factura.vencimientoCae,
    numero: factura.numero,
    estado: factura.estado,
  };
}

export async function registerFacturaRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/v1/facturas', {
    onRequest: [authMiddleware],
    schema: {
      body: createFacturaBodySchema,
      response: {
        201: facturaResponseSchema,
        200: facturaResponseSchema,
      },
      headers: z.object({
        authorization: z.string(),
        'idempotency-key': z.string(),
      }),
      tags: ['facturas'],
      description: 'Create a new factura',
    },
    handler: async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'];

      if (!isIdempotencyKeyValid(idempotencyKey)) {
        throw new ValidationError('Idempotency-Key header is required');
      }

      const { factura, isNew } = await createFactura(request.tenant, request.body, idempotencyKey);

      const statusCode = isNew ? 201 : 200;

      return reply.status(statusCode).send(formatFacturaResponse(factura));
    },
  });

  typedApp.get('/v1/facturas/:id', {
    onRequest: [authMiddleware],
    schema: {
      params: facturaIdParamSchema,
      response: {
        200: facturaResponseSchema,
      },
      tags: ['facturas'],
      description: 'Get a factura by ID',
    },
    handler: async (request, reply) => {
      const factura = await getFacturaById(request.tenant.id, request.params.id);
      return reply.send(formatFacturaResponse(factura));
    },
  });

  typedApp.get('/v1/facturas', {
    onRequest: [authMiddleware],
    schema: {
      querystring: facturaListQuerySchema,
      response: {
        200: facturaListResponseSchema,
      },
      tags: ['facturas'],
      description: 'List facturas with pagination and filters',
    },
    handler: async (request, reply) => {
      const { data, total } = await listFacturas(request.tenant.id, {
        desde: request.query.desde,
        hasta: request.query.hasta,
        estado: request.query.estado,
        page: request.query.page,
        limit: request.query.limit,
      });

      return reply.send({
        data: data.map(formatFacturaResponse),
        pagination: {
          page: request.query.page,
          limit: request.query.limit,
          total,
        },
      });
    },
  });
}
