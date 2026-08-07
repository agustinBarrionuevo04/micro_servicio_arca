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
import { FacturaNotFoundError, ArcaRejectionError } from '../../errors/index.js';
import type { CreateFacturaBody } from './schemas.js';

export interface CreateFacturaResult {
  factura: Factura;
  /** false si vino de un reintento con el mismo Idempotency-Key (la ruta usa esto para responder 200 en vez de 201). */
  isNew: boolean;
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
 * `(tenant, punto de venta, tipo de comprobante)`. El `SELECT ... FOR
 * UPDATE` bloquea la fila del contador hasta que la transacción termina, así
 * que dos requests concurrentes del mismo tenant se serializan acá en vez
 * de pisarse el número — es lo que garantiza el test de concurrencia.
 */
async function getNextNumero(
  tx: Transaction,
  tenantId: string,
  ptoVta: number,
  cbteTipo: number
): Promise<number> {
  const [result] = await tx
    .select({ ultimoNumero: contadores.ultimoNumero })
    .from(contadores)
    .where(
      and(
        eq(contadores.tenantId, tenantId),
        eq(contadores.ptoVta, ptoVta),
        eq(contadores.cbteTipo, cbteTipo)
      )
    )
    .for('update');

  const current = result?.ultimoNumero ?? 0;
  const next = current + 1;

  await tx
    .update(contadores)
    .set({ ultimoNumero: next })
    .where(
      and(
        eq(contadores.tenantId, tenantId),
        eq(contadores.ptoVta, ptoVta),
        eq(contadores.cbteTipo, cbteTipo)
      )
    );

  return next;
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

    const [pendingFactura] = await tx
      .insert(facturas)
      .values({
        tenantId: tenant.id,
        idempotencyKey,
        cbteTipo: comprobante.cbteTipo,
        estado: 'pendiente',
        payloadEnviado: arcaRequest,
      })
      .returning();

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
  desde?: string | undefined;
  hasta?: string | undefined;
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
    conditions.push(gte(facturas.createdAt, new Date(params.desde)));
  }
  if (params.hasta) {
    conditions.push(lte(facturas.createdAt, new Date(params.hasta)));
  }
  if (params.estado) {
    conditions.push(eq(facturas.estado, params.estado));
  }

  const [countResult] = await db
    .select({ count: count() })
    .from(facturas)
    .where(and(...conditions));

  const total = countResult?.count ?? 0;

  const data = await db
    .select()
    .from(facturas)
    .where(and(...conditions))
    .orderBy(facturas.createdAt)
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  return { data, total };
}
