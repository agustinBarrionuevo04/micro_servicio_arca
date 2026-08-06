import { eq, and, sql, gte, lte, count } from 'drizzle-orm';
import { db, type Database, type Transaction } from '../../db/index.js';
import { facturas, contadores, type Tenant, type Factura, type EstadoFactura } from '../../db/schema/index.js';
import { decrypt } from '../../config/crypto.js';
import { getArcaClientForTenant, type ArcaFacturaRequest } from '../../services/arca/index.js';
import { resolverComprobante, type VentaInput, type ClienteInput, type ComprobantePayload } from '../../services/fiscal-rules/index.js';
import { createIdempotencyService } from '../../services/idempotency/index.js';
import { FacturaNotFoundError, ArcaRejectionError } from '../../errors/index.js';
import type { CreateFacturaBody } from './schemas.js';

export interface CreateFacturaResult {
  factura: Factura;
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

  const ventaInput: VentaInput = {
    items: body.items.map((item) => ({
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precio_unitario,
    })),
    total: body.total,
  };

  const clienteInput: ClienteInput = {
    tipoDoc: body.cliente.tipo_doc,
    nroDoc: body.cliente.nro_doc,
  };

  const comprobante = resolverComprobante(
    {
      cuit: tenant.cuit,
      condicionFiscal: tenant.condicionFiscal,
      puntoVenta: tenant.puntoVenta,
    },
    ventaInput,
    clienteInput
  );

  const decryptedCert = decrypt(tenant.cert);
  const decryptedKey = decrypt(tenant.key);

  const arcaClient = await getArcaClientForTenant(tenant.id, {
    cert: decryptedCert,
    key: decryptedKey,
    cuit: tenant.cuit.replace(/-/g, ''),
  });

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
      // Solo confirmamos (commit) el estado 'rechazada' cuando ARCA
      // explícitamente rechazó el comprobante; otros errores (de red,
      // internos) hacen rollback para permitir un reintento seguro.
      if (!(error instanceof ArcaRejectionError)) {
        throw error;
      }

      const [rejectedFactura] = await tx
        .update(facturas)
        .set({
          estado: 'rechazada',
          respuestaArca: {
            message: error.message,
            details: error.details,
          },
        })
        .where(eq(facturas.id, pendingFactura.id))
        .returning();

      await tx
        .update(contadores)
        .set({ ultimoNumero: sql`${contadores.ultimoNumero} - 1` })
        .where(
          and(
            eq(contadores.tenantId, tenant.id),
            eq(contadores.ptoVta, comprobante.ptoVta),
            eq(contadores.cbteTipo, comprobante.cbteTipo)
          )
        );

      return { factura: rejectedFactura!, rejection: error };
    }
  });

  if (rejection) {
    throw rejection;
  }

  return { factura, isNew: true };
}

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
