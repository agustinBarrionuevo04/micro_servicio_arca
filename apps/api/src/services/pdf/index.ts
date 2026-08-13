/**
 * Genera el PDF de una factura ya emitida, on-demand y sin storage
 * persistente (PLAN.md, "Decisiones de diseño nuevas" → "PDF"): se
 * reconstruye siempre a partir de los datos de la factura + CAE, así que
 * este módulo es el único punto del proyecto que conoce `@arcasdk/pdf`
 * (mismo criterio que `services/arca` con `@arcasdk/core` — si el generador
 * de PDF cambia algún día, solo hay que reescribir este archivo).
 *
 * `@arcasdk/pdf` usa Puppeteer/Chromium por debajo para rendear el HTML del
 * comprobante a PDF. La versión `0.2.0` publicada llama a
 * `puppeteer.launch({ headless: true })` sin exponer forma de pasar `args`,
 * así que Chromium intenta usar su sandbox por setuid/userns por default.
 * Eso falla tanto en contenedores Docker sin `--cap-add=SYS_ADMIN` como en
 * hosts con AppArmor restringiendo unprivileged user namespaces (Ubuntu
 * 23.10+, `kernel.apparmor_restrict_unprivileged_userns=1`) con
 * "No usable sandbox!" — se aplica un patch local
 * (`patches/@arcasdk__pdf@0.2.0.patch`, vía `pnpm.patchedDependencies` en
 * `pnpm-workspace.yaml`) que agrega `args: ["--no-sandbox",
 * "--disable-setuid-sandbox"]` al `launch()`, el workaround estándar de
 * Puppeteer para Docker (https://pptr.dev/troubleshooting#running-puppeteer-in-docker).
 * Confirmado manualmente en este sandbox: sin el patch, `generate()` cuelga/
 * falla con "No usable sandbox!"; con el patch aplicado, genera un PDF
 * válido (`%PDF-...`) de punta a punta. El `Dockerfile` de esta rama asume
 * el mismo workaround (ver comentario ahí).
 */
import { InvoicePdfGenerator, type InvoiceData, type ReceptorData } from '@arcasdk/pdf';
import type { Factura } from '../../db/schema/facturas.js';
import type { Usuario } from '../../db/schema/usuarios.js';
import { FacturaNoEmitidaError, InternalArcaError } from '../../errors/index.js';

/**
 * Receptor fijo para todos los usuarios de esta plataforma: Envío Postal SA,
 * CUIT 30677857516, Responsable Inscripto — misma constante de negocio que
 * `RECEPTOR_DOC_NRO` en
 * `git show origin/feature/fiscal-rules-v2:apps/api/src/services/fiscal-rules/index.ts`,
 * repetida acá (en vez de importada) porque `fiscal-rules-v2` es una rama
 * hermana que todavía no mergeó a esta (ambas parten de `db-schema-v2`, ver
 * PLAN.md "Ramas y orden de ejecución" — Etapa 3, en paralelo). Que este
 * valor no varíe por usuario/factura no es un bug ni una limitación del MVP:
 * es el motivo de ser de este producto (una app de facturación de un solo
 * cliente para muchos monotributistas). Cuando ambas ramas converjan en
 * `develop`, este bloque debería colapsar a una única fuente de verdad
 * compartida (ver TODO al final de este archivo).
 */
const RECEPTOR_FIJO: ReceptorData = {
  razonSocial: 'Envío Postal SA',
  condicionIva: 'Responsable Inscripto',
  documentoTipo: 'CUIT',
  documentoNro: '30677857516',
};

/** Formatea `punto de venta - número de comprobante` (ej. "0001-00000123"), mismo formato que expone `docs/api-contract.md`. */
export function formatNumeroComprobante(ptoVta: number, cbteNro: number): string {
  return `${String(ptoVta).padStart(4, '0')}-${String(cbteNro).padStart(8, '0')}`;
}

/**
 * Arma el `InvoiceData` que espera `@arcasdk/pdf` a partir de una fila de
 * `facturas` + su `usuarios` dueño.
 *
 * Nota sobre datos del emisor ausentes en el schema actual: `EmisorData`
 * exige `iibb` (número de Ingresos Brutos) y `fechaInicioActividades`, que
 * `usuarios` (esta rama, `db-schema-v2`) todavía no persiste como columnas
 * propias — no hay ningún `feature/*` en el plan que las agregue todavía.
 * Se usan dos aproximaciones documentadas mientras tanto, no un dato
 * inventado a ciegas:
 * - `iibb`: se usa el mismo CUIT (`usuario.cuit` sin guiones). Es la
 *   convención real para un monotributista bajo Convenio Multilateral (el
 *   número de inscripción en IIBB coincide con el CUIT) — no es una
 *   suposición arbitraria, pero tampoco está verificada por-usuario.
 * - `fechaInicioActividades`: se usa `usuario.createdAt` (alta en esta
 *   plataforma) como proxy, NO el inicio de actividades real del
 *   monotributo (que puede ser muy anterior). Es un dato legalmente
 *   incorrecto si se toma al pie de la letra.
 *
 * **Flag para producción**: agregar columnas reales `iibb` y
 * `fecha_inicio_actividades` a `usuarios` (probablemente en
 * `feature/usuarios-onboarding`, que ya toca el alta) y reemplazar este
 * proxy antes de emitir comprobantes reales — ver PR body.
 */
