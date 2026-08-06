import { describe, it, expect } from 'vitest';
import { resolverComprobante, CBTE_TIPO, DOC_TIPO, CONDICION_IVA_RECEPTOR } from '../../src/services/fiscal-rules/index.js';
import { ValidationError } from '../../src/errors/index.js';
import type { TenantFiscal, VentaInput, ClienteInput } from '../../src/services/fiscal-rules/index.js';

const monotributoTenant: TenantFiscal = {
  cuit: '20-12345678-9',
  condicionFiscal: 'monotributo',
  puntoVenta: 3,
};

const consumidorFinal: ClienteInput = {
  tipoDoc: 'CF',
  nroDoc: null,
};

describe('resolverComprobante - Monotributo + Consumidor Final', () => {
  it('resuelve Factura C para un item simple', () => {
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 1, precioUnitario: 100 }],
      total: 100,
    };

    const result = resolverComprobante(monotributoTenant, venta, consumidorFinal);

    expect(result.cbteTipo).toBe(CBTE_TIPO.FACTURA_C);
    expect(result.ptoVta).toBe(3);
    expect(result.docTipo).toBe(DOC_TIPO.CF);
    expect(result.docNro).toBe('0');
    expect(result.impTotal).toBe(100);
    expect(result.impNeto).toBe(100);
    expect(result.impIVA).toBe(0);
    expect(result.impTrib).toBe(0);
    expect(result.impOpEx).toBe(0);
    expect(result.impTotConc).toBe(0);
    expect(result.condicionIvaReceptorId).toBe(CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL);
    expect(result.monId).toBe('PES');
    expect(result.monCotiz).toBe(1);
  });

  it('resuelve Factura C con múltiples items', () => {
    const venta: VentaInput = {
      items: [
        { descripcion: 'Producto A', cantidad: 2, precioUnitario: 50 },
        { descripcion: 'Producto B', cantidad: 1, precioUnitario: 30 },
      ],
      total: 130,
    };

    const result = resolverComprobante(monotributoTenant, venta, consumidorFinal);

    expect(result.impTotal).toBe(130);
    expect(result.impNeto).toBe(130);
  });

  it('acepta cantidades decimales', () => {
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto Fraccionado', cantidad: 1.5, precioUnitario: 10 }],
      total: 15,
    };

    const result = resolverComprobante(monotributoTenant, venta, consumidorFinal);
    expect(result.impTotal).toBe(15);
  });

  it('respeta el punto de venta del tenant', () => {
    const otroTenant: TenantFiscal = { ...monotributoTenant, puntoVenta: 7 };
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 1, precioUnitario: 10 }],
      total: 10,
    };

    const result = resolverComprobante(otroTenant, venta, consumidorFinal);
    expect(result.ptoVta).toBe(7);
  });

  it('usa el docNro del cliente cuando se provee (aunque sea CF)', () => {
    const clienteConDoc: ClienteInput = { tipoDoc: 'DNI', nroDoc: '30111222' };
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 1, precioUnitario: 50 }],
      total: 50,
    };

    const result = resolverComprobante(monotributoTenant, venta, clienteConDoc);
    expect(result.docTipo).toBe(DOC_TIPO.DNI);
    expect(result.docNro).toBe('30111222');
  });
});

describe('resolverComprobante - casos de error', () => {
  it('rechaza una venta sin items', () => {
    const venta: VentaInput = { items: [], total: 0 };

    expect(() => resolverComprobante(monotributoTenant, venta, consumidorFinal)).toThrow(
      ValidationError
    );
  });

  it('rechaza cuando el total no coincide con la suma de items', () => {
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 1, precioUnitario: 100 }],
      total: 150,
    };

    expect(() => resolverComprobante(monotributoTenant, venta, consumidorFinal)).toThrow(
      ValidationError
    );
  });

  it('incluye detalles del mismatch de totales en el error', () => {
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 2, precioUnitario: 10 }],
      total: 25,
    };

    try {
      resolverComprobante(monotributoTenant, venta, consumidorFinal);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.details).toMatchObject({
        calculatedTotal: 20,
        providedTotal: 25,
      });
    }
  });

  it('tolera diferencias de redondeo menores a un centavo', () => {
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 3, precioUnitario: 0.1 }],
      total: 0.3,
    };

    expect(() => resolverComprobante(monotributoTenant, venta, consumidorFinal)).not.toThrow();
  });

  it('rechaza Responsable Inscripto (no implementado aún)', () => {
    const respInscriptoTenant: TenantFiscal = {
      ...monotributoTenant,
      condicionFiscal: 'resp_inscripto',
    };
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 1, precioUnitario: 100 }],
      total: 100,
    };

    expect(() => resolverComprobante(respInscriptoTenant, venta, consumidorFinal)).toThrow(
      ValidationError
    );
  });

  it('rechaza Exento (no implementado aún)', () => {
    const exentoTenant: TenantFiscal = { ...monotributoTenant, condicionFiscal: 'exento' };
    const venta: VentaInput = {
      items: [{ descripcion: 'Producto A', cantidad: 1, precioUnitario: 100 }],
      total: 100,
    };

    expect(() => resolverComprobante(exentoTenant, venta, consumidorFinal)).toThrow(
      ValidationError
    );
  });
});
