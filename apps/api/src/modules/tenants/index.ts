/**
 * Endpoint interno de administración (`/admin/tenants`) — no forma parte de
 * la API pública v1 ni requiere API key, es para provisionar tenants nuevos
 * (uso operativo/scripts, no pensado para exponerse a clientes).
 */
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

      // La API key en texto plano solo vive en esta variable y en la
      // response; en DB únicamente se guarda `hashedApiKey`.
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

        // Sembramos el contador en 0 para que la primera factura del tenant
        // no tenga que crear la fila sobre la marcha dentro de la
        // transacción de facturación. Fijo en FACTURA_C porque hoy
        // `resolverComprobante` solo emite ese tipo (ver services/fiscal-rules);
        // el día que se sume Responsable Inscripto hay que sembrar también
        // el contador de Factura A/B acá.
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
