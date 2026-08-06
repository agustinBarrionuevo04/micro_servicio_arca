import { describe, it, expect } from 'vitest';
import { createFacturaBodySchema } from '../../src/modules/facturas/schemas.js';
import { createTenantSchema } from '../../src/modules/tenants/schemas.js';

describe('createFacturaBodySchema', () => {
  it('acepta un body válido', () => {
    const body = {
      cliente: { tipo_doc: 'CF', nro_doc: null },
      items: [{ descripcion: 'Producto A', cantidad: 1, precio_unitario: 100 }],
      total: 100,
    };

    const result = createFacturaBodySchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('rechaza un body sin items', () => {
    const body = {
      cliente: { tipo_doc: 'CF', nro_doc: null },
      items: [],
      total: 0,
    };

    const result = createFacturaBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rechaza un tipo_doc inválido', () => {
    const body = {
      cliente: { tipo_doc: 'PASAPORTE', nro_doc: null },
      items: [{ descripcion: 'Producto A', cantidad: 1, precio_unitario: 100 }],
      total: 100,
    };

    const result = createFacturaBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rechaza total negativo', () => {
    const body = {
      cliente: { tipo_doc: 'CF', nro_doc: null },
      items: [{ descripcion: 'Producto A', cantidad: 1, precio_unitario: 100 }],
      total: -10,
    };

    const result = createFacturaBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rechaza cantidad negativa o cero', () => {
    const body = {
      cliente: { tipo_doc: 'CF', nro_doc: null },
      items: [{ descripcion: 'Producto A', cantidad: 0, precio_unitario: 100 }],
      total: 0,
    };

    const result = createFacturaBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rechaza descripcion vacía', () => {
    const body = {
      cliente: { tipo_doc: 'CF', nro_doc: null },
      items: [{ descripcion: '', cantidad: 1, precio_unitario: 100 }],
      total: 100,
    };

    const result = createFacturaBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rechaza campos faltantes', () => {
    const result = createFacturaBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('createTenantSchema', () => {
  it('acepta un tenant válido', () => {
    const input = {
      razonSocial: 'Comercio SRL',
      cuit: '20-12345678-9',
      condicionFiscal: 'monotributo',
      puntoVenta: 1,
      cert: 'cert-content',
      key: 'key-content',
    };

    const result = createTenantSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rechaza un CUIT con formato inválido', () => {
    const input = {
      razonSocial: 'Comercio SRL',
      cuit: '20123456789',
      condicionFiscal: 'monotributo',
      puntoVenta: 1,
      cert: 'cert-content',
      key: 'key-content',
    };

    const result = createTenantSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rechaza una condicionFiscal inválida', () => {
    const input = {
      razonSocial: 'Comercio SRL',
      cuit: '20-12345678-9',
      condicionFiscal: 'invalido',
      puntoVenta: 1,
      cert: 'cert-content',
      key: 'key-content',
    };

    const result = createTenantSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rechaza puntoVenta fuera de rango', () => {
    const input = {
      razonSocial: 'Comercio SRL',
      cuit: '20-12345678-9',
      condicionFiscal: 'monotributo',
      puntoVenta: 0,
      cert: 'cert-content',
      key: 'key-content',
    };

    const result = createTenantSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
