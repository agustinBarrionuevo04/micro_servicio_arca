import { describe, it, expect } from 'vitest';
import { calcularComprobante, CBTE_TIPO, DOC_TIPO, CONCEPTO, CONDICION_IVA_RECEPTOR } from '../../src/services/fiscal-rules/index.js';
import { ValidationError } from '../../src/errors/index.js';

describe('calcularComprobante - importeTotal (unidades × precioBase)', () => {
  it('multiplica unidades por precioBase', () => {
    const result = calcularComprobante({ unidades: 300, precioBase: 95000, ptoVta: 1 });
    expect(result.impTotal).toBe(28500000);
  });

  it('redondea a centavos sin acumular error de punto flotante', () => {
    // 3.33 * 95000.55 = 316351.8315 → redondeado a 316351.83
    const result = calcularComprobante({ unidades: 3.33, precioBase: 95000.55, ptoVta: 1 });
    expect(result.impTotal).toBe(316351.83);
  });

  it('un caso clásico de imprecisión de punto flotante no se filtra al resultado', () => {
    // 0.1 * 3 en JS crudo da 0.30000000000000004
    const result = calcularComprobante({ unidades: 0.1, precioBase: 3, ptoVta: 1 });
    expect(result.impTotal).toBe(0.3);
  });
});

describe('calcularComprobante - validación de unidades', () => {
  it('rechaza unidades = 0', () => {
    expect(() => calcularComprobante({ unidades: 0, precioBase: 95000, ptoVta: 1 })).toThrow(ValidationError);
  });

  it('rechaza unidades negativas', () => {
    expect(() => calcularComprobante({ unidades: -5, precioBase: 95000, ptoVta: 1 })).toThrow(ValidationError);
  });

  it('rechaza unidades NaN', () => {
    expect(() => calcularComprobante({ unidades: NaN, precioBase: 95000, ptoVta: 1 })).toThrow(ValidationError);
  });

  it('rechaza unidades Infinity', () => {
    expect(() => calcularComprobante({ unidades: Infinity, precioBase: 95000, ptoVta: 1 })).toThrow(ValidationError);
  });
});

describe('calcularComprobante - validación de precioBase', () => {
  it('rechaza precioBase NaN', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: NaN, ptoVta: 1 })).toThrow(ValidationError);
  });

  it('rechaza precioBase Infinity', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: Infinity, ptoVta: 1 })).toThrow(ValidationError);
  });

  it('rechaza precioBase = 0', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: 0, ptoVta: 1 })).toThrow(ValidationError);
  });

  it('rechaza precioBase negativo', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: -95000, ptoVta: 1 })).toThrow(ValidationError);
  });
});

describe('calcularComprobante - validación de ptoVta', () => {
  it('rechaza ptoVta = 0', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: 95000, ptoVta: 0 })).toThrow(ValidationError);
  });

  it('rechaza ptoVta negativo', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: 95000, ptoVta: -1 })).toThrow(ValidationError);
  });

  it('rechaza ptoVta no entero', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: 95000, ptoVta: 1.5 })).toThrow(ValidationError);
  });

  it('rechaza ptoVta NaN', () => {
    expect(() => calcularComprobante({ unidades: 100, precioBase: 95000, ptoVta: NaN })).toThrow(ValidationError);
  });
});

/**
 * Snapshot de las constantes fiscales fijas: si alguien edita sin querer
 * CondicionIVAReceptorId, DocNro, etc. en el futuro, este test rompe
 * inmediatamente en vez de dejar pasar un dato fiscal incorrecto.
 */
describe('calcularComprobante - payload fiscal fijo', () => {
  it('arma el payload completo con todas las constantes fijas del producto', () => {
    const result = calcularComprobante({ unidades: 310, precioBase: 90000, ptoVta: 1 });

    expect(result).toEqual({
      cbteTipo: CBTE_TIPO.FACTURA_C,
      ptoVta: 1,
      concepto: CONCEPTO.SERVICIOS,
      docTipo: DOC_TIPO.CUIT,
      docNro: '30677857516',
      condicionIvaReceptorId: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
      impTotal: 27900000,
      impNeto: 27900000,
      impTotConc: 0,
      impOpEx: 0,
      impIVA: 0,
      impTrib: 0,
      monId: 'PES',
      monCotiz: 1,
    });
  });

  it('cbteTipo siempre es 11 (Factura C)', () => {
    expect(calcularComprobante({ unidades: 1, precioBase: 1, ptoVta: 1 }).cbteTipo).toBe(11);
  });

  it('docNro siempre es el CUIT fijo de Envío Postal SA, sin importar ptoVta', () => {
    const a = calcularComprobante({ unidades: 1, precioBase: 1, ptoVta: 1 });
    const b = calcularComprobante({ unidades: 1, precioBase: 1, ptoVta: 7 });
    expect(a.docNro).toBe('30677857516');
    expect(b.docNro).toBe('30677857516');
  });

  it('ptoVta viaja tal cual del input (no es una constante fija del módulo)', () => {
    expect(calcularComprobante({ unidades: 1, precioBase: 1, ptoVta: 42 }).ptoVta).toBe(42);
  });

  it('impNeto siempre igual a impTotal (Factura C no discrimina IVA)', () => {
    const result = calcularComprobante({ unidades: 17, precioBase: 12345.67, ptoVta: 1 });
    expect(result.impNeto).toBe(result.impTotal);
  });
});
