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

function mapTipoDocumento(tipoDoc: TipoDocumento): number {
  const mapping: Record<TipoDocumento, number> = {
    CUIT: DOC_TIPO.CUIT,
    CUIL: DOC_TIPO.CUIL,
    DNI: DOC_TIPO.DNI,
    CF: DOC_TIPO.CF,
  };
  return mapping[tipoDoc];
}

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

function resolveComprobanteMonotributo(
  tenant: TenantFiscal,
  venta: VentaInput,
  cliente: ClienteInput
): ComprobantePayload {
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
