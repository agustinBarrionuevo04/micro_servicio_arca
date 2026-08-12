/**
 * Orquesta la creación de una factura: idempotencia → reglas fiscales →
 * numeración segura → llamada a ARCA → persistencia. Es el módulo que le da
 * uso real a `services/fiscal-rules`, `services/idempotency` y
 * `services/arca` juntos.
 */
import { eq, and, sql, gte, lte, count } from 'drizzle-orm';
import { db, type Database, type Transaction } from '../../db/index.js';
import { facturas, contadores, type Tenant, type Factura, type EstadoFactura } from '../../db/schema/index.js';
import { decrypt } from '../../config/crypto.js';
import { getArcaClientForTenant, type ArcaFacturaRequest, type ArcaCredentials } from '../../services/arca/index.js';
import { resolverComprobante, type VentaInput, type ClienteInput } from '../../services/fiscal-rules/index.js';
import { createIdempotencyService } from '../../services/idempotency/index.js';
import { FacturaNotFoundError, ArcaRejectionError, DuplicateIdempotencyKeyError } from '../../errors/index.js';
import type { CreateFacturaBody } from './schemas.js';

export interface CreateFacturaResult {
  factura: Factura;
  /** false si vino de un reintento con el mismo Idempotency-Key (la ruta usa esto para responder 200 en vez de 201). */
  isNew: boolean;
}

/**
 * Código de error de Postgres para violación de constraint único
 * (23505 = unique_violation). Drizzle envuelve el error real del driver
 * `pg` en un `DrizzleQueryError` cuyo `.code` es `undefined` — el código
 * verdadero queda en `.cause.code`, así que hay que mirar ambos lugares.
 */
function isUniqueViolation(error: unknown): boolean {
  return getPgErrorCode(error) === '23505';
}

function getPgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const err = error as { code?: unknown; cause?: unknown };
  if (typeof err.code === 'string') return err.code;
  if (typeof err.cause === 'object' && err.cause !== null && 'code' in err.cause) {
    const cause = err.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return undefined;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatNumero(ptoVta: number, cbteNro: number): string {
  const pto = String(ptoVta).padStart(4, '0');
  const nro = String(cbteNro).padStart(8, '0');
  return `${pto}-${nro}`;
}

function toVentaInput(body: CreateFacturaBody): VentaInput {
  return {
    items: body.items.map((item) => ({
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precio_unitario,
    })),
    total: body.total,
  };
}

function toClienteInput(body: CreateFacturaBody): ClienteInput {
  return {
    tipoDoc: body.cliente.tipo_doc,
    nroDoc: body.cliente.nro_doc,
  };
}

function toArcaCredentials(tenant: Tenant): ArcaCredentials {
  return {
    cert: decrypt(tenant.cert),
    key: decrypt(tenant.key),
    cuit: tenant.cuit.replace(/-/g, ''),
  };
}

/**
 * Toma y devuelve el próximo número de comprobante para
 * `(tenant, punto de venta, tipo de comprobante)`. Usa `INSERT ... ON
 * CONFLICT DO UPDATE` en vez de un `SELECT FOR UPDATE` + `UPDATE` separados:
 * así es atómico y autocontenido incluso si todavía no existe la fila del
 * contador (por ejemplo, un `cbteTipo` que `POST /admin/tenants` no
 * sembró de antemano) — con el patrón anterior, si la fila no existía el
 * `UPDATE` no afectaba ninguna fila y el contador quedaba trabado en 1 para
 * siempre. El `ON CONFLICT` toma el mismo tipo de lock de fila que un
 * `SELECT FOR UPDATE`, así que dos requests concurrentes del mismo tenant
 * se siguen serializando acá (lo que garantiza el test de concurrencia).
 */
async function getNextNumero(
  tx: Transaction,
  tenantId: string,
  ptoVta: number,
  cbteTipo: number
): Promise<number> {
  const [result] = await tx
    .insert(contadores)
    .values({ tenantId, ptoVta, cbteTipo, ultimoNumero: 1 })
    .onConflictDoUpdate({
      target: [contadores.tenantId, contadores.ptoVta, contadores.cbteTipo],
      set: { ultimoNumero: sql`${contadores.ultimoNumero} + 1` },
    })
    .returning({ ultimoNumero: contadores.ultimoNumero });

  return result!.ultimoNumero;
}

/** Reversa un número tomado por `getNextNumero` cuando ARCA rechaza el comprobante (evita huecos innecesarios en la numeración). */
async function decrementNumero(
  tx: Transaction,
  tenantId: string,
  ptoVta: number,
  cbteTipo: number
): Promise<void> {
  await tx
    .update(contadores)
    .set({ ultimoNumero: sql`${contadores.ultimoNumero} - 1` })
    .where(
      and(
        eq(contadores.tenantId, tenantId),
        eq(contadores.ptoVta, ptoVta),
        eq(contadores.cbteTipo, cbteTipo)
      )
    );
}

export async function createFactura(
  tenant: Tenant,
  body: CreateFacturaBody,
  idempotencyKey: string
): Promise<CreateFacturaResult> {
  const idempotencyService = createIdempotencyService(db);
  const existing = await idempotencyService.findExisting(tenant.id, idempotencyKey);
  if (existing) {
    return { factura: existing, isNew: false };
  }

  const comprobante = resolverComprobante(
    { cuit: tenant.cuit, condicionFiscal: tenant.condicionFiscal, puntoVenta: tenant.puntoVenta },
    toVentaInput(body),
    toClienteInput(body)
  );

  const arcaClient = await getArcaClientForTenant(tenant.id, toArcaCredentials(tenant));

  // Estrategia de la transacción: tomamos número + insertamos "pendiente",
  // después llamamos a ARCA (una llamada de red, adentro de la transacción
  // porque necesitamos el número reservado antes de poder pedirle el CAE).
  //
  // Deuda técnica conocida: mantener la llamada a ARCA adentro de la
  // transacción implica sostener el lock de fila del contador (tomado por
  // `getNextNumero`) y una conexión del pool durante todo el round-trip de
  // red. Si ARCA está lenta, las requests de un mismo tenant se serializan
  // detrás de ese lock, y si el pool (máx. 10 conexiones por default) se
  // agota, afecta a todos los tenants, no solo al que dispara la request
  // lenta. Arreglarlo bien requiere separar esto en 3 fases (reservar
  // número + insertar "pendiente" en una transacción corta → llamar a ARCA
  // sin transacción abierta → confirmar el resultado en una segunda
  // transacción corta), lo cual cambia qué pasa si un reintento llega
  // mientras una factura quedó en 'pendiente' tras un error de red (hoy eso
  // no puede pasar porque todo hace rollback). Queda pendiente para un pase
  // dedicado, con sus propios tests de esa nueva semántica de reintento.
  //
  // - Si ARCA aprueba o tira un error que no es un rechazo explícito
  //   (de red, interno): dejamos que la excepción salga y todo hace
  //   rollback — nada queda a medio persistir, el cliente puede reintentar
  //   con el mismo Idempotency-Key sin duplicar nada.
  // - Si ARCA rechaza explícitamente (`ArcaRejectionError`): SÍ queremos
  //   dejar constancia del rechazo, así que atrapamos el error adentro,
  //   marcamos la factura 'rechazada', liberamos el número reservado, y
  //   recién después de que la transacción hace commit relanzamos el error
  //   para que la ruta responda 422.
  const { factura, rejection } = await db.transaction(async (tx) => {
    const cbteNro = await getNextNumero(tx, tenant.id, comprobante.ptoVta, comprobante.cbteTipo);

    const arcaRequest: ArcaFacturaRequest = {
      ...comprobante,
      cbteFecha: formatDate(new Date()),
      cbteDesde: cbteNro,
      cbteHasta: cbteNro,
    };

    // `findExisting` corrió antes de esta transacción, así que dos requests
    // concurrentes con el mismo Idempotency-Key pueden pasar ambas ese
    // chequeo y llegar acá. El índice único `(tenant_id, idempotency_key)`
    // (ver db/schema/facturas.ts) es la garantía real; si el insert lo
    // viola, es exactamente esa carrera — se lo traducimos al cliente como
    // 409 en vez de dejar que el error crudo de Postgres llegue al handler
    // genérico como 500.
    let pendingFactura: Factura | undefined;
    try {
      [pendingFactura] = await tx
        .insert(facturas)
        .values({
          tenantId: tenant.id,
          idempotencyKey,
          cbteTipo: comprobante.cbteTipo,
          estado: 'pendiente',
          payloadEnviado: arcaRequest,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateIdempotencyKeyError();
      }
      throw error;
    }

    if (!pendingFactura) throw new Error('Failed to create factura');

    try {
      const arcaResponse = await arcaClient.emitirFactura(arcaRequest);

      const [updatedFactura] = await tx
        .update(facturas)
        .set({
          cae: arcaResponse.cae,
          vencimientoCae: arcaResponse.caeFchVto,
          numero: formatNumero(comprobante.ptoVta, arcaResponse.cbteNro),
          estado: 'aprobada',
          respuestaArca: arcaResponse,
        })
        .where(eq(facturas.id, pendingFactura.id))
        .returning();

      return { factura: updatedFactura!, rejection: null };
    } catch (error) {
      if (!(error instanceof ArcaRejectionError)) {
        throw error;
      }

      const [rejectedFactura] = await tx
        .update(facturas)
        .set({
          estado: 'rechazada',
          respuestaArca: { message: error.message, details: error.details },
        })
        .where(eq(facturas.id, pendingFactura.id))
        .returning();

      await decrementNumero(tx, tenant.id, comprobante.ptoVta, comprobante.cbteTipo);

      return { factura: rejectedFactura!, rejection: error };
    }
  });

  if (rejection) {
    throw rejection;
  }

  return { factura, isNew: true };
}

/** El filtro por `tenantId` (no solo `facturaId`) es lo que garantiza el aislamiento entre tenants: un id ajeno da 404, nunca 403. */
export async function getFacturaById(tenantId: string, facturaId: string): Promise<Factura> {
  const [factura] = await db
    .select()
    .from(facturas)
    .where(and(eq(facturas.tenantId, tenantId), eq(facturas.id, facturaId)))
    .limit(1);

  if (!factura) {
    throw new FacturaNotFoundError();
  }

  return factura;
}

export interface ListFacturasParams {
  desde?: Date | undefined;
  hasta?: Date | undefined;
  estado?: EstadoFactura | undefined;
  page: number;
  limit: number;
}

export async function listFacturas(
  tenantId: string,
  params: ListFacturasParams
): Promise<{ data: Factura[]; total: number }> {
  const conditions = [eq(facturas.tenantId, tenantId)];

  if (params.desde) {
    conditions.push(gte(facturas.createdAt, params.desde));
  }
  if (params.hasta) {
    conditions.push(lte(facturas.createdAt, params.hasta));
  }
  if (params.estado) {
    conditions.push(eq(facturas.estado, params.estado));
  }

  // count() y el select de datos filtran por las mismas condiciones y son
  // independientes entre sí — corren en paralelo en vez de en serie.
  const [[countResult], data] = await Promise.all([
    db.select({ count: count() }).from(facturas).where(and(...conditions)),
    db
      .select()
      .from(facturas)
      .where(and(...conditions))
      .orderBy(facturas.createdAt)
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
  ]);

  return { data, total: countResult?.count ?? 0 };
}
