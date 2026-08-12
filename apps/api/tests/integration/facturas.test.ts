import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { arcaMockFns, resetArcaMock, mockArcaRejection } from './arca-mock.js';

vi.mock('@arcasdk/core', () => ({
  Arca: vi.fn().mockImplementation(() => ({
    electronicBillingService: {
      createVoucher: arcaMockFns.createVoucher,
      getLastVoucher: arcaMockFns.getLastVoucher,
      getServerStatus: arcaMockFns.getServerStatus,
    },
  })),
}));

const { runMigrations, truncateAll, createTestTenant, validFacturaPayload } = await import(
  './helpers.js'
);
const { buildApp } = await import('../../src/app.js');
const { db } = await import('../../src/db/index.js');
const { facturas, contadores } = await import('../../src/db/schema/index.js');
const { CBTE_TIPO } = await import('../../src/services/fiscal-rules/index.js');

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  resetArcaMock();
});

describe('POST /v1/facturas - caso feliz', () => {
  it('crea una factura, persiste el CAE y avanza el contador', async () => {
    const tenant = await createTestTenant(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'order-1',
      },
      payload: validFacturaPayload(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.estado).toBe('aprobada');
    expect(body.cae).toBe('CAE-1');
    expect(body.numero).toBe('0001-00000001');

    const [persisted] = await db
      .select()
      .from(facturas)
      .where(eq(facturas.tenantId, tenant.tenantId));
    expect(persisted).toBeDefined();
    expect(persisted?.cae).toBe('CAE-1');
    expect(persisted?.estado).toBe('aprobada');

    const [contador] = await db
      .select()
      .from(contadores)
      .where(eq(contadores.tenantId, tenant.tenantId));
    expect(contador?.ultimoNumero).toBe(1);

    expect(arcaMockFns.createVoucher).toHaveBeenCalledTimes(1);
  });

  it('devuelve 422 si el body no matchea la suma de items', async () => {
    const tenant = await createTestTenant(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'order-mismatch',
      },
      payload: {
        cliente: { tipo_doc: 'CF', nro_doc: null },
        items: [{ descripcion: 'Producto', cantidad: 1, precio_unitario: 100 }],
        total: 999,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(arcaMockFns.createVoucher).not.toHaveBeenCalled();
  });
});

describe('POST /v1/facturas - idempotencia', () => {
  it('devuelve la misma respuesta y no reprocesa con la misma Idempotency-Key', async () => {
    const tenant = await createTestTenant(app);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'retry-key',
      },
      payload: validFacturaPayload(),
    });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'retry-key',
      },
      payload: validFacturaPayload(),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(first.json().id).toBe(second.json().id);
    expect(first.json().cae).toBe(second.json().cae);

    expect(arcaMockFns.createVoucher).toHaveBeenCalledTimes(1);

    const persisted = await db
      .select()
      .from(facturas)
      .where(eq(facturas.tenantId, tenant.tenantId));
    expect(persisted).toHaveLength(1);
  });
});

describe('POST /v1/facturas - concurrencia', () => {
  it('asigna números consecutivos sin duplicados ante 10 requests paralelos', async () => {
    const tenant = await createTestTenant(app);

    const requests = Array.from({ length: 10 }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/v1/facturas',
        headers: {
          authorization: `Bearer ${tenant.apiKey}`,
          'idempotency-key': `concurrent-${i}`,
        },
        payload: validFacturaPayload(),
      })
    );

    const responses = await Promise.all(requests);

    for (const response of responses) {
      expect(response.statusCode).toBe(201);
    }

    const numeros = responses.map((r) => r.json().numero as string).sort();
    const unique = new Set(numeros);
    expect(unique.size).toBe(10);

    const expected = Array.from({ length: 10 }, (_, i) =>
      `0001-${String(i + 1).padStart(8, '0')}`
    ).sort();
    expect(numeros).toEqual(expected);

    const [contador] = await db
      .select()
      .from(contadores)
      .where(eq(contadores.tenantId, tenant.tenantId));
    expect(contador?.ultimoNumero).toBe(10);
  });
});

describe('POST /v1/facturas - rechazo de ARCA', () => {
  it('devuelve 422 y no incrementa el contador definitivamente', async () => {
    const tenant = await createTestTenant(app);
    mockArcaRejection('CUIT del comprador no es válido');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'rejected-order',
      },
      payload: validFacturaPayload(),
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('ARCA_REJECTION');

    const [contador] = await db
      .select()
      .from(contadores)
      .where(eq(contadores.tenantId, tenant.tenantId));
    expect(contador?.ultimoNumero).toBe(0);

    const [persisted] = await db
      .select()
      .from(facturas)
      .where(eq(facturas.tenantId, tenant.tenantId));
    expect(persisted?.estado).toBe('rechazada');
  });
});

