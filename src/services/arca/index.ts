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
        const result = await arca.electronicBillingService.createVoucher({
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
        });

        if (!result.cae) {
          const detResponse = result.response.FeDetResp?.FECAEDetResponse?.[0];
          const observaciones = detResponse?.Observaciones?.Obs ?? [];
          const errores = result.response.Errors?.Err ?? [];

          const details = [...observaciones, ...errores].map((o) => ({
            code: o.Code,
            message: o.Msg,
          }));

          throw new ArcaRejectionError('ARCA rechazó el comprobante', {
            resultado: detResponse?.Resultado,
            errores: details,
          });
        }

        const detResponse = result.response.FeDetResp?.FECAEDetResponse?.[0];

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
