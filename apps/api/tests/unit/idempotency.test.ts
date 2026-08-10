import { describe, it, expect, vi } from 'vitest';
import { isIdempotencyKeyValid, createIdempotencyService } from '../../src/services/idempotency/index.js';
import type { Database } from '../../src/db/index.js';
import type { Factura } from '../../src/db/schema/index.js';

describe('isIdempotencyKeyValid', () => {
  it('rechaza undefined', () => {
    expect(isIdempotencyKeyValid(undefined)).toBe(false);
  });

  it('rechaza string vacío', () => {
    expect(isIdempotencyKeyValid('')).toBe(false);
  });

  it('acepta una key válida', () => {
    expect(isIdempotencyKeyValid('order-123-abc')).toBe(true);
  });

  it('rechaza una key más larga que 255 caracteres', () => {
    expect(isIdempotencyKeyValid('a'.repeat(256))).toBe(false);
  });

  it('acepta una key de exactamente 255 caracteres', () => {
    expect(isIdempotencyKeyValid('a'.repeat(255))).toBe(true);
  });

  it('acepta una key de un solo caracter', () => {
    expect(isIdempotencyKeyValid('x')).toBe(true);
  });
});

describe('createIdempotencyService.findExisting', () => {
  function buildMockDb(returnValue: Factura[]) {
    const limit = vi.fn().mockResolvedValue(returnValue);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    return { select } as unknown as Database;
  }

  it('devuelve null cuando no existe factura previa', async () => {
    const db = buildMockDb([]);
    const service = createIdempotencyService(db);

    const result = await service.findExisting('tenant-1', 'key-1');
    expect(result).toBeNull();
  });

  it('devuelve la factura existente cuando hay match', async () => {
    const fakeFactura = { id: 'fac-1', tenantId: 'tenant-1', idempotencyKey: 'key-1' } as Factura;
    const db = buildMockDb([fakeFactura]);
    const service = createIdempotencyService(db);

    const result = await service.findExisting('tenant-1', 'key-1');
    expect(result).toEqual(fakeFactura);
  });
});
