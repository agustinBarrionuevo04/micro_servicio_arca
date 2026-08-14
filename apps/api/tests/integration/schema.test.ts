/**
 * Esta rama (`feature/db-schema-v2`) no trae lógica de negocio (eso lo
 * agregan `feature/facturas-service-v2` y compañía, ver
 * `src/routes/index.ts`), así que no hay endpoints HTTP que ejercitar
 * todavía. Lo que sí es responsabilidad de esta rama, y lo que se testea
 * acá, es que el schema/migración por sí solos garanticen las invariantes
 * fiscalmente relevantes que describe PLAN.md — sobre todo el índice único
 * parcial `(usuario_id, periodo) WHERE estado <> 'error'`, que es la pieza
 * central de la nueva estrategia de idempotencia (reemplaza el header
 * `Idempotency-Key`, ver `db/schema/facturas.ts`).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { usuarios, facturas, contadores } from '../../src/db/schema/index.js';
import { runMigrations, truncateAll, createTestUsuario } from './helpers.js';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await truncateAll();
});

function facturaBase(usuarioId: string, overrides: Partial<typeof facturas.$inferInsert> = {}) {
  return {
    usuarioId,
    periodo: '2026-08-01',
    unidades: '100.00',
    precioBaseUsado: '95000.00',
    importeTotal: '9500000.00',
    ptoVta: 1,
    payloadEnviado: {},
    ...overrides,
  };
}

describe('usuarios - defaults', () => {
  it('aplica los defaults de condicionIva, puntoVenta y ambiente', async () => {
    const usuario = await createTestUsuario();
    const [row] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.usuarioId));

    expect(row?.condicionIva).toBe('Responsable Monotributo');
    expect(row?.puntoVenta).toBe(1);
    expect(row?.ambiente).toBe('homologacion');
    // cert/key nunca se devuelven en texto plano hacia afuera del backend
    // (ver PLAN.md, "Seguridad"); acá solo confirmamos que el helper de test
    // los persiste tal cual los recibe (la app real los cifra antes de
    // insertar, eso lo hace el endpoint de alta que todavía no existe).
    expect(row?.cert).toBe('fake-cert-content');
  });
});

describe('facturas - índice único parcial (usuario_id, periodo) WHERE estado <> error', () => {
  it('bloquea una segunda factura no-error para el mismo (usuario, período)', async () => {
    const usuario = await createTestUsuario();
    await db.insert(facturas).values(facturaBase(usuario.usuarioId, { estado: 'pendiente' }));

    await expect(
      db.insert(facturas).values(facturaBase(usuario.usuarioId, { estado: 'emitida' }))
    ).rejects.toThrow();
  });

  it('permite reintentar el mismo período tras un estado error', async () => {
    const usuario = await createTestUsuario();
    await db.insert(facturas).values(facturaBase(usuario.usuarioId, { estado: 'error' }));

    // No debe tirar: el índice es parcial (WHERE estado <> 'error'), así
    // que una fila 'error' no cuenta para la restricción de unicidad.
    await expect(
      db.insert(facturas).values(facturaBase(usuario.usuarioId, { estado: 'pendiente' }))
    ).resolves.toBeDefined();

    const rows = await db.select().from(facturas).where(eq(facturas.usuarioId, usuario.usuarioId));
    expect(rows).toHaveLength(2);
  });

  it('permite el mismo período para usuarios distintos', async () => {
    const usuarioA = await createTestUsuario();
    const usuarioB = await createTestUsuario();

    await db.insert(facturas).values(facturaBase(usuarioA.usuarioId, { estado: 'pendiente' }));

    await expect(
      db.insert(facturas).values(facturaBase(usuarioB.usuarioId, { estado: 'pendiente' }))
    ).resolves.toBeDefined();
  });
});

describe('cascade delete', () => {
  it('borrar un usuario borra en cascada sus facturas y contadores', async () => {
    const usuario = await createTestUsuario();
    await db.insert(facturas).values(facturaBase(usuario.usuarioId));
    await db.insert(contadores).values({ usuarioId: usuario.usuarioId, ptoVta: 1, cbteTipo: 11, ultimoNumero: 0 });

    await db.delete(usuarios).where(eq(usuarios.id, usuario.usuarioId));

    const facturasRestantes = await db.select().from(facturas).where(eq(facturas.usuarioId, usuario.usuarioId));
    const contadoresRestantes = await db
      .select()
      .from(contadores)
      .where(eq(contadores.usuarioId, usuario.usuarioId));

    expect(facturasRestantes).toHaveLength(0);
    expect(contadoresRestantes).toHaveLength(0);
  });
});
