/**
 * Endpoints de facturas que no dependen de `feature/facturas-service-v2`
 * (todavía no aterrizó — ver `routes/index.ts`). Por ahora solo
 * `GET /v1/facturas/:id/pdf` (`feature/pdf-generation`), que solo necesita
 * leer una fila existente de `facturas` + su `usuarios` dueño, no orquestar
 * la emisión completa.
 */
import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { facturas, usuarios } from '../db/schema/index.js';
import { generateFacturaPdf, formatNumeroComprobante } from '../services/pdf/index.js';
import { FacturaNotFoundError } from '../errors/index.js';

/**
 * `factura` + su `usuario` dueño en una sola consulta (`INNER JOIN`), no dos
 * `SELECT`s separados: `facturas.usuarioId` tiene FK `NOT NULL` a `usuarios`
 * con `onDelete: 'cascade'` (ver `db/schema/facturas.ts`), así que una
 * factura sin usuario dueño es un estado que la propia DB no permite que
 * exista — no hace falta (ni se puede testear honestamente) un branch
 * defensivo para "factura encontrada pero usuario no encontrado" que la FK
 * ya descarta por diseño. Si no hay resultado, la factura simplemente no
 * existe.
 */
async function findFacturaConUsuario(id: string) {
  const [row] = await db
    .select({ factura: facturas, usuario: usuarios })
    .from(facturas)
    .innerJoin(usuarios, eq(usuarios.id, facturas.usuarioId))
    .where(eq(facturas.id, id));

  return row;
}

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function registerFacturaRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/v1/facturas/:id/pdf', {
    schema: {
      params: paramsSchema,
      tags: ['facturas'],
      description: 'Genera el PDF (con QR de ARCA) de una factura ya emitida, on-demand.',
    },
    handler: async (request, reply) => {
      // TODO(feature/usuarios-auth): esta ruta todavía no valida
      // `Authorization: Bearer <accessToken>` ni filtra por el usuario
      // dueño del token — `feature/usuarios-auth` (JWT access+refresh)
      // no mergeó a esta rama todavía (ambas parten de `db-schema-v2`,
      // Etapa 3 en paralelo, ver PLAN.md). Como está ahora, cualquiera que
      // adivine un `id` de factura puede descargar su PDF (que incluye CAE,
      // razón social y domicilio del emisor) sin autenticarse. Esto es un
      // gap de seguridad real, no cosmético — está señalado en el PR body
      // como bloqueante antes de producción. Cuando exista el middleware de
      // auth real: (1) exigirlo acá, (2) resolver `usuario` desde el JWT en
      // vez de vía `factura.usuarioId`, y (3) responder 404 (no 403) si la
      // factura pertenece a otro usuario, como ya documenta
      // `docs/api-contract.md`.
      const { id } = request.params;

      const row = await findFacturaConUsuario(id);
      if (!row) {
        throw new FacturaNotFoundError();
      }
      const { factura, usuario } = row;

      const pdfBuffer = await generateFacturaPdf(factura, usuario);

      // En este punto `generateFacturaPdf` ya devolvió con éxito, lo que
      // solo pasa si `estado === 'emitida'` — y `buildInvoiceData` (dentro
      // de `generateFacturaPdf`) ya validó que `cbteNro` no es `null` para
      // ese estado (tira `InternalArcaError` si lo fuera). No hace falta
      // repetir ese chequeo acá ni un fallback para "factura emitida sin
      // número": ya es un estado descartado antes de llegar a esta línea.
      const filename = `factura-${formatNumeroComprobante(factura.ptoVta, factura.cbteNro as number)}.pdf`;

      // `inline` (no `attachment`): la PWA necesita tanto previsualizar el
      // comprobante en el navegador/webview antes de compartirlo (caso de
      // uso central del repartidor, ver `docs/api-contract.md`) como
      // guardarlo/compartirlo — con `inline` el browser igual permite
      // "Guardar como" / compartir desde el visor nativo de PDF, mientras
      // que `attachment` fuerza la descarga y rompe la previsualización.
      // Documentado acá porque `docs/api-contract.md` lo dejaba "a definir
      // en `feature/pdf-generation`".
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdfBuffer);
    },
  });
}
