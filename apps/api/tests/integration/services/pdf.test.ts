/**
 * `generateFacturaPdf` no toca DB ni red (recibe `Factura`/`Usuario` ya
 * resueltos, ver `src/services/pdf/index.ts`), pero sí lanza Chromium real
 * vía Puppeteer — no es una unidad "pura", así que vive en `tests/integration`
 * junto con el resto de los tests que hacen IO real, no en `tests/unit`.
 *
 * Confirmado manualmente en el sandbox de desarrollo antes de escribir este
 * archivo (ver PR body): sin el patch de
 * `patches/@arcasdk__pdf@0.2.0.patch`, `generate()` falla con
 * "No usable sandbox!"; con el patch aplicado (que ya está en
 * `pnpm-workspace.yaml` → `patchedDependencies`), genera un PDF real de
 * punta a punta. Este test NO se skipea: si algún día el patch deja de
 * aplicarse (ej. se actualiza `@arcasdk/pdf` y el patch no matchea más), el
 * fallo real de Chromium debe aparecer acá, no esconderse.
 */
import { describe, it, expect } from 'vitest';
import {
  generateFacturaPdf,
  buildInvoiceData,
  formatNumeroComprobante,
} from '../../../src/services/pdf/index.js';
import { FacturaNoEmitidaError, InternalArcaError } from '../../../src/errors/index.js';
import type { Factura } from '../../../src/db/schema/facturas.js';
import type { Usuario } from '../../../src/db/schema/usuarios.js';

function usuarioFixture(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    cuit: '20-34567890-1',
    razonSocial: 'Juan Repartidor',
    domicilio: 'Calle Falsa 123, CABA',
    condicionIva: 'Responsable Monotributo',
    puntoVenta: 1,
    cert: 'fake-cert-content',
    key: 'fake-key-content',
    ambiente: 'homologacion',
    passwordHash: 'fake-argon2-hash',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function facturaFixture(overrides: Partial<Factura> = {}): Factura {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    usuarioId: '11111111-1111-4111-8111-111111111111',
    periodo: '2026-08-01',
    unidades: '340.00',
    precioBaseUsado: '95000.00',
    importeTotal: '32300000.00',
    cbteTipo: 11,
    ptoVta: 1,
    cbteNro: 123,
    cae: '75239876543210',
    caeFchVto: '2026-08-20',
    estado: 'emitida',
    pdfUrl: null,
    payloadEnviado: {},
    respuestaArca: null,
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  };
}

describe('generateFacturaPdf', () => {
  it('genera un PDF válido (%PDF-...) para una factura emitida', async () => {
    const buffer = await generateFacturaPdf(facturaFixture(), usuarioFixture());

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
  });

  it('rechaza una factura pendiente con FacturaNoEmitidaError (409)', async () => {
    const pendiente = facturaFixture({
      estado: 'pendiente',
      cae: null,
      caeFchVto: null,
      cbteNro: null,
    });

    await expect(generateFacturaPdf(pendiente, usuarioFixture())).rejects.toBeInstanceOf(
      FacturaNoEmitidaError
    );
  });

  it('rechaza una factura en error con FacturaNoEmitidaError (409)', async () => {
    const enError = facturaFixture({ estado: 'error' });

    await expect(generateFacturaPdf(enError, usuarioFixture())).rejects.toBeInstanceOf(
      FacturaNoEmitidaError
    );
  });

  it('falla fuerte (no genera un PDF con CAE null) si una factura "emitida" no trae cae/caeFchVto/cbteNro', async () => {
    // Defensivo: no debería pasar en la práctica (ver comentario en
    // `buildInvoiceData`), pero si pasa, mejor un error explícito que un
    // PDF fiscal con datos faltantes.
    const corrupta = facturaFixture({ cae: null });

    await expect(generateFacturaPdf(corrupta, usuarioFixture())).rejects.toBeInstanceOf(
      InternalArcaError
    );
  });
});

describe('buildInvoiceData', () => {
  it('mapea unidades/precio/importe (numeric-como-string en DB) a number', () => {
    const data = buildInvoiceData(facturaFixture(), usuarioFixture());

    expect(data.items[0]?.cantidad).toBe(340);
    expect(data.items[0]?.precioUnitario).toBe(95000);
    expect(data.importeTotal).toBe(32300000);
    expect(data.importeNetoGravado).toBe(32300000);
    expect(data.importeIva).toBe(0);
  });

  it('usa el receptor fijo (Envío Postal SA, CUIT 30677857516) sin importar el usuario', () => {
    const data = buildInvoiceData(
      facturaFixture(),
      usuarioFixture({ razonSocial: 'Otro Repartidor', cuit: '20-11111111-1' })
    );

    expect(data.receptor).toEqual({
      razonSocial: 'Envío Postal SA',
      condicionIva: 'Responsable Inscripto',
      documentoTipo: 'CUIT',
      documentoNro: '30677857516',
    });
  });

  it('usa el CUIT del usuario (sin guiones) como iibb, documentado como proxy', () => {
    const data = buildInvoiceData(facturaFixture(), usuarioFixture({ cuit: '20-34567890-1' }));

    expect(data.emisor.cuit).toBe('20345678901');
    expect(data.emisor.iibb).toBe('20345678901');
  });
});

describe('formatNumeroComprobante', () => {
  it('formatea puntoVenta y cbteNro con padding fijo, igual al ejemplo de docs/api-contract.md', () => {
    expect(formatNumeroComprobante(1, 123)).toBe('0001-00000123');
  });
});
