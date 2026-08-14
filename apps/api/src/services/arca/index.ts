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
    // `ambiente` viaja por usuario (columna `usuarios.ambiente`), nunca
    // desde una variable de entorno global — cuentas de prueba
    // (homologación) y repartidores reales (producción) conviven en la
    // misma tabla y en el mismo proceso. Verificado leyendo el código
    // instalado de `@arcasdk/core` (lib/infrastructure/composition/arca.js
    // y .../outbound/adapters/repositories/{auth,electronic-billing}/*.js):
    // este flag booleano se guarda como propiedad de instancia en
    // `AuthRepository` y en `ElectronicBillingRepository` (ambos creados de
    // nuevo en cada `new Arca(...)`), y decide ahí, por instancia, contra
    // qué host pegar — WSAA: wsaa.afip.gov.ar vs wsaahomo.afip.gov.ar;
    // WSFEv1: servicios1.afip.gov.ar/wsfev1 vs wswhomo.afip.gov.ar/wsfev1
    // (`outbound/ports/soap/enums/endpoints.enum.js`). No hay estado
    // module-level ni compartido entre instancias de `Arca`: dos clientes
    // construidos en el mismo proceso con `production` distinto son
    // completamente independientes. Si `ambiente` faltara, el SDK
    // default-ea `production` a `false` (homologación) — mismo lado seguro
    // que el default de la columna (`usuarios.ambiente` default
    // `'homologacion'`), pero igual no debe pasar nunca `undefined` acá:
    // siempre viene explícito desde `credentials.ambiente`.
    production: credentials.ambiente === 'produccion',
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
// así que cacheamos un cliente por usuario en vez de reconstruirlo en cada
// request. La clave de cache es `usuarioId` (no `ambiente`, ni ningún valor
// compartido): cada usuario tiene sus propias credenciales (cert/key/cuit)
// además de su propio `ambiente`, así que el cache nunca podría cruzar
// clientes entre dos usuarios aunque coincidieran en `ambiente`.
//
// IMPORTANTE (hallazgo de code review, no negociable por PLAN.md "Seguridad"):
// este cache NO se invalida solo cuando cambian `ambiente`/`cert`/`key` de un
// usuario en la base — antes de este pivot `ambiente` era una variable de
// entorno de todo el proceso, fija al arrancar, así que "quedar viejo" no era
// un problema. Ahora que `ambiente` vive en una columna mutable
// (`usuarios.ambiente`), cualquier UPDATE manual a esa fila (downgrade de
// producción a homologación, rotación de cert/key) deja el `ArcaClient`
// cacheado apuntando a la config VIEJA hasta que se llame
// `clearArcaClientCache(usuarioId)` explícitamente o se reinicie el proceso.
// Hoy no hay ningún endpoint del MVP que edite `usuarios.ambiente`/`cert`/
// `key` después del alta (ver PLAN.md — sin panel de admin), así que este
// camino solo se dispara por una intervención manual en la base; aun así, es
// la dirección peligrosa exactamente (un cliente de producción sobreviviendo
// a un downgrade a homologación), así que: **cualquier UPDATE manual a
// `usuarios.ambiente`/`cert`/`key` tiene que ir acompañado de
// `clearArcaClientCache(usuarioId)` o un reinicio del proceso.** Si en el
// futuro se agrega un endpoint que edite estos campos, ese endpoint tiene
// que llamar `clearArcaClientCache(usuarioId)` como parte del mismo handler.
const clientCache = new Map<string, ArcaClient>();

export async function getArcaClientForUsuario(
  usuarioId: string,
  credentials: ArcaCredentials
): Promise<ArcaClient> {
  const cached = clientCache.get(usuarioId);
  if (cached) return cached;

  const client = await createArcaClient(credentials);
  clientCache.set(usuarioId, client);
  return client;
}

/** Ver el comentario de `clientCache` sobre cuándo hay que llamar esto: siempre que `usuarios.ambiente`/`cert`/`key` cambien, manualmente o desde un futuro endpoint. */
export function clearArcaClientCache(usuarioId?: string): void {
  if (usuarioId) {
    clientCache.delete(usuarioId);
  } else {
    clientCache.clear();
  }
}
