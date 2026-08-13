/**
 * Test de regresión de `services/arca` — el entregable central de
 * `feature/arca-service-per-user`.
 *
 * Lo que prueba, en orden de importancia:
 *
 * 1. Aislamiento real entre usuarios en el MISMO proceso: dos
 *    `ArcaCredentials` con distinto `ambiente` (`homologacion` /
 *    `produccion`) resultan en dos instancias de `Arca` construidas con
 *    `production: false` / `production: true` respectivamente — sin ningún
 *    estado compartido o global de por medio (ver el comentario extenso en
 *    `createArcaClient`, `src/services/arca/index.ts`, que documenta cómo
 *    se verificó esto leyendo el código instalado de `@arcasdk/core`). Este
 *    es el requisito de seguridad no negociable de PLAN.md: "un error de
 *    configuración no puede terminar emitiendo un comprobante real durante
 *    pruebas".
 * 2. El cacheo por `usuarioId` sigue funcionando como antes (mismo usuario
 *    devuelve el cliente cacheado; usuarios distintos nunca comparten
 *    instancia, ni siquiera si comparten `ambiente`).
 * 3. `clearArcaClientCache` sigue invalidando por usuario o todo el cache.
 * 4. Comportamiento pre-existente que no debe regresionar: la traducción
 *    del rechazo silencioso de ARCA (`cae: ""`) a `ArcaRejectionError`,
 *    `getUltimoComprobante` y `getStatus`.
 *
 * Mock de `@arcasdk/core`: mismo patrón que usaba
 * `tests/integration/facturas.test.ts` en `t3code/fix/facturas-code-review-bugs`
 * (branch pre-`monorepo-restructure`/`db-schema-v2`, donde vivían los tests
 * de integración de facturas) — `vi.mock('@arcasdk/core', () => ({ Arca:
 * <mock> }))`, reusando `tests/integration/arca-mock.ts` (que sobrevivió a
 * `feature/db-schema-v2` sin cambios) para las respuestas de
 * `electronicBillingService`. La diferencia acá es que exponemos también el
 * mock del constructor `Arca` (no solo sus métodos) para poder inspeccionar
 * con qué `production`/`cuit` fue invocado en cada test — es lo que permite
 * probar el aislamiento real y no solo el resultado funcional.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { arcaMockFns, resetArcaMock, mockArcaRejection } from '../integration/arca-mock.js';

const arcaConstructorMock = vi.fn().mockImplementation(() => ({
  electronicBillingService: {
    createVoucher: arcaMockFns.createVoucher,
    getLastVoucher: arcaMockFns.getLastVoucher,
    getServerStatus: arcaMockFns.getServerStatus,
  },
}));

vi.mock('@arcasdk/core', () => ({
  Arca: arcaConstructorMock,
}));

const { createArcaClient, getArcaClientForUsuario, clearArcaClientCache } = await import(
  '../../src/services/arca/index.js'
);
const { ArcaRejectionError, InternalArcaError } = await import('../../src/errors/index.js');
type ArcaCredentials = import('../../src/services/arca/types.js').ArcaCredentials;
type ArcaFacturaRequest = import('../../src/services/arca/types.js').ArcaFacturaRequest;

function buildCredentials(overrides: Partial<ArcaCredentials> = {}): ArcaCredentials {
  return {
    cuit: '20111111112',
    cert: 'fake-cert-content',
    key: 'fake-key-content',
    ambiente: 'homologacion',
    ...overrides,
  };
}

function buildFacturaRequest(overrides: Partial<ArcaFacturaRequest> = {}): ArcaFacturaRequest {
  return {
    cbteTipo: 11,
    ptoVta: 1,
    cbteFecha: '20260812',
    cbteDesde: 1,
    cbteHasta: 1,
    concepto: 2,
    docTipo: 80,
    docNro: '30677857516',
    condicionIvaReceptorId: 1,
    impTotal: 95000,
    impTotConc: 0,
    impNeto: 95000,
    impOpEx: 0,
    impIVA: 0,
    impTrib: 0,
    monId: 'PES',
    monCotiz: 1,
    ...overrides,
  };
}

beforeEach(() => {
  arcaConstructorMock.mockClear();
  resetArcaMock();
  clearArcaClientCache();
});

describe('createArcaClient — ambiente por credenciales, no por env global', () => {
  it('ambiente "homologacion" construye Arca con production: false', async () => {
    await createArcaClient(buildCredentials({ ambiente: 'homologacion' }));

    expect(arcaConstructorMock).toHaveBeenCalledTimes(1);
    expect(arcaConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ production: false })
    );
  });

  it('ambiente "produccion" construye Arca con production: true', async () => {
    await createArcaClient(buildCredentials({ ambiente: 'produccion' }));

    expect(arcaConstructorMock).toHaveBeenCalledTimes(1);
    expect(arcaConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ production: true })
    );
  });

  it('convierte el CUIT string (con guiones) al number que espera el SDK', async () => {
    await createArcaClient(buildCredentials({ cuit: '20-11111111-2' }));

    expect(arcaConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ cuit: 20111111112 })
    );
  });
});

describe('getArcaClientForUsuario — aislamiento real entre usuarios en el mismo proceso', () => {
  it('dos usuarios con distinto ambiente en el mismo proceso quedan configurados cada uno para su propio ambiente, sin cruce', async () => {
    const credencialesUsuarioTest = buildCredentials({
      cuit: '20-11111111-2',
      ambiente: 'homologacion',
    });
    const credencialesUsuarioReal = buildCredentials({
      cuit: '20-33333333-4',
      ambiente: 'produccion',
    });

    await getArcaClientForUsuario('usuario-homologacion', credencialesUsuarioTest);
    await getArcaClientForUsuario('usuario-produccion', credencialesUsuarioReal);

    // Se construyeron dos instancias de `Arca` (una por usuario), cada una
    // con el `production` que corresponde a SU credencial — no una mezcla,
    // ni el mismo valor para ambas, ni un valor global.
    expect(arcaConstructorMock).toHaveBeenCalledTimes(2);
    expect(arcaConstructorMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cuit: 20111111112, production: false })
    );
    expect(arcaConstructorMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cuit: 20333333334, production: true })
    );
  });

  it('llamar dos veces para el MISMO usuario devuelve el cliente cacheado (no reconstruye Arca)', async () => {
    const credentials = buildCredentials({ ambiente: 'homologacion' });

    const first = await getArcaClientForUsuario('usuario-cacheado', credentials);
    const second = await getArcaClientForUsuario('usuario-cacheado', credentials);

    expect(second).toBe(first);
    expect(arcaConstructorMock).toHaveBeenCalledTimes(1);
  });

  it('dos usuarios DISTINTOS nunca comparten instancia cacheada, aunque compartan ambiente', async () => {
    const credencialesA = buildCredentials({ cuit: '20-11111111-2', ambiente: 'homologacion' });
    const credencialesB = buildCredentials({ cuit: '20-33333333-4', ambiente: 'homologacion' });

    const clientA = await getArcaClientForUsuario('usuario-a', credencialesA);
    const clientB = await getArcaClientForUsuario('usuario-b', credencialesB);

    expect(clientA).not.toBe(clientB);
    expect(arcaConstructorMock).toHaveBeenCalledTimes(2);
  });

  it('clearArcaClientCache(usuarioId) invalida solo el cache de ese usuario', async () => {
    const credentials = buildCredentials({ ambiente: 'homologacion' });

    const first = await getArcaClientForUsuario('usuario-x', credentials);
    clearArcaClientCache('usuario-x');
    const second = await getArcaClientForUsuario('usuario-x', credentials);

    expect(second).not.toBe(first);
    expect(arcaConstructorMock).toHaveBeenCalledTimes(2);
  });

  it('clearArcaClientCache() sin argumentos invalida el cache de todos los usuarios', async () => {
    const credentials = buildCredentials({ ambiente: 'homologacion' });

    await getArcaClientForUsuario('usuario-y', credentials);
    await getArcaClientForUsuario('usuario-z', credentials);
    clearArcaClientCache();
    await getArcaClientForUsuario('usuario-y', credentials);

    // 2 construcciones iniciales (y, z) + 1 reconstrucción de "y" tras el clear total.
    expect(arcaConstructorMock).toHaveBeenCalledTimes(3);
  });
});

describe('regresión — comportamiento pre-existente que no debe romperse', () => {
  it('emitirFactura: caso feliz devuelve cae/caeFchVto/cbteNro', async () => {
    const client = await createArcaClient(buildCredentials());

    const result = await client.emitirFactura(buildFacturaRequest({ cbteDesde: 5, cbteHasta: 5 }));

    expect(result.cae).toBe('CAE-5');
    expect(result.caeFchVto).toBe('20261231');
    expect(result.cbteNro).toBe(5);
  });

  it('emitirFactura: traduce el rechazo silencioso de ARCA (cae: "") a ArcaRejectionError', async () => {
    mockArcaRejection('CUIT del comprador inválido');
    const client = await createArcaClient(buildCredentials());

    await expect(client.emitirFactura(buildFacturaRequest())).rejects.toThrow(ArcaRejectionError);

    try {
      await client.emitirFactura(buildFacturaRequest());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArcaRejectionError);
      const rejectionError = error as InstanceType<typeof ArcaRejectionError>;
      expect(rejectionError.details).toMatchObject({
        resultado: 'R',
        errores: [{ code: 10016, message: 'CUIT del comprador inválido' }],
      });
    }
  });

  it('emitirFactura: errores inesperados del SDK se envuelven en InternalArcaError', async () => {
    arcaMockFns.createVoucher.mockReset();
    arcaMockFns.createVoucher.mockRejectedValue(new Error('timeout SOAP'));
    const client = await createArcaClient(buildCredentials());

    await expect(client.emitirFactura(buildFacturaRequest())).rejects.toThrow(InternalArcaError);
  });

  it('emitirFactura: errores no-Error (valores arrojados sin ser instancia de Error) caen en el mensaje genérico', async () => {
    arcaMockFns.createVoucher.mockReset();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a propósito: simula un throw no estándar del SDK
    arcaMockFns.createVoucher.mockRejectedValue('string plano, no Error');
    const client = await createArcaClient(buildCredentials());

    await expect(client.emitirFactura(buildFacturaRequest())).rejects.toThrow(/Unknown error/);
  });

  it('emitirFactura: rechazo sin Observaciones pero con Errors.Err arma la lista de errores igual', async () => {
    arcaMockFns.createVoucher.mockReset();
    arcaMockFns.createVoucher.mockImplementation(
      async (voucher: { CbteDesde: number; CbteHasta: number }) => ({
        response: {
          FeCabResp: {},
          FeDetResp: {
            FECAEDetResponse: [
              {
                Resultado: 'R',
                CAE: '',
                CAEFchVto: '',
                CbteDesde: voucher.CbteDesde,
                CbteHasta: voucher.CbteHasta,
                // Sin `Observaciones` acá a propósito: ARCA a veces rechaza
                // solo con `Errors`, sin observaciones de detalle.
              },
            ],
          },
          Events: {},
          Errors: { Err: [{ Code: 500, Msg: 'Error de esquema XML' }] },
        },
        cae: '',
        caeFchVto: '',
      })
    );
    const client = await createArcaClient(buildCredentials());

    try {
      await client.emitirFactura(buildFacturaRequest());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArcaRejectionError);
      const rejectionError = error as InstanceType<typeof ArcaRejectionError>;
      expect(rejectionError.details).toMatchObject({
        resultado: 'R',
        errores: [{ code: 500, message: 'Error de esquema XML' }],
      });
    }
  });

  it('emitirFactura: si el SDK no informa CbteDesde en el detalle, usa el CbteDesde del request original', async () => {
    arcaMockFns.createVoucher.mockReset();
    arcaMockFns.createVoucher.mockResolvedValue({
      response: { FeCabResp: {}, FeDetResp: undefined, Events: {}, Errors: {} },
      cae: 'CAE-SIN-DETALLE',
      caeFchVto: '20261231',
    });
    const client = await createArcaClient(buildCredentials());

    const result = await client.emitirFactura(buildFacturaRequest({ cbteDesde: 7, cbteHasta: 7 }));

    expect(result.cbteNro).toBe(7);
  });

  it('getUltimoComprobante devuelve el número de comprobante', async () => {
    arcaMockFns.getLastVoucher.mockResolvedValue({ cbteNro: 42, cbteTipo: 11, ptoVta: 1 });
    const client = await createArcaClient(buildCredentials());

    await expect(client.getUltimoComprobante(1, 11)).resolves.toBe(42);
  });

  it('getUltimoComprobante devuelve 0 si el SDK no informa cbteNro (nunca se facturó ese punto de venta/tipo)', async () => {
    arcaMockFns.getLastVoucher.mockResolvedValue({ cbteNro: undefined, cbteTipo: 11, ptoVta: 1 });
    const client = await createArcaClient(buildCredentials());

    await expect(client.getUltimoComprobante(1, 11)).resolves.toBe(0);
  });

  it('getUltimoComprobante envuelve errores del SDK en InternalArcaError', async () => {
    arcaMockFns.getLastVoucher.mockReset();
    arcaMockFns.getLastVoucher.mockRejectedValue(new Error('timeout SOAP'));
    const client = await createArcaClient(buildCredentials());

    await expect(client.getUltimoComprobante(1, 11)).rejects.toThrow(InternalArcaError);
    await expect(client.getUltimoComprobante(1, 11)).rejects.toThrow(/timeout SOAP/);
  });

  it('getUltimoComprobante: errores no-Error (valores arrojados sin ser instancia de Error) caen en el mensaje genérico', async () => {
    arcaMockFns.getLastVoucher.mockReset();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a propósito: simula un throw no estándar del SDK
    arcaMockFns.getLastVoucher.mockRejectedValue('string plano, no Error');
    const client = await createArcaClient(buildCredentials());

    await expect(client.getUltimoComprobante(1, 11)).rejects.toThrow(/Unknown error/);
  });

  it('getStatus mapea appServer/authServer "OK" a wsfe/wsaa "ok"', async () => {
    const client = await createArcaClient(buildCredentials());

    await expect(client.getStatus()).resolves.toEqual({ wsfe: 'ok', wsaa: 'ok' });
  });

  it('getStatus captura errores y devuelve wsfe/wsaa "error" con el mensaje', async () => {
    arcaMockFns.getServerStatus.mockReset();
    arcaMockFns.getServerStatus.mockRejectedValue(new Error('ARCA no responde'));
    const client = await createArcaClient(buildCredentials());

    await expect(client.getStatus()).resolves.toEqual({
      wsfe: 'error',
      wsaa: 'error',
      message: 'ARCA no responde',
    });
  });

  it('getStatus: errores no-Error (valores arrojados sin ser instancia de Error) caen en el mensaje genérico', async () => {
    arcaMockFns.getServerStatus.mockReset();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a propósito: simula un throw no estándar del SDK
    arcaMockFns.getServerStatus.mockRejectedValue('string plano, no Error');
    const client = await createArcaClient(buildCredentials());

    await expect(client.getStatus()).resolves.toEqual({
      wsfe: 'error',
      wsaa: 'error',
      message: 'Unknown error',
    });
  });

  it('getStatus: appServer/authServer distintos de "OK" mapean a "error" (no solo el camino ok/ok)', async () => {
    arcaMockFns.getServerStatus.mockReset();
    arcaMockFns.getServerStatus.mockResolvedValue({ appServer: 'ERROR', authServer: 'OK' });
    const client = await createArcaClient(buildCredentials());

    await expect(client.getStatus()).resolves.toEqual({ wsfe: 'error', wsaa: 'ok' });
  });

  it('getStatus: wsaa mapea a "error" independientemente de wsfe (authServer caído, appServer arriba)', async () => {
    arcaMockFns.getServerStatus.mockReset();
    arcaMockFns.getServerStatus.mockResolvedValue({ appServer: 'OK', authServer: 'ERROR' });
    const client = await createArcaClient(buildCredentials());

    await expect(client.getStatus()).resolves.toEqual({ wsfe: 'ok', wsaa: 'error' });
  });
});
