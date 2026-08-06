import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../../db/index.js';
import { tenants, apiKeys, contadores, type Tenant } from '../../db/schema/index.js';
import { encrypt } from '../../config/crypto.js';
import { generateApiKey, hashApiKey } from '../auth/index.js';
import { createTenantSchema, createTenantResponseSchema, type CreateTenantInput } from './schemas.js';
import { CBTE_TIPO } from '../../services/fiscal-rules/index.js';

export * from './schemas.js';

export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/admin/tenants', {
    schema: {
      body: createTenantSchema,
      response: {
        201: createTenantResponseSchema,
      },
      tags: ['admin'],
      description: 'Create a new tenant with API key',
    },
    handler: async (request, reply) => {
      const input: CreateTenantInput = request.body;

      const encryptedCert = encrypt(input.cert);
      const encryptedKey = encrypt(input.key);

      const plainApiKey = generateApiKey();
      const hashedApiKey = await hashApiKey(plainApiKey);

      const result = await db.transaction(async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({
            razonSocial: input.razonSocial,
            cuit: input.cuit,
            condicionFiscal: input.condicionFiscal,
            puntoVenta: input.puntoVenta,
            cert: encryptedCert,
            key: encryptedKey,
          })
          .returning();

        if (!tenant) throw new Error('Failed to create tenant');

        await tx.insert(apiKeys).values({
          tenantId: tenant.id,
          keyHash: hashedApiKey,
          activa: true,
        });

        await tx.insert(contadores).values({
          tenantId: tenant.id,
          ptoVta: input.puntoVenta,
          cbteTipo: CBTE_TIPO.FACTURA_C,
          ultimoNumero: 0,
        });

        return tenant;
      });

      return reply.status(201).send({
        tenant: {
          id: result.id,
          razonSocial: result.razonSocial,
          cuit: result.cuit,
          condicionFiscal: result.condicionFiscal,
          puntoVenta: result.puntoVenta,
          createdAt: result.createdAt.toISOString(),
        },
        apiKey: plainApiKey,
      });
    },
  });
}
