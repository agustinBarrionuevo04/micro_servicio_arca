/**
 * Único punto del proyecto que conoce `@arcasdk/core`. Todo lo demás
 * (rutas, servicios de facturas) habla en términos de `ArcaClient` /
 * `ArcaFacturaRequest`, no del SDK — así que reemplazar el SDK algún día
 * solo implica reescribir este archivo.
 *
 * Detalle importante del SDK que no es obvio desde su tipado: cuando ARCA
 * rechaza un comprobante, `createVoucher` NO tira una excepción — devuelve
 * `cae: ""` junto con el detalle del rechazo en `response.FeDetResp`. Acá
 * es donde traducimos ese caso a `ArcaRejectionError` para que el resto del
 * código pueda tratarlo como cualquier otro error.
 */
import { ArcaRejectionError, InternalArcaError } from '../../errors/index.js';
import { env } from '../../config/env.js';
import type {
  ArcaCredentials,
  ArcaFacturaRequest,
  ArcaFacturaResponse,
  ArcaStatus,
} from './types.js';

export * from './types.js';

export interface ArcaClient {
  emitirFactura(request: ArcaFacturaRequest): Promise<ArcaFacturaResponse>;
  getUltimoComprobante(ptoVta: number, cbteTipo: number): Promise<number>;
  getStatus(): Promise<ArcaStatus>;
}

function cuitToNumber(cuit: string): number {
  return Number(cuit.replace(/-/g, ''));
}

/** Arma el `IVoucher` en el shape PascalCase que espera el SOAP de ARCA a partir de nuestro request en camelCase. */
function toVoucherPayload(request: ArcaFacturaRequest) {
  return {
    CantReg: request.cbteHasta - request.cbteDesde + 1,
    PtoVta: request.ptoVta,
    CbteTipo: request.cbteTipo,
    Concepto: request.concepto,
    DocTipo: request.docTipo,
    DocNro: Number(request.docNro),
    CbteDesde: request.cbteDesde,
    CbteHasta: request.cbteHasta,
    CbteFch: request.cbteFecha,
    ImpTotal: request.impTotal,
    ImpTotConc: request.impTotConc,
    ImpNeto: request.impNeto,
    ImpOpEx: request.impOpEx,
    ImpIVA: request.impIVA,
    ImpTrib: request.impTrib,
    MonId: request.monId,
    MonCotiz: request.monCotiz,
    CondicionIVAReceptorId: request.condicionIvaReceptorId,
  };
}

/** Junta observaciones + errores del detalle de respuesta en una sola lista plana para el error. */
function extractRejectionDetails(
  detResponse: { Observaciones?: { Obs?: { Code: number; Msg: string }[] } } | undefined,
  errors: { Err?: { Code: number; Msg: string }[] } | undefined
) {
  const observaciones = detResponse?.Observaciones?.Obs ?? [];
  const errores = errors?.Err ?? [];
  return [...observaciones, ...errores].map((o) => ({ code: o.Code, message: o.Msg }));
}

export async function createArcaClient(credentials: ArcaCredentials): Promise<ArcaClient> {
  const { Arca } = await import('@arcasdk/core');

  const arca = new Arca({
    cuit: cuitToNumber(credentials.cuit),
    cert: credentials.cert,
    key: credentials.key,
    production: env.ARCA_MODE === 'produccion',
  });

  return {
    async emitirFactura(request: ArcaFacturaRequest): Promise<ArcaFacturaResponse> {
      try {
        const result = await arca.electronicBillingService.createVoucher(
          toVoucherPayload(request)
        );
        const detResponse = result.response.FeDetResp?.FECAEDetResponse?.[0];

        if (!result.cae) {
          throw new ArcaRejectionError('ARCA rechazó el comprobante', {
            resultado: detResponse?.Resultado,
            errores: extractRejectionDetails(detResponse, result.response.Errors),
          });
        }

        return {
          cae: result.cae,
          caeFchVto: result.caeFchVto,
          cbteNro: detResponse?.CbteDesde ?? request.cbteDesde,
        };
      } catch (error) {
        if (error instanceof ArcaRejectionError) throw error;

        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new InternalArcaError(message);
      }
    },

    async getUltimoComprobante(ptoVta: number, cbteTipo: number): Promise<number> {
      try {
        const result = await arca.electronicBillingService.getLastVoucher(ptoVta, cbteTipo);
        return result.cbteNro ?? 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new InternalArcaError(`Error getting last voucher: ${message}`);
      }
    },

    async getStatus(): Promise<ArcaStatus> {
      try {
        const status = await arca.electronicBillingService.getServerStatus();
        return {
          wsfe: status.appServer === 'OK' ? 'ok' : 'error',
          wsaa: status.authServer === 'OK' ? 'ok' : 'error',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          wsfe: 'error',
          wsaa: 'error',
          message,
        };
      }
    },
  };
}

// Instanciar `Arca` involucra parsear el cert/key y preparar el cliente SOAP,
// así que cacheamos un cliente por tenant en vez de reconstruirlo en cada request.
const clientCache = new Map<string, ArcaClient>();

export async function getArcaClientForTenant(
  tenantId: string,
  credentials: ArcaCredentials
): Promise<ArcaClient> {
  const cached = clientCache.get(tenantId);
  if (cached) return cached;

  const client = await createArcaClient(credentials);
  clientCache.set(tenantId, client);
  return client;
}

export function clearArcaClientCache(tenantId?: string): void {
  if (tenantId) {
    clientCache.delete(tenantId);
  } else {
    clientCache.clear();
  }
}