export function buildInvoiceData(factura: Factura, usuario: Usuario): InvoiceData {
  if (factura.cae == null || factura.caeFchVto == null || factura.cbteNro == null) {
    // Defensivo: no debería pasar nunca si `estado === 'emitida'` (la
    // orquestación que setea `estado: 'emitida'` es responsabilidad de
    // `feature/facturas-service-v2` y siempre lo hace junto con cae/cbteNro/
    // caeFchVto en la misma escritura), pero preferimos fallar fuerte y
    // explícito acá antes que generar un PDF con "CAE: null" en un
    // comprobante fiscal.
    throw new InternalArcaError(
      `Factura ${factura.id} está 'emitida' pero le faltan cae/caeFchVto/cbteNro`
    );
  }

  const cuitSinGuiones = usuario.cuit.replace(/-/g, '');
  const cbteNro = factura.cbteNro;

  return {
    emisor: {
      razonSocial: usuario.razonSocial,
      domicilioComercial: usuario.domicilio,
      condicionIva: usuario.condicionIva,
      cuit: cuitSinGuiones,
      // Ver docstring de esta función: proxy documentado, no columna real todavía.
      iibb: cuitSinGuiones,
      fechaInicioActividades: usuario.createdAt.toISOString().slice(0, 10),
    },
    receptor: RECEPTOR_FIJO,
    cbteTipo: factura.cbteTipo,
    cbteLetra: 'C', // Único tipo que emite este producto (PLAN.md, factura.ts) — ver `db/schema/facturas.ts` sobre `cbteTipo` fijo a 11.
    cbteDescripcion: 'FACTURA',
    puntoVenta: factura.ptoVta,
    cbteDesde: cbteNro,
    cbteHasta: cbteNro, // Nunca se emite en lote (PLAN.md): una factura de este producto siempre es un único comprobante.
    cbteFecha: factura.createdAt.toISOString().slice(0, 10),
    // Servicios (logística de última milla), no productos — mismo valor y
    // mismo motivo que `CONCEPTO.SERVICIOS` en `fiscal-rules-v2` (ver
    // comentario del bloque `RECEPTOR_FIJO` de arriba sobre por qué no se
    // importa desde ahí).
    concepto: 2,
    moneda: 'PES',
    items: [
      {
        descripcion: `Servicio de logística de última milla — período ${factura.periodo}`,
        cantidad: Number(factura.unidades),
        unidadMedida: 'unidad',
        precioUnitario: Number(factura.precioBaseUsado),
        subtotal: Number(factura.importeTotal),
      },
    ],
    // Factura C no discrimina IVA (mismo razonamiento que `fiscal-rules-v2`:
    // ImpNeto = ImpTotal, sin desglose de IVA/tributos).
    importeNetoGravado: Number(factura.importeTotal),
    importeIva: 0,
    importeTotal: Number(factura.importeTotal),
    cae: factura.cae,
    caeFechaVencimiento: factura.caeFchVto,
  };
}

/**
 * `generateFacturaPdf`: única función pública de este módulo. Guarda de
 * negocio central — solo una factura `emitida` (con CAE real de ARCA) puede
 * tener PDF; ver `FacturaNoEmitidaError`.
 */
export async function generateFacturaPdf(factura: Factura, usuario: Usuario): Promise<Buffer> {
  if (factura.estado !== 'emitida') {
    throw new FacturaNoEmitidaError(factura.estado);
  }

  const data = buildInvoiceData(factura, usuario);
  const generator = new InvoicePdfGenerator();
  const result = await generator.generate(data);

  // `@arcasdk/pdf`'s `.d.ts` declara `generate(): Promise<Buffer>`, pero en
  // runtime devuelve un `Uint8Array` plano (confirmado corriendo el
  // generador real en este sandbox, ver PR body): Puppeteer movió
  // `page.pdf()` de `Buffer` a `Uint8Array` en versiones recientes y
  // `@arcasdk/pdf@0.2.0` reenvía ese valor tal cual, sin envolverlo. Un
  // `Uint8Array` funciona para casi todo (`reply.send`, escribir a disco),
  // pero no es un `Buffer` real (`Buffer.isBuffer()` da `false`), así que se
  // normaliza acá para que esta función cumpla su firma declarada
  // (`Promise<Buffer>`) de verdad, no solo de nombre. `Buffer.from(view)` no
  // copia si `view` ya es un `Buffer`, así que este wrap es gratis en el
  // caso en que la librería alguna vez corrija su propio tipo.
  return Buffer.from(result);
}
