/**
 * Reglas fiscales: a partir de un tenant, una venta y un cliente, decide qué
 * comprobante hay que emitirle a ARCA (tipo, IVA, importes). Es el único lugar
 * del proyecto que sabe traducir "condición fiscal del tenant" a un payload
 * de ARCA — no toca red ni DB, así que se testea con inputs puros.
 *
 * Para agregar una condición fiscal nueva (Responsable Inscripto, Exento):
 * sumar un caso al switch de `resolverComprobante` y su función
 * `resolveComprobante*` correspondiente, sin tocar las demás.
 */
import { ValidationError } from '../../errors/index.js';
import {
  type TenantFiscal,
  type VentaInput,
  type ClienteInput,
  type ComprobantePayload,
  type TipoDocumento,
  CBTE_TIPO,
  DOC_TIPO,
  CONCEPTO,
  CONDICION_IVA_RECEPTOR,
} from './types.js';

export * from './types.js';

/** Traduce nuestro enum de documento al código numérico que espera ARCA. */
function mapTipoDocumento(tipoDoc: TipoDocumento): number {
  const mapping: Record<TipoDocumento, number> = {
    CUIT: DOC_TIPO.CUIT,
    CUIL: DOC_TIPO.CUIL,
    DNI: DOC_TIPO.DNI,
    CF: DOC_TIPO.CF,
  };
  return mapping[tipoDoc];
}

/**
 * Valida invariantes de negocio que Zod no puede expresar: que haya al menos
 * un item y que el total declarado coincida con la suma de sus líneas.
 * Redondeamos a centavos antes de comparar para no rechazar por errores de
 * punto flotante (ej. 0.1 + 0.2 !== 0.3).
 */
function validateVenta(venta: VentaInput): void {
  if (venta.items.length === 0) {
    throw new ValidationError('La venta debe tener al menos un item');
  }

  const calculatedTotal = venta.items.reduce(
    (sum, item) => sum + item.cantidad * item.precioUnitario,
    0
  );

  const roundedCalculated = Math.round(calculatedTotal * 100) / 100;
  const roundedTotal = Math.round(venta.total * 100) / 100;

  if (roundedCalculated !== roundedTotal) {
    throw new ValidationError(
      `El total (${roundedTotal}) no coincide con la suma de items (${roundedCalculated})`,
      { calculatedTotal: roundedCalculated, providedTotal: roundedTotal }
    );
  }
}

/**
 * Monotributo + Consumidor Final siempre es Factura C sin discriminar IVA:
 * el importe neto es igual al total y no hay impuestos ni exento que restar.
 *
 * El alcance de esta función es específicamente "Consumidor Final" — si el
 * cliente se identifica con CUIT/CUIL/DNI (un comprador real, no un
 * consumidor final anónimo), no alcanza con mapear su tipo de documento:
 * `condicionIvaReceptorId` también tendría que reflejar su condición real
 * frente al IVA (RG 5616), lo cual today no está implementado. Preferimos
 * rechazar explícitamente en vez de reportarle a ARCA "Consumidor Final"
 * para un comprador identificado, que sería un dato fiscal incorrecto.
 */
function resolveComprobanteMonotributo(
  tenant: TenantFiscal,
  venta: VentaInput,
  cliente: ClienteInput
): ComprobantePayload {
  if (cliente.tipoDoc !== 'CF') {
    throw new ValidationError(
      'Monotributo solo soporta Consumidor Final (tipoDoc: "CF") en este alcance',
      { tipoDocRecibido: cliente.tipoDoc }
    );
  }

  return {
    cbteTipo: CBTE_TIPO.FACTURA_C,
    ptoVta: tenant.puntoVenta,
    concepto: CONCEPTO.PRODUCTOS,
    docTipo: mapTipoDocumento(cliente.tipoDoc),
    docNro: cliente.nroDoc ?? '0',
    condicionIvaReceptorId: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    impTotal: venta.total,
    impTotConc: 0,
    impNeto: venta.total,
    impOpEx: 0,
    impIVA: 0,
    impTrib: 0,
    monId: 'PES',
    monCotiz: 1,
  };
}

function resolveComprobanteResponsableInscripto(
  _tenant: TenantFiscal,
  _venta: VentaInput,
  _cliente: ClienteInput
): ComprobantePayload {
  throw new ValidationError(
    'Responsable Inscripto no implementado aún',
    { condicionFiscal: 'resp_inscripto' }
  );
}

function resolveComprobanteExento(
  _tenant: TenantFiscal,
  _venta: VentaInput,
  _cliente: ClienteInput
): ComprobantePayload {
  throw new ValidationError(
    'Condición Exento no implementada aún',
    { condicionFiscal: 'exento' }
  );
}

/**
 * Punto de entrada del módulo: valida la venta y despacha según la condición
 * fiscal del tenant. El branch `default` es inalcanzable en tiempo de
 * ejecución (el switch cubre todo `CondicionFiscal`) pero el chequeo
 * `never` hace que TypeScript rompa el build si se agrega un valor al enum
 * sin sumar su caso acá.
 */
export function resolverComprobante(
  tenant: TenantFiscal,
  venta: VentaInput,
  cliente: ClienteInput
): ComprobantePayload {
  validateVenta(venta);

  switch (tenant.condicionFiscal) {
    case 'monotributo':
      return resolveComprobanteMonotributo(tenant, venta, cliente);
    case 'resp_inscripto':
      return resolveComprobanteResponsableInscripto(tenant, venta, cliente);
    case 'exento':
      return resolveComprobanteExento(tenant, venta, cliente);
    default: {
      const _exhaustive: never = tenant.condicionFiscal;
      throw new ValidationError(`Condición fiscal desconocida: ${_exhaustive}`);
    }
  }
}
