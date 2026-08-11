/**
 * Reglas fiscales de este producto: a partir de `unidades` + `precioBase` +
 * `ptoVta`, arma el payload exacto que espera ARCA (WSFE) para el único
 * comprobante que este producto emite. No toca red ni DB, así que se testea
 * con inputs puros (ver PLAN.md, "Regla de negocio central").
 *
 * A diferencia del módulo `fiscal-rules` genérico que reemplaza (multi-tenant,
 * multi-condición fiscal — ver
 * `git show origin/feature/monorepo-restructure:apps/api/src/services/fiscal-rules/index.ts`
 * para el histórico), acá no hay ningún switch de condición: el receptor
 * (Envío Postal SA), el tipo de comprobante (Factura C) y la condición IVA
 * del receptor son siempre los mismos para todos los usuarios de esta
 * plataforma — esa es la regla de negocio central del producto, no una
 * simplificación temporal.
 *
 * Este módulo deliberadamente NO resuelve:
 * - `periodo` / vigencia de precio (responsabilidad de
 *   `feature/precios-base-service`, que resuelve `getPrecioVigente(periodo)`
 *   y le pasa el `precioBase` resultante a esta función).
 * - Numeración (`CbteDesde`/`CbteHasta`) ni fecha (`CbteFecha`) del
 *   comprobante (responsabilidad de quien orquesta el envío —
 *   `feature/facturas-service-v2` — usando el patrón de `contadores`).
 * - Comunicación con ARCA en sí (responsabilidad de
 *   `feature/arca-service-per-user`, que wrappea `@arcasdk/core`).
 */
import { ValidationError } from '../../errors/index.js';
import {
  CBTE_TIPO,
  DOC_TIPO,
  CONCEPTO,
  CONDICION_IVA_RECEPTOR,
  type ComprobantePayload,
  type CalcularComprobanteInput,
} from './types.js';

export * from './types.js';

/**
 * CUIT de Envío Postal SA. Receptor fijo para todos los usuarios de esta
 * plataforma (repartidores monotributistas de EPSA facturándole a EPSA) —
 * ver PLAN.md, "Regla de negocio central": "Receptor fijo para todos los
 * usuarios: Envío Postal SA, CUIT 30677857516, Responsable Inscripto". Que
 * este valor no varíe por usuario/factura no es un bug ni una limitación
 * del MVP: es el motivo de ser de este producto (una app de facturación de
 * un solo cliente para muchos monotributistas), así que va hardcodeado acá
 * en vez de ser un parámetro de `calcularComprobante`.
 */
const RECEPTOR_DOC_NRO = '30677857516';

/**
 * Arma el comprobante que este producto factura cada mes: unidades
 * entregadas × precio base vigente del período, con el resto de los campos
 * fiscales fijos (ver comentarios inline sobre cada constante).
 *
 * @param input.unidades   Cantidad de entregas cargadas a mano por el
 *                          repartidor para el período (no hay OCR en el MVP,
 *                          ver PLAN.md).
 * @param input.precioBase Precio base vigente para el período facturado, ya
 *                          resuelto por quien llama (este módulo no sabe de
 *                          `periodo` ni de rangos de vigencia).
 * @param input.ptoVta     Punto de venta habilitado en ARCA para el usuario
 *                          emisor. No es fiscalmente fijo (cada usuario tiene
 *                          el suyo), por eso viaja como parámetro y no como
 *                          constante de este módulo.
 */
export function calcularComprobante(input: CalcularComprobanteInput): ComprobantePayload {
  const { unidades, precioBase, ptoVta } = input;

  // `unidades <= 0` cubre negativos y cero (no se factura una entrega
  // negativa ni un período sin entregas); `!Number.isFinite` cubre NaN e
  // Infinity, que "unidades <= 0" por sí solo no atrapa (NaN <= 0 es false).
  // Nunca queremos que un NaN/Infinity de unidades llegue a multiplicarse y
  // termine en un dato fiscal corrupto.
  if (!Number.isFinite(unidades) || unidades <= 0) {
    throw new ValidationError('unidades debe ser un número finito mayor a 0', { unidades });
  }

  // precioBase puede llegar corrupto desde quien orquesta (ej. un lookup de
  // precios_base sin resultado devolviendo NaN, o un cálculo previo que
  // desbordó a Infinity). Nunca queremos reportarle a ARCA un importe NaN o
  // Infinity: mejor fallar acá, temprano y explícito.
  if (!Number.isFinite(precioBase)) {
    throw new ValidationError('precioBase debe ser un número finito', { precioBase });
  }

  // Dinero: se calcula en la unidad más chica (centavos) para no acumular
  // error de punto flotante (ej. 0.1 + 0.2 !== 0.3), redondeando el
  // resultado final una sola vez al final de la multiplicación en vez de
  // redondear operandos intermedios.
  const importeTotal = Math.round(unidades * precioBase * 100) / 100;

  return {
    // Factura C: único comprobante que este producto emite. El receptor es
    // siempre un monotributista (el repartidor) facturándole a un
    // Responsable Inscripto (Envío Postal SA) — la combinación que exige
    // WSFE para eso es siempre Factura C, sin importar quién sea el
    // receptor puntual, así que no hay switch de tipo de comprobante como
    // en el módulo genérico que este reemplaza.
    cbteTipo: CBTE_TIPO.FACTURA_C,

    ptoVta,

    // Servicios (no productos ni "productos y servicios"): la actividad
    // facturada es logística de última milla (entregas), un servicio, no la
    // venta de un bien. PLAN.md no elabora más que "Concepto=2" en la
    // sección "Integración ARCA (decisiones ya tomadas)" — se tomó ese valor
    // tal cual del plan sin reinterpretarlo. Si esa asunción alguna vez
    // resulta incorrecta, este es el único lugar del código que hay que
    // cambiar.
    concepto: CONCEPTO.SERVICIOS,

    // CUIT: tipo de documento del receptor. Fijo porque el receptor mismo es
    // fijo (ver RECEPTOR_DOC_NRO más abajo).
    docTipo: DOC_TIPO.CUIT,
    docNro: RECEPTOR_DOC_NRO,

    // Campo obligatorio desde abril 2026 (RG 5616 / PLAN.md, "Integración
    // ARCA"). Se fija en Responsable Inscripto porque el receptor (Envío
    // Postal SA) siempre lo es — no depende del emisor ni de la factura
    // puntual, así que no hace falta resolverlo dinámicamente.
    condicionIvaReceptorId: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,

    impTotal: importeTotal,

    // Factura C no discrimina IVA: todo el importe es neto, no hay
    // conceptos no gravados/exentos/otros tributos ni IVA para desglosar
    // por separado. Por eso ImpNeto = ImpTotal y el resto de los ImpXxx van
    // en 0 — no es que falten datos, es que en Factura C no existen esos
    // conceptos.
    impNeto: importeTotal,
    impTotConc: 0,
    impOpEx: 0,
    impIVA: 0,
    impTrib: 0,

    // Todas las facturas de este producto son en pesos argentinos sin
    // conversión de moneda (el receptor y el emisor operan en el mismo
    // país, misma moneda) — MonCotiz=1 es la cotización "sin conversión"
    // que exige WSFE incluso para moneda local.
    monId: 'PES',
    monCotiz: 1,
  };
}
