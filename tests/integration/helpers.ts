import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/index.js';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
}

export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE facturas, contadores, api_keys, tenants RESTART IDENTITY CASCADE`
  );
}

let cuitCounter = 20000000;

export function nextCuit(): string {
  cuitCounter += 1;
  return `20-${cuitCounter}-9`;
}

export interface TestTenant {
  tenantId: string;
  apiKey: string;
  puntoVenta: number;
}

export async function createTestTenant(
  app: FastifyInstance,
  overrides: Partial<{
    razonSocial: string;
    cuit: string;
    condicionFiscal: 'monotributo' | 'resp_inscripto' | 'exento';
    puntoVenta: number;
    cert: string;
    key: string;
  }> = {}
): Promise<TestTenant> {
  const puntoVenta = overrides.puntoVenta ?? 1;

  const response = await app.inject({
    method: 'POST',
    url: '/admin/tenants',
    payload: {
      razonSocial: overrides.razonSocial ?? 'Comercio Test SRL',
      cuit: overrides.cuit ?? nextCuit(),
      condicionFiscal: overrides.condicionFiscal ?? 'monotributo',
      puntoVenta,
      cert: overrides.cert ?? 'fake-cert-content',
      key: overrides.key ?? 'fake-key-content',
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to create test tenant: ${response.body}`);
  }

  const body = response.json() as { tenant: { id: string }; apiKey: string };

  return {
    tenantId: body.tenant.id,
    apiKey: body.apiKey,
    puntoVenta,
  };
}

export function validFacturaPayload(overrides: Partial<{ total: number }> = {}) {
  const total = overrides.total ?? 100;
  return {
    cliente: { tipo_doc: 'CF' as const, nro_doc: null },
    items: [{ descripcion: 'Producto de prueba', cantidad: 1, precio_unitario: total }],
    total,
  };
}