describe('Aislamiento entre tenants', () => {
  it('la factura de un tenant no es visible para otro tenant', async () => {
    const tenantA = await createTestTenant(app, { puntoVenta: 1 });
    const tenantB = await createTestTenant(app, { puntoVenta: 2 });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenantA.apiKey}`,
        'idempotency-key': 'tenant-a-order',
      },
      payload: validFacturaPayload(),
    });
    expect(createResponse.statusCode).toBe(201);
    const facturaId = createResponse.json().id as string;

    const getFromB = await app.inject({
      method: 'GET',
      url: `/v1/facturas/${facturaId}`,
      headers: { authorization: `Bearer ${tenantB.apiKey}` },
    });
    expect(getFromB.statusCode).toBe(404);

    const listFromB = await app.inject({
      method: 'GET',
      url: '/v1/facturas',
      headers: { authorization: `Bearer ${tenantB.apiKey}` },
    });
    expect(listFromB.json().data).toHaveLength(0);

    const [contadorB] = await db
      .select()
      .from(contadores)
      .where(eq(contadores.tenantId, tenantB.tenantId));
    expect(contadorB?.ultimoNumero).toBe(0);

    const listFromA = await app.inject({
      method: 'GET',
      url: '/v1/facturas',
      headers: { authorization: `Bearer ${tenantA.apiKey}` },
    });
    expect(listFromA.json().data).toHaveLength(1);
  });
});

describe('Autenticación', () => {
  it('rechaza requests sin Authorization header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: { 'idempotency-key': 'no-auth' },
      payload: validFacturaPayload(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('rechaza una api key inválida', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: 'Bearer invalid-key-123',
        'idempotency-key': 'bad-key',
      },
      payload: validFacturaPayload(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('rechaza requests sin Idempotency-Key', async () => {
    const tenant = await createTestTenant(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: { authorization: `Bearer ${tenant.apiKey}` },
      payload: validFacturaPayload(),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('CBTE_TIPO', () => {
  it('usa Factura C para Monotributo', async () => {
    const tenant = await createTestTenant(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'cbte-tipo-check',
      },
      payload: validFacturaPayload(),
    });

    expect(response.statusCode).toBe(201);
    const [persisted] = await db
      .select()
      .from(facturas)
      .where(eq(facturas.tenantId, tenant.tenantId));
    expect(persisted?.cbteTipo).toBe(CBTE_TIPO.FACTURA_C);
  });
});

describe('Contador — upsert sin fila preexistente', () => {
  it('asigna el número 1 aunque la fila de contadores no exista de antemano', async () => {
    const tenant = await createTestTenant(app);

    // POST /admin/tenants ya siembra la fila del contador; la borramos para
    // simular el caso que rompía antes del fix (contador ausente).
    await db
      .delete(contadores)
      .where(
        and(
          eq(contadores.tenantId, tenant.tenantId),
          eq(contadores.ptoVta, tenant.puntoVenta),
          eq(contadores.cbteTipo, CBTE_TIPO.FACTURA_C)
        )
      );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/facturas',
      headers: {
        authorization: `Bearer ${tenant.apiKey}`,
        'idempotency-key': 'sin-contador-previo',
      },
      payload: validFacturaPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().numero).toBe('0001-00000001');

    const [contador] = await db
      .select()
      .from(contadores)
      .where(eq(contadores.tenantId, tenant.tenantId));
    expect(contador?.ultimoNumero).toBe(1);
  });
});

describe('POST /v1/facturas - carrera de idempotencia', () => {
  it('dos requests concurrentes con la misma Idempotency-Key nunca devuelven 500 y solo persisten una factura', async () => {
    const tenant = await createTestTenant(app);

    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/facturas',
        headers: {
          authorization: `Bearer ${tenant.apiKey}`,
          'idempotency-key': 'race-key',
        },
        payload: validFacturaPayload(),
      }),
      app.inject({
        method: 'POST',
        url: '/v1/facturas',
        headers: {
          authorization: `Bearer ${tenant.apiKey}`,
          'idempotency-key': 'race-key',
        },
        payload: validFacturaPayload(),
      }),
    ]);

    for (const response of [r1, r2]) {
      expect(response.statusCode).not.toBe(500);
      expect([200, 201, 409]).toContain(response.statusCode);
      if (response.statusCode === 409) {
        expect(response.json().error.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
      }
    }

    const persisted = await db
      .select()
      .from(facturas)
      .where(eq(facturas.tenantId, tenant.tenantId));
    expect(persisted).toHaveLength(1);
  });
});

describe('GET /v1/facturas - validación de query params', () => {
  it('devuelve 400 si "desde" no es una fecha válida', async () => {
    const tenant = await createTestTenant(app);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/facturas?desde=not-a-date',
      headers: { authorization: `Bearer ${tenant.apiKey}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
