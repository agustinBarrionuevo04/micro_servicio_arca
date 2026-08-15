/**
 * Test de integración end-to-end de `GET /v1/facturas/:id/pdf` vía
 * `app.inject` (mismo patrón que el resto del repo, ver PLAN.md "Qué se
 * reusa tal cual del backend actual"): DB real (migraciones + truncate por
 * test) + Chromium real (sin mockear `@arcasdk/pdf`) — así este test
 * hubiera detectado el problema real de sandbox de Puppeteer si el patch de
 * `patches/@arcasdk__pdf@0.2.0.patch` no estuviera aplicado.
 *
 * NOTA DE SEGURIDAD (ver TODO en `src/routes/facturas.ts`): esta ruta
 * todavía no tiene auth real (`feature/usuarios-auth` no mergeó a esta
 * rama), así que estos tests pegan directo sin `Authorization` header —
 * eso es exactamente el gap que señala el PR body como bloqueante antes de
 * producción, no un descuido de este archivo.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { runMigrations, truncateAll, createTestUsuario, createTestFactura } from '../helpers.js';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await truncateAll();
});

describe('GET /v1/facturas/:id/pdf', () => {
  it('200: devuelve un PDF válido para una factura emitida', async () => {
    const app = await buildApp();
    const usuario = await createTestUsuario();
    const factura = await createTestFactura(usuario.usuarioId, { estado: 'emitida' });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/facturas/${factura.id}/pdf`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(response.headers['content-disposition']).toContain('factura-0001-00000123.pdf');
    expect(response.rawPayload.subarray(0, 5).toString('utf-8')).toBe('%PDF-');

    await app.close();
  });

  it('409 FACTURA_NOT_EMITIDA: factura pendiente no tiene PDF', async () => {
    const app = await buildApp();
    const usuario = await createTestUsuario();
    const factura = await createTestFactura(usuario.usuarioId, {
      estado: 'pendiente',
      cae: null,
      caeFchVto: null,
      cbteNro: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/facturas/${factura.id}/pdf`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('FACTURA_NOT_EMITIDA');

    await app.close();
  });

  it('404 FACTURA_NOT_FOUND: id inexistente', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/facturas/99999999-9999-4999-8999-999999999999/pdf',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('FACTURA_NOT_FOUND');

    await app.close();
  });

  it('400: id con formato inválido (no UUID)', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/facturas/no-es-un-uuid/pdf',
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
