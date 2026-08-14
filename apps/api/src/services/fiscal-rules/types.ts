/**
 * Tipos y catálogos del dominio fiscal para este producto.
 *
 * A diferencia del módulo `fiscal-rules` genérico que existía antes del
 * pivot (multi-condición fiscal, multi-tipo de comprobante — ver
 * `git show origin/feature/monorepo-restructure:apps/api/src/services/fiscal-rules/types.ts`
 * para el histórico), este producto tiene un único comprobante posible:
 * Factura C, receptor fijo, monotributo. Los `Record`-style const objects de
 * abajo se mantienen igual (es el patrón canónico para códigos ARCA en este
 * repo — ver `apps/api/src/db/schema/facturas.ts`, que referencia
 * `CBTE_TIPO.FACTURA_C = 11`), pero cada uno solo lista el/los valores que
 * este producto efectivamente usa, no el catálogo completo de WSFE. Si en el
 * futuro se soporta otro tipo de comprobante/receptor, este es el lugar
 * donde sumar la constante nueva.
 *
 * Los valores numéricos en sí (11, 80, 2, 1, etc.) son códigos fijos
 * definidos por la especificación de WSFE — no los elegimos nosotros, los
 * exige ARCA. El *por qué* de cada elección puntual (por qué 11 y no 1/6,
 * por qué 2 y no 1/3, etc.) está documentado en `index.ts`, donde se usan.
 */

/** Tipos de comprobante WSFE que este producto puede emitir. */
export const CBTE_TIPO = {
  FACTURA_C: 11,
} as const;

/** Tipos de documento de receptor que este producto puede reportar. */
export const DOC_TIPO = {
  CUIT: 80,
} as const;

/** Conceptos WSFE (productos=1, servicios=2, ambos=3) que este producto puede reportar. */
export const CONCEPTO = {
  SERVICIOS: 2,
} as const;

/**
 * Condición frente al IVA del receptor (RG 5616, campo obligatorio desde
 * abril 2026 — ver PLAN.md, "Integración ARCA").
 */
export const CONDICION_IVA_RECEPTOR = {
  RESPONSABLE_INSCRIPTO: 1,
} as const;

/**
 * Payload de comprobante ya resuelto por `calcularComprobante`, listo para
 * completarse con numeración (`CbteDesde`/`CbteHasta`, responsabilidad del
 * patrón de `contadores`) y fecha (`CbteFecha`, responsabilidad de quien
 * orquesta el envío) antes de mandarse a `@arcasdk/core`.
 *
 * Los nombres de campo son camelCase y coinciden con
 * `apps/api/src/db/schema/facturas.ts` para que no haga falta traducir entre
 * el resultado de este módulo y lo que se persiste.
 */
export interface ComprobantePayload {
  cbteTipo: number;
  ptoVta: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  condicionIvaReceptorId: number;
  impTotal: number;
  impNeto: number;
  impTotConc: number;
  impOpEx: number;
  impIVA: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
}

/** Input de `calcularComprobante`: lo mínimo que necesita para armar el payload. */
export interface CalcularComprobanteInput {
  unidades: number;
  precioBase: number;
  ptoVta: number;
}
