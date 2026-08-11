/**
 * Conveniencia para sembrar `precios_base` a mano, sin escribir SQL directo.
 * No hay endpoint HTTP para esto en el MVP (ver PLAN.md, "precios_base: sin
 * UI de administración... se siembra a mano — script/SQL directo") — este
 * script es esa vía, pero pasando por `crearPrecioBase` (con su validación
 * de solapamiento y el cierre automático de la fila "actual" anterior) en
 * vez de un `INSERT` crudo que podría romper la invariante de no-superposición
 * sin que nadie se entere hasta que `getPrecioVigente` tire
 * `PrecioBaseAmbiguoError` en producción.
 *
 * Uso:
 *   pnpm --filter api seed:precio-base -- <precio> <vigenteDesde:YYYY-MM-DD> [vigenteHasta:YYYY-MM-DD]
 *
 * Ejemplos:
 *   # Precio nuevo "actual" (cierra automáticamente la fila abierta anterior, si existe):
 *   pnpm --filter api seed:precio-base -- 95000 2026-08-01
 *
 *   # Backfill de un precio histórico ya cerrado (no toca la fila "actual"):
 *   pnpm --filter api seed:precio-base -- 80000 2025-06-01 2025-12-31
 */
import { crearPrecioBase } from '../src/services/precios-base/index.js';

/** Parsea `YYYY-MM-DD` a un `Date` en hora local — mismo criterio que usa `services/precios-base` (ver el comentario ahí sobre por qué nunca `toISOString`/UTC para estas fechas de solo-calendario). */
function parseFechaLocal(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    throw new Error(`Fecha inválida: "${input}" (se espera YYYY-MM-DD)`);
  }
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  return new Date(year, month - 1, day);
}

async function main() {
  const [precioArg, vigenteDesdeArg, vigenteHastaArg] = process.argv.slice(2);

  if (!precioArg || !vigenteDesdeArg) {
    console.error('Uso: seed-precio-base.ts <precio> <vigenteDesde:YYYY-MM-DD> [vigenteHasta:YYYY-MM-DD]');
    process.exit(1);
  }

  const precio = Number(precioArg);
  const vigenteDesde = parseFechaLocal(vigenteDesdeArg);
  const vigenteHasta = vigenteHastaArg ? parseFechaLocal(vigenteHastaArg) : null;

  const creado = await crearPrecioBase({ precio, vigenteDesde, vigenteHasta });

  console.log('precio_base creado:', {
    id: creado.id,
    precio: creado.precio,
    vigenteDesde: creado.vigenteDesde,
    vigenteHasta: creado.vigenteHasta,
  });
  process.exit(0);
}

main().catch((err) => {
  console.error('Falló la siembra de precio_base:', err instanceof Error ? err.message : err);
  process.exit(1);
});
